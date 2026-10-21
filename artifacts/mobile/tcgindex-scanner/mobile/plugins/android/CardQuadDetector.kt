package org.tcgindex.scanner

import android.graphics.Bitmap
import org.json.JSONObject
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.*
import org.opencv.imgproc.Imgproc
import kotlin.math.*

/** Clockwise corners in the transformed preview, independent of bitmap size. */
internal object CardQuadDetector {
  private val loaded by lazy { OpenCVLoader.initLocal() }
  data class Card(val corners:List<Point>,val clear:Boolean,val tracked:Boolean,val source:String)
  private data class Candidate(val points:List<Point>,val area:Double,val score:Double)
  fun detect(bitmap:Bitmap,includeImage:Boolean,hint:String):List<Card> {
    check(loaded) { "Card border detector could not start" }
    val options=JSONObject(hint)
    fun points(name:String):List<Point>? {
      val array=options.optJSONArray(name)?:return null
      if(array.length()!=4)return null
      return (0..3).map { i-> val p=array.getJSONObject(i);Point(p.getDouble("x"),p.getDouble("y")) }.takeIf { q->q.all { it.x.isFinite()&&it.y.isFinite()&&it.x in 0.0..1.0&&it.y in 0.0..1.0 } }
    }
    val guide=requireNotNull(points("guide"));val previous=points("previous");val target=previous?:guide
    val left=min(target.minOf { it.x },guide.minOf { it.x });val right=max(target.maxOf { it.x },guide.maxOf { it.x });val top=min(target.minOf { it.y },guide.minOf { it.y });val bottom=max(target.maxOf { it.y },guide.maxOf { it.y })
    val pad=if(previous==null).20 else if(options.optBoolean("redetect",true)).30 else .12
    val x0=max(0,((left-(right-left)*pad)*bitmap.width).toInt());val y0=max(0,((top-(bottom-top)*pad)*bitmap.height).toInt())
    val x1=min(bitmap.width,ceil((right+(right-left)*pad)*bitmap.width).toInt());val y1=min(bitmap.height,ceil((bottom+(bottom-top)*pad)*bitmap.height).toInt())
    if(x1-x0<40||y1-y0<60)return emptyList()
    val owned=mutableListOf<Mat>();fun mat()=Mat().also{owned.add(it)}
    val contours=mutableListOf<MatOfPoint>()
    try {
      val source=mat();Utils.bitmapToMat(bitmap,source)
      val region=Mat(source,Rect(x0,y0,x1-x0,y1-y0)).also { owned.add(it) }
      val scale=min(1.0,500.0/max(region.cols(),region.rows()))
      val small=mat();Imgproc.resize(region,small,Size(region.cols()*scale,region.rows()*scale))
      val gray=mat();Imgproc.cvtColor(small,gray,Imgproc.COLOR_RGBA2GRAY)
      val colors=ByteArray((small.total()*4).toInt());small.get(0,0,colors)
      fun local(q:List<Point>)=q.map { Point((it.x*bitmap.width-x0)*scale,(it.y*bitmap.height-y0)*scale) }
      val targetLocal=local(target);var selected:List<Point>?=null
      if(previous!=null&&!options.optBoolean("redetect",true)) {
        val predicted=refine(local(previous),colors,small.cols(),small.rows(),min(18.0,small.cols()*.05))
        val support=(0..3).map { edge(predicted[it],predicted[(it+1)%4],colors,small.cols(),small.rows()) }
        if(valid(predicted,small.cols(),small.rows())&&support.minOrNull()!!>12&&support.average()>22&&predicted.indices.all { distance(predicted[it],targetLocal[it])<small.rows()*.065 })selected=predicted
      }
      val proposals=mutableListOf<Pair<List<Point>,Boolean>>()
      if(selected!=null)proposals.add(selected!! to true)
      if(includeImage&&options.optBoolean("searchBorders",true)&&(selected==null||options.optBoolean("redetect",true))) {
        val smooth=mat();Imgproc.GaussianBlur(gray,smooth,Size(3.0,3.0),0.0)
        val edges=mat();Imgproc.Canny(smooth,edges,30.0,100.0)
        val kernel=Imgproc.getStructuringElement(Imgproc.MORPH_RECT,Size(3.0,3.0)).also{owned.add(it)}
        Imgproc.morphologyEx(edges,edges,Imgproc.MORPH_CLOSE,kernel)
        val candidates=mutableListOf<Candidate>()
        fun collect(mask:Mat) {
          contours.forEach{it.release()};contours.clear()
          val hierarchy=mat();Imgproc.findContours(mask,contours,hierarchy,Imgproc.RETR_TREE,Imgproc.CHAIN_APPROX_SIMPLE)
          val expected=area(targetLocal)
          for(contour in contours.sortedByDescending{Imgproc.contourArea(it)}.take(64)) {
            val size=abs(Imgproc.contourArea(contour))
            if(size !in expected*.20..expected*1.90)continue
            val curve=MatOfPoint2f(*contour.toArray());val approx=MatOfPoint2f()
            try {
              Imgproc.approxPolyDP(curve,approx,Imgproc.arcLength(curve,true)*.022,true)
              if(approx.total()!=4L)continue
              val polygon=MatOfPoint(*approx.toArray());val convex=try{Imgproc.isContourConvex(polygon)}finally{polygon.release()}
              if(!convex)continue
              val q=order(approx.toList());if(!valid(q,small.cols(),small.rows()))continue
              val ratio=(distance(q[0],q[1])+distance(q[3],q[2]))/(distance(q[0],q[3])+distance(q[1],q[2]))
              val movement=q.indices.sumOf { distance(q[it],targetLocal[it]) }/4/small.rows()
              val supports=(0..3).map{edge(q[it],q[(it+1)%4],colors,small.cols(),small.rows())}
              if(supports.minOrNull()!!<10||supports.average()<18)continue
              val score=1.2-abs(ln(size/expected))*.7-abs(ln(ratio/.716))*2.0-movement*(if(previous!=null)3.0 else 1.4)+min(.35,supports.average()/180)
              candidates.add(Candidate(q,size,score))
            }finally{curve.release();approx.release()}
          }
        }
        collect(edges)
        // Geometry proposes crops; only the picture matcher may choose a card.
        // Keep distinct nested borders instead of promoting the enclosing sleeve.
        for(candidate in candidates.sortedByDescending{it.score}) {
          if(proposals.any { (q,_)->q.indices.sumOf{distance(q[it],candidate.points[it])}/4<small.rows()*.018 })continue
          proposals.add(candidate.points to false)
          if(proposals.size>=3)break
        }
      }
      fun result(q:List<Point>,tracked:Boolean,sourceName:String):Card {
      val bounds=Rect(max(0,q.minOf{it.x}.toInt()),max(0,q.minOf{it.y}.toInt()),1,1)
      bounds.width=min(small.cols()-bounds.x,max(1,(q.maxOf{it.x}-bounds.x).toInt()));bounds.height=min(small.rows()-bounds.y,max(1,(q.maxOf{it.y}-bounds.y).toInt()))
      val focus=Mat(gray,bounds).also{owned.add(it)};val lap=mat();Imgproc.Laplacian(focus,lap,CvType.CV_64F)
      val mean=MatOfDouble().also{owned.add(it)};val std=MatOfDouble().also{owned.add(it)};Core.meanStdDev(lap,mean,std)
      val clear=std.toArray()[0].pow(2)>=35
      val corners=q.map{Point(it.x/scale+x0,it.y/scale+y0)}
      return Card(corners.map{Point(it.x/bitmap.width,it.y/bitmap.height)},clear,tracked,sourceName)
      }
      val results=proposals.map{(q,tracked)->result(q,tracked,if(tracked)"tracked" else "edge")}.toMutableList()
      // No border is required to read the guide's picture or collector text.
      results.add(result(local(guide),false,"guide"))
      return results
    }finally{contours.forEach{it.release()};owned.asReversed().forEach{it.release()}}
  }
  private data class Line(val x:Double,val y:Double,val dx:Double,val dy:Double)
  private fun refine(q:List<Point>,rgb:ByteArray,width:Int,height:Int,radius:Double):List<Point> {
    val lines=q.mapIndexed { i,p->
      val end=q[(i+1)%4];val length=distance(p,end);val base=atan2(end.y-p.y,end.x-p.x);val mx=(p.x+end.x)/2;val my=(p.y+end.y)/2
      var best=Line(mx,my,cos(base),sin(base));var score=edge(p,end,rgb,width,height)
      for(a in -2..2) {
        val angle=a*.025;val dx=cos(base+angle);val dy=sin(base+angle);val nx=-dy;val ny=dx
        for(offset in -radius.toInt()..radius.toInt() step 3) {
          val x=mx+nx*offset;val y=my+ny*offset
          val value=edge(Point(x-dx*length/2,y-dy*length/2),Point(x+dx*length/2,y+dy*length/2),rgb,width,height)-abs(offset)*.22-max(0,offset)*.18-abs(angle)*8
          if(value>score){score=value;best=Line(x,y,dx,dy)}
        }
      }
      best
    }
    val result=lines.mapIndexed { i,b->val a=lines[(i+3)%4];val det=a.dx*b.dy-a.dy*b.dx
      if(abs(det)<.1)q[i] else {val t=((b.x-a.x)*b.dy-(b.y-a.y)*b.dx)/det;Point(a.x+a.dx*t,a.y+a.dy*t)} }
    return if(valid(result,width,height)&&result.indices.all{distance(result[it],q[it])<radius*1.6})result else q
  }
  private fun edge(a:Point,b:Point,rgb:ByteArray,width:Int,height:Int):Double {
    val length=distance(a,b);if(length<1)return 0.0
    val nx=-(b.y-a.y)/length;val ny=(b.x-a.x)/length;var sum=0.0;var good=0
    fun color(x:Double,y:Double,c:Int)=rgb[(y.roundToInt()*width+x.roundToInt())*4+c].toInt() and 255
    for(j in 0..15) {
      val t=.10+j/15.0*.80;val x=a.x+(b.x-a.x)*t;val y=a.y+(b.y-a.y)*t
      if(x<4||y<4||x>=width-4||y>=height-4)continue
      val value=(0..2).sumOf{c->abs(color(x+nx*2,y+ny*2,c)-color(x-nx*2,y-ny*2,c)).toDouble()}/3
      sum+=min(100.0,value);if(value>12)good++
    }
    return sum/16*(good/16.0)
  }
  private fun valid(q:List<Point>,width:Int,height:Int):Boolean {
    if(q.any{!it.x.isFinite()||!it.y.isFinite()||it.x<2||it.y<2||it.x>width-3||it.y>height-3})return false
    val w=(distance(q[0],q[1])+distance(q[3],q[2]))/2;val h=(distance(q[0],q[3])+distance(q[1],q[2]))/2
    if(w/h !in .55.. .86||w<45||h<65)return false
    return (0..3).all { i->val a=q[(i+3)%4];val b=q[i];val c=q[(i+1)%4];(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)>0&&abs(((a.x-b.x)*(c.x-b.x)+(a.y-b.y)*(c.y-b.y))/(distance(a,b)*distance(c,b)))<.60 }
  }
  private fun inside(inner:List<Point>,outer:List<Point>):Boolean=inner.all { p->(0..3).all { i->val a=outer[i];val b=outer[(i+1)%4];(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>=-2 } }
  private fun area(q:List<Point>)=abs(q.indices.sumOf{q[it].x*q[(it+1)%4].y-q[(it+1)%4].x*q[it].y})/2
  private fun distance(a:Point,b:Point)=hypot(a.x-b.x,a.y-b.y)
  private fun order(points:List<Point>):List<Point>{val cx=points.sumOf{it.x}/4;val cy=points.sumOf{it.y}/4;val sorted=points.sortedBy{atan2(it.y-cy,it.x-cx)};val start=sorted.indices.minBy{sorted[it].x+sorted[it].y};return(0..3).map{sorted[(start+it)%4]}}
}
