package com.margelo.nitro.tcgscanner

import org.opencv.core.Rect2d
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.min
import kotlin.math.max

internal data class Reference(val id:String,val count:Int,val width:Int,val height:Int,val buffer:ByteBuffer,val offset:Int,val bounds:Rect2d)
/** Four independent 16-bit descriptor tables, with compact integer postings.
 * Mapped feature parts stay on disk; only shortlisted references become Mats. */
internal class VisualIndex(val references:List<Reference>,cachePath:String="",cacheKey:String="",private val sourcePaths:List<String> = emptyList(),private val sourceIds:Set<String> = emptySet()) {
  private var handle=if(references.isEmpty())0L else CardFeatureSearch.create(references.map{it.buffer}.toTypedArray(),references.map{it.offset}.toIntArray(),references.map{it.count}.toIntArray(),cachePath,cacheKey)
  fun close(){if(handle!=0L){CardFeatureSearch.destroy(handle);handle=0}}
  fun matches(paths:List<String>,ids:Set<String>)=sourceIds==ids&&sourcePaths==paths.map{File(it.removePrefix("file://")).absolutePath}
  fun rank(descriptors:ByteArray,limit:Int,expanded:Boolean=false):List<Pair<Int,Int>> {
    if(descriptors.isEmpty()||references.isEmpty())return emptyList()
    return CardFeatureSearch.rank(handle,descriptors,limit,expanded).toList().chunked(2).map{Pair(it[0],it[1])}
  }
  fun match(card:Int,descriptors:ByteArray)=CardFeatureSearch.match(handle,card,descriptors)
  companion object {
    fun restore(paths:List<String>,allowed:Set<String>):VisualIndex? {
      val folder=paths.firstOrNull()?.let{File(it.removePrefix("file://")).parentFile}?:return null
      return try{
        val source=File(folder,"search-source.json");if(!source.isFile||source.length()>8_000_000)return null
        val json=org.json.JSONObject(source.readText());val values=json.getJSONArray("paths");val names=json.getJSONArray("ids")
        require(values.length() in 1..4000&&names.length() in 1..100000)
        val savedPaths=(0 until values.length()).map{values.getString(it)}
        require(savedPaths.all{val file=File(it);file.canonicalFile.parentFile==folder.canonicalFile&&Regex("[a-f0-9]{64}\\.bin").matches(file.name)&&file.isFile})
        val savedIds=(0 until names.length()).map{names.getString(it)}.toSet()
        if(!allowed.containsAll(savedIds))return null
        read(savedPaths,savedIds)
      }catch(_:Exception){null}
    }
    fun read(paths:List<String>,ids:Set<String>):VisualIndex {
      val refs=ArrayList<Reference>();val seen=HashSet<String>()
      for(path in paths){val file=File(path.removePrefix("file://"));require(file.length() in 8..2_000_000)
        val b=RandomAccessFile(file,"r").use{it.channel.map(FileChannel.MapMode.READ_ONLY,0,it.length()).order(ByteOrder.LITTLE_ENDIAN)}
        val magic=ByteArray(8);b.get(magic);require(String(magic,Charsets.US_ASCII)=="TCGORB1\u0000")
        while(b.remaining()>0){require(b.remaining()>=8);val size=b.short.toInt()and 65535;val count=b.short.toInt()and 65535;val w=b.short.toInt()and 65535;val h=b.short.toInt()and 65535
          require(size in 1..220&&count in 12..512&&w==448&&h==626&&b.remaining()>=size+count*40)
          val bytes=ByteArray(size);b.get(bytes);val id=String(bytes,Charsets.UTF_8);val offset=b.position();b.position(offset+count*40)
          if(id in ids&&seen.add(id)){
            var left=w.toDouble();var right=0.0;var top=h.toDouble();var bottom=0.0
            for(i in 0 until count){val x=b.getFloat(offset+i*40).toDouble();val y=b.getFloat(offset+i*40+4).toDouble();left=min(left,x);right=max(right,x);top=min(top,y);bottom=max(bottom,y)}
            // Legacy catalog features include light-grey product margins.
            // Recover their occupied card region before projecting corners.
            val bounds=if(id.startsWith("kream:")&&(right-left<w*.84||bottom-top<h*.84)){
              left=max(0.0,left-4);right=min(w.toDouble(),right+4);top=max(0.0,top-4);bottom=min(h.toDouble(),bottom+4)
              Rect2d(left,top,right-left,bottom-top)
            }else Rect2d(0.0,0.0,w.toDouble(),h.toDouble())
            refs.add(Reference(id,count,w,h,b,offset,bounds))
          }
        }
      }
      val fingerprint=java.security.MessageDigest.getInstance("SHA-256")
      for(path in paths)fingerprint.update((File(path.removePrefix("file://")).absolutePath+"\n").toByteArray(Charsets.UTF_8))
      for(id in ids.sorted())fingerprint.update((id+"\n").toByteArray(Charsets.UTF_8))
      val key=fingerprint.digest().joinToString(""){"%02x".format(it)}
      val cache=paths.firstOrNull()?.let{File(File(it.removePrefix("file://")).parentFile,"search.index").absolutePath}?:""
      val index=VisualIndex(refs,cache,key,paths.map{File(it.removePrefix("file://")).absolutePath},ids)
      // Remember the last built subset so a growing download can expose a
      // previously prepared index before hashing the larger replacement.
      if(cache.isNotEmpty())try{
        val source=File(File(cache).parentFile,"search-source.json")
        val pending=File(source.parentFile,"search-source.pending")
        pending.writeText(org.json.JSONObject().put("paths",org.json.JSONArray(paths.map{File(it.removePrefix("file://")).absolutePath})).put("ids",org.json.JSONArray(ids.toList())).toString())
        if(!pending.renameTo(source))pending.delete()
      }catch(_:Exception){}
      return index
    }
  }
}
