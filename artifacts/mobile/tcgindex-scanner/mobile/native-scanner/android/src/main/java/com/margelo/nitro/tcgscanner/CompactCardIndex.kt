package com.margelo.nitro.tcgscanner

import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import org.opencv.core.Mat
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.math.roundToInt

internal object CompactFeatureSearch {
  external fun open(path: String): Long
  external fun count(handle: Long): Int
  external fun rank(handle: Long, vector: ByteArray, limit: Int): FloatArray
  external fun close(handle: Long)
}

/** Prepared model/index/SQLite files. Retrieval never confirms a printing itself. */
class CompactCardIndex(model: Part, index: Part, cards: Part, prices: Part): AutoCloseable {
  data class Part(val path: String, val sha256: String, val bytes: Long)
  data class Candidate(val id: String, val similarity: Double, val card: JSONObject)
  private var interpreter: Interpreter? = null
  private var metadata: SQLiteDatabase? = null
  private var priceData: SQLiteDatabase? = null
  private var handle = 0L
  private val input = ByteBuffer.allocateDirect(224*224*3*4).order(ByteOrder.nativeOrder())
  private val output = arrayOf(FloatArray(256))
  private var resized: Mat? = null
  private val pixels = ByteArray(224*224*3)
  val count: Int

  init {
    try {
      check(org.opencv.android.OpenCVLoader.initLocal()) { "OpenCV initialization failed" }
      resized=Mat()
      listOf(model,index,cards,prices).forEach { validate(it) }
      val mapped = FileInputStream(model.path).use { it.channel.map(FileChannel.MapMode.READ_ONLY,0,model.bytes) }
      interpreter = Interpreter(mapped, Interpreter.Options().setNumThreads(2).setUseXNNPACK(true))
      check(interpreter!!.getInputTensor(0).shape().contentEquals(intArrayOf(1,224,224,3))) { "Invalid card encoder input" }
      check(interpreter!!.getOutputTensor(0).shape().contentEquals(intArrayOf(1,256))) { "Invalid card encoder output" }
      check(interpreter!!.getInputTensor(0).dataType()==org.tensorflow.lite.DataType.FLOAT32)
      check(interpreter!!.getOutputTensor(0).dataType()==org.tensorflow.lite.DataType.FLOAT32)
      metadata = SQLiteDatabase.openDatabase(cards.path,null,SQLiteDatabase.OPEN_READONLY)
      priceData = SQLiteDatabase.openDatabase(prices.path,null,SQLiteDatabase.OPEN_READONLY)
      handle = CompactFeatureSearch.open(index.path)
      count = CompactFeatureSearch.count(handle)
      metadata!!.rawQuery("SELECT count(*) FROM cards",null).use { cursor ->
        check(cursor.moveToFirst() && cursor.getInt(0) in count..100000) { "Card metadata does not match the prepared index" }
      }
    } catch(error: Exception) { close(); throw error }
  }

  companion object { fun validate(part: Part) {
    require(part.sha256.matches(Regex("[a-f0-9]{64}")) && part.bytes in 1..100_000_000)
    val file = File(part.path)
    require(file.isFile && file.length()==part.bytes) { "Incomplete card data file" }
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { stream ->
      val buffer = ByteArray(64*1024)
      while(true) { val size=stream.read(buffer); if(size<0)break; digest.update(buffer,0,size) }
    }
    require(digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }==part.sha256) { "Card data checksum mismatch" }
  } }

  /** Input is RGB, already cropped to the guide/card. Geometry is not a prerequisite. */
  @Synchronized fun embedding(rgb: Mat): ByteArray {
    check(handle!=0L && interpreter!=null) { "Card index is closed" }
    require(rgb.channels()==3 && !rgb.empty())
    val small=checkNotNull(resized)
    Imgproc.resize(rgb,small,Size(224.0,224.0),0.0,0.0,Imgproc.INTER_CUBIC)
    small.get(0,0,pixels);input.rewind()
    for(value in pixels)input.putFloat((value.toInt() and 255)/255f)
    input.rewind();interpreter!!.run(input,output)
    val values=output[0]
    check(values.all { it.isFinite() }) { "Invalid card embedding" }
    val scale=values.maxOf { abs(it) }
    check(scale>1e-8f) { "Empty card embedding" }
    return ByteArray(256) { (values[it]/scale*127).roundToInt().coerceIn(-127,127).toByte() }
  }

  @Synchronized fun search(rgb: Mat, language: String="all", limit: Int=8, includePhotos: Boolean=true): List<Candidate> {
    require(limit in 1..32)
    val results=CompactFeatureSearch.rank(handle,embedding(rgb),32)
    val found=ArrayList<Candidate>()
    for(offset in results.indices step 2) {
      val key=results[offset].toInt()
      metadata!!.rawQuery("SELECT id,language,card FROM cards WHERE key=?",arrayOf(key.toString())).use { cursor ->
        check(cursor.moveToFirst()) { "Search result has no matching card metadata" }
        if((language=="all" || cursor.getString(1)==language) && (includePhotos || !cursor.getString(0).startsWith("photo:"))) {
          val id=cursor.getString(0);val card=JSONObject(cursor.getString(2))
          priceData!!.rawQuery("SELECT value FROM prices WHERE id=?",arrayOf(id)).use { price ->
            if(price.moveToFirst()) {
              val values=JSONObject(price.getString(0))
              for(name in listOf("price","prices","valuations"))card.put(name,values.opt(name))
            }
          }
          found.add(Candidate(id,results[offset+1].toDouble(),card))
        }
      }
      if(found.size>=limit)break
    }
    return found
  }

  /** OCR supplements image retrieval, never confirms a card by itself. Use the
   * existing local metadata without a second database or a server round trip. */
  @Synchronized fun searchText(text:String,language:String):List<Candidate> {
    val normalized=java.text.Normalizer.normalize(text,java.text.Normalizer.Form.NFKC)
    val hints=CompactIdentity.lookupHints(normalized)
    val found=LinkedHashMap<String,Candidate>()
    for(hint in hints) {
      val pattern="%"+hint.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
      metadata!!.rawQuery("SELECT id,language,card FROM cards WHERE card LIKE ? ESCAPE '\\' LIMIT 64",arrayOf(pattern)).use {cursor->
        while(cursor.moveToNext()) {
          if(language!="all"&&cursor.getString(1)!=language)continue
          val id=cursor.getString(0);if(id.startsWith("photo:"))continue
          val card=JSONObject(cursor.getString(2));if(!CompactIdentity.textMatches(card,normalized))continue
          priceData!!.rawQuery("SELECT value FROM prices WHERE id=?",arrayOf(id)).use{price->
            if(price.moveToFirst()){val values=JSONObject(price.getString(0));for(name in listOf("price","prices","valuations"))card.put(name,values.opt(name))}
          }
          found[id]=Candidate(id,0.0,card)
        }
      }
    }
    return found.values.sortedByDescending{CompactIdentity.titleSeen(it.card,normalized)}.take(16)
  }

  @Synchronized fun comparables(card: JSONObject): List<JSONObject> {
    val set=card.optString("setCode");val rarity=card.optString("rarity");val finish=card.optString("finish")
    if(set.isEmpty() || rarity.isEmpty() || finish.isEmpty() || !card.optBoolean("artworkSpecific",true))return emptyList()
    val result=ArrayList<JSONObject>()
    metadata!!.rawQuery("SELECT id,card FROM cards WHERE language=? AND setCode=? AND rarity=? AND finish=? AND id!=? LIMIT 64",
      arrayOf(card.optString("language"),set,rarity,finish,card.optString("id"))).use { cursor ->
      while(cursor.moveToNext()) {
        val value=JSONObject(cursor.getString(1))
        priceData!!.rawQuery("SELECT value FROM prices WHERE id=?",arrayOf(cursor.getString(0))).use { price ->
          if(price.moveToFirst()){val p=JSONObject(price.getString(0));for(name in listOf("price","prices","valuations"))value.put(name,p.opt(name))}
        }
        result.add(value)
      }
    }
    return result
  }

  @Synchronized override fun close() {
    if(handle!=0L) { CompactFeatureSearch.close(handle);handle=0L }
    interpreter?.close();interpreter=null
    metadata?.close();metadata=null;priceData?.close();priceData=null;resized?.release();resized=null
  }
}
