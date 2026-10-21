package com.margelo.nitro.tcgscanner

import android.graphics.BitmapFactory
import android.os.SystemClock
import org.opencv.android.Utils
import org.opencv.calib3d.Calib3d
import org.opencv.core.*
import org.opencv.features2d.BFMatcher
import org.opencv.features2d.ORB
import org.opencv.imgproc.Imgproc
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.math.*

/** Embeddings retrieve candidates; spatial artwork agreement verifies them.
 * Only requested public reference images are fetched. Persist small descriptors,
 * never photos, and keep network work off the recognition/tracking threads. */
class CompactImageVerifier(private val directory:File) {
  data class Match(val candidate:CompactCardIndex.Candidate,val corners:List<Point>,val inliers:Int,val coverage:Double)
  private data class Features(val width:Int,val height:Int,val points:List<Point>,val descriptors:ByteArray)
  private val cache=LinkedHashMap<String,Features>(64,.75f,true)
  private val loading=HashSet<String>()
  private val failed=HashMap<String,Long>()
  private val downloads=Executors.newFixedThreadPool(2)
  private val orb=ORB.create(1800,1.2f,8,12,0,2,ORB.HARRIS_SCORE,31,8)
  private val matcher=BFMatcher.create(Core.NORM_HAMMING,false)

  private fun path(candidate:CompactCardIndex.Candidate):String {
    val card=candidate.card
    val image=if(candidate.id.startsWith("photo:"))card.optJSONObject("referenceThumbnail")?.optString("image")?:"" else card.optString("image")
    return if(image.startsWith("/market/images/kream/")||image.startsWith("/api/catalog/images/"))image.takeIf{!it.contains('?')&&!it.contains("..")&&!it.contains('#')}?:"" else ""
  }
  private fun file(path:String)=File(directory,MessageDigest.getInstance("SHA-256").digest(path.toByteArray()).joinToString(""){"%02x".format(it.toInt() and 255)}+".orb")
  private fun read(path:String):Features?=try {
    val f=file(path)
    if(!f.isFile||f.length() !in 28..80_000)null else DataInputStream(f.inputStream().buffered()).use {input->
      require(input.readInt()==3);val w=input.readInt();val h=input.readInt();val n=input.readInt()
      require(w in 40..800&&h in 40..800&&n in 12..1800&&f.length()==16L+n*40)
      val points=List(n){Point(input.readFloat().toDouble(),input.readFloat().toDouble())}
      val bytes=ByteArray(n*32);input.readFully(bytes);Features(w,h,points,bytes)
    }
  }catch(_:Exception){null}
  private fun remember(path:String,value:Features) = synchronized(cache) {
    cache[path]=value
    while(cache.size>64)cache.remove(cache.keys.first())
  }
  private fun catalogCard(rgba:Mat,preserveCardBorder:Boolean):Rect? {
    val w=rgba.cols();val h=rgba.rows();val pixels=ByteArray(w*h*4);rgba.get(0,0,pixels)
    // A catalog scan already has the card's aspect ratio. Its black border is
    // part of the card, including the collector number below the rules box.
    // Removing it as product padding shrinks the projected corners and cuts
    // the printing evidence out of the subsequent OCR crop.
    if(preserveCardBorder && w.toDouble()/h in .68.. .76)return null
    val corners=intArrayOf(0,(w-1)*4,(h-1)*w*4,(h*w-1)*4)
    val background=IntArray(3){channel->corners.map{pixels[it+channel].toInt() and 255}.sorted()[1]}
    // A footer/watermark can occupy one corner. Three matching corners still
    // identify product padding; do not include that footer in card geometry.
    if(corners.count{p->(0..2).all{abs((pixels[p+it].toInt() and 255)-background[it])<16}}<3)return null
    fun foreground(x:Int,y:Int):Boolean {val p=(y*w+x)*4;return (0..2).any{abs((pixels[p+it].toInt() and 255)-background[it])>25}}
    val left=ArrayList<Int>();val right=ArrayList<Int>();val top=ArrayList<Int>();val bottom=ArrayList<Int>()
    for(y in h*3/10 until h*7/10){val xs=(0 until w).filter{foreground(it,y)};if(xs.isNotEmpty()){left.add(xs.first());right.add(xs.last())}}
    for(x in w*4/10 until w*6/10){val ys=(0 until h).filter{foreground(x,it)};if(ys.isNotEmpty()){top.add(ys.first());bottom.add(ys.last())}}
    if(left.size<h/5||top.size<w/10)return null
    fun median(values:List<Int>)=values.sorted()[values.size/2]
    val x0=median(left);val x1=median(right);val y0=median(top);val y1=median(bottom)
    val cw=x1-x0+1;val ch=y1-y0+1
    if(cw.toDouble()/ch !in .48.. .85||cw<w*.25||ch<h*.5||cw.toDouble()*ch/(w*h) !in .16.. .95)return null
    var filled=0;var sampled=0
    for(y in y0..y1 step 4)for(x in x0..x1 step 4){sampled++;if(foreground(x,y))filled++}
    if(filled<sampled*.5)return null
    return Rect(x0,y0,cw,ch)
  }
  private fun fetch(path:String,game:String):Features {
    val connection=URL("https://tcgindex.org"+path).openConnection() as HttpURLConnection
    connection.connectTimeout=4000;connection.readTimeout=4000;connection.instanceFollowRedirects=false
    val data=try {
      require(connection.responseCode==200)
      connection.inputStream.use {input->ByteArrayOutputStream().use {out->
        val buffer=ByteArray(8192)
        while(true){val n=input.read(buffer);if(n<0)break;require(out.size()+n<=4_000_000);out.write(buffer,0,n)}
        out.toByteArray()
      }}
    }finally{connection.disconnect()}
    val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(data,0,data.size,bounds)
    require(bounds.outWidth in 40..10000&&bounds.outHeight in 40..10000)
    val options=BitmapFactory.Options().apply{inSampleSize=1;while(max(bounds.outWidth,bounds.outHeight)/inSampleSize>1200)inSampleSize*=2}
    val bitmap=BitmapFactory.decodeByteArray(data,0,data.size,options)?:error("Invalid reference image")
    val rgba=Mat();val gray=Mat();val points=MatOfKeyPoint();val descriptors=Mat();val mask=Mat()
    val encoder=ORB.create(1800,1.2f,8,12,0,2,ORB.HARRIS_SCORE,31,8)
    try {
      Utils.bitmapToMat(bitmap,rgba);Imgproc.cvtColor(rgba,gray,Imgproc.COLOR_RGBA2GRAY)
      catalogCard(rgba,game=="magic"&&path.startsWith("/api/catalog/images/"))?.let {bounds->val region=gray.submat(bounds);val crop=region.clone();region.release();gray.release();crop.copyTo(gray);crop.release()}
      val scale=min(1.0,640.0/max(gray.cols(),gray.rows()));if(scale<1)Imgproc.resize(gray,gray,Size((gray.cols()*scale).roundToInt().toDouble(),(gray.rows()*scale).roundToInt().toDouble()))
      encoder.detectAndCompute(gray,mask,points,descriptors)
      val p=points.toList().map{it.pt};require(p.size>=12)
      val bytes=ByteArray(p.size*32);descriptors.get(0,0,bytes)
      return Features(gray.cols(),gray.rows(),p,bytes)
    }finally{bitmap.recycle();rgba.release();gray.release();points.release();descriptors.release();mask.release();encoder.clear()}
  }
  private fun prepare(candidates:List<CompactCardIndex.Candidate>) {
    for(candidate in candidates.filter{path(it).isNotEmpty()}.distinctBy{path(it)}.take(48)) {
      val path=path(candidate)
      synchronized(cache) {
        if(cache.containsKey(path)||path in loading||(failed[path]?:0)>SystemClock.elapsedRealtime())return@synchronized
        read(path)?.let{remember(path,it);return@synchronized}
        if(loading.size>=6)return@synchronized
        loading.add(path)
        downloads.execute {
          try {
            val features=fetch(path,candidate.card.optString("game"));directory.mkdirs();val dest=file(path);val pending=File(directory,dest.name+".pending")
            try {
              DataOutputStream(pending.outputStream().buffered()).use {out->out.writeInt(3);out.writeInt(features.width);out.writeInt(features.height);out.writeInt(features.points.size);features.points.forEach{out.writeFloat(it.x.toFloat());out.writeFloat(it.y.toFloat())};out.write(features.descriptors)}
              check(pending.renameTo(dest))
              // Bounded verification cache, independent of the game data pack.
              directory.listFiles()?.filter{it.extension=="orb"}?.sortedByDescending{it.lastModified()}?.drop(128)?.forEach{it.delete()}
            }finally{pending.delete()}
            remember(path,features)
          }catch(error:Exception){android.util.Log.d("TCGScanner","Reference verification unavailable: ${error.javaClass.simpleName}");synchronized(cache){failed[path]=SystemClock.elapsedRealtime()+30_000}}
          finally{synchronized(cache){loading.remove(path)}}
        }
      }
    }
  }
  private fun area(points:List<Point>):Double {
    if(points.size<3)return 0.0
    val p=MatOfPoint(*points.toTypedArray());val indices=MatOfInt()
    return try{Imgproc.convexHull(p,indices);val q=indices.toArray().map{points[it]};abs(q.indices.sumOf{i->val j=(i+1)%q.size;q[i].x*q[j].y-q[j].x*q[i].y})/2}finally{p.release();indices.release()}
  }
  fun verify(rgb:Mat,candidates:List<CompactCardIndex.Candidate>,wait:Boolean=false):List<Match> {
    prepare(candidates)
    if(wait) {
      val deadline=SystemClock.elapsedRealtime()+4500
      while(SystemClock.elapsedRealtime()<deadline&&synchronized(cache){loading.isNotEmpty()}){Thread.sleep(40);prepare(candidates)}
    }
    val available=candidates.mapNotNull{candidate->synchronized(cache){cache[path(candidate)]}?.let{candidate to it}}.distinctBy{path(it.first)}.take(48)
    if(available.isEmpty())return emptyList()
    val gray=Mat();val keypoints=MatOfKeyPoint();val descriptors=Mat();val mask=Mat()
    try {
      Imgproc.cvtColor(rgb,gray,Imgproc.COLOR_RGB2GRAY);val scale=min(1.0,960.0/max(gray.cols(),gray.rows()))
      if(scale<1)Imgproc.resize(gray,gray,Size((gray.cols()*scale).roundToInt().toDouble(),(gray.rows()*scale).roundToInt().toDouble()))
      orb.detectAndCompute(gray,mask,keypoints,descriptors);val query=keypoints.toList().map{Point(it.pt.x/scale,it.pt.y/scale)}
      if(query.size<12)return emptyList()
      val verified=ArrayList<Match>()
      for((candidate,ref)in available) {
        val source=Mat(ref.points.size,32,CvType.CV_8UC1);source.put(0,0,ref.descriptors)
        val matches=ArrayList<MatOfDMatch>();val from=MatOfPoint2f();val to=MatOfPoint2f();val inliers=Mat();var transform:Mat?=null
        try {
          matcher.knnMatch(source,descriptors,matches,2)
          val good=matches.map{it.toArray()}.filter{it.size==2&&it[0].distance<64&&it[0].distance<it[1].distance*.72}.map{it[0]}.sortedBy{it.distance}.distinctBy{it.trainIdx}
          if(good.size<14)continue
          val a=good.map{ref.points[it.queryIdx]};val b=good.map{query[it.trainIdx]};from.fromList(a);to.fromList(b)
          transform=Calib3d.findHomography(from,to,Calib3d.RANSAC,4.0,inliers,1200,.995)
          if(transform.empty())continue
          val accepted=good.indices.filter{inliers.get(it,0)[0]!=0.0};if(accepted.size<14||accepted.size.toDouble()/good.size<.5)continue
          val covered=accepted.map{a[it]};val core=covered.filter{it.x in ref.width*.08..ref.width*.92&&it.y in ref.height*.14..ref.height*.78}
          val coverage=area(covered)/(ref.width*ref.height);if(coverage<.16||core.size<10||area(core)/(ref.width*ref.height)<.08)continue
          val q=MatOfPoint2f(Point(0.0,0.0),Point(ref.width.toDouble(),0.0),Point(ref.width.toDouble(),ref.height.toDouble()),Point(0.0,ref.height.toDouble()));val projected=MatOfPoint2f()
          try {
            Core.perspectiveTransform(q,projected,transform);val corners=projected.toList()
            val shape=MatOfPoint(*corners.toTypedArray());val convex=try{Imgproc.isContourConvex(shape)}finally{shape.release()}
            val fraction=area(corners)/(rgb.cols()*rgb.rows())
            if(!convex||fraction !in .025.. .88||corners.any{!it.x.isFinite()||!it.y.isFinite()||it.x< -rgb.cols()*.05||it.x>rgb.cols()*1.05||it.y< -rgb.rows()*.05||it.y>rgb.rows()*1.05})continue
            verified.add(Match(candidate,corners,accepted.size,coverage))
          }finally{q.release();projected.release()}
        }finally{source.release();matches.forEach{it.release()};from.release();to.release();inliers.release();transform?.release()}
      }
      return verified.sortedByDescending{it.inliers*it.coverage}.flatMap {match->
        // One downloaded image can describe several editions. Keep all of them
        // for OCR ambiguity checks instead of silently choosing one finish.
        candidates.filter{path(it)==path(match.candidate)}.map{match.copy(candidate=it)}
      }
    }finally{gray.release();keypoints.release();descriptors.release();mask.release()}
  }
}
