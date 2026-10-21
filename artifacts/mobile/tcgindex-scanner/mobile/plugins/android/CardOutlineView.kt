package org.tcgindex.scanner

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.Choreographer
import android.view.View
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import org.json.JSONArray
import kotlin.math.*
import java.lang.ref.WeakReference

class CardOutlineManager:SimpleViewManager<CardOutlineView>() {
  override fun getName()="TCGCardOutline"
  override fun createViewInstance(context:ThemedReactContext)=CardOutlineView(context)
  @ReactProp(name="corners") fun corners(view:CardOutlineView,value:String?){view.setCorners(value)}
  @ReactProp(name="confirmed") fun confirmed(view:CardOutlineView,value:Boolean){view.confirmed=value;view.invalidate()}
  @ReactProp(name="reduceMotion") fun reduceMotion(view:CardOutlineView,value:Boolean){view.reduceMotion=value;view.animateToTarget()}
}

/** One connected rounded path, animated on the UI thread independently of JS. */
class CardOutlineView(context:Context):View(context),Choreographer.FrameCallback {
  companion object {
    private var current = WeakReference<CardOutlineView>(null)
    fun applyNative(values:DoubleArray,found:Boolean) {
      val view=current.get()?:return
      if(values.isEmpty()){view.setGuide();return}
      if(values.size!=8||values.any{!it.isFinite()||it !in 0.0..1.0})return
      values.copyInto(view.normalized);view.confirmed=found;view.updateTarget()
    }
  }
  private val target=DoubleArray(8);private val position=DoubleArray(8);private val velocity=DoubleArray(8)
  private val normalized=DoubleArray(8);private var initialized=false;private var scheduled=false;private var lastFrame=0L
  private val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{style=Paint.Style.STROKE;strokeJoin=Paint.Join.ROUND;strokeCap=Paint.Cap.ROUND;strokeWidth=3*resources.displayMetrics.density}
  private val path=Path()
  private val shade=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=Color.argb(145,0,0,0);style=Paint.Style.FILL}
  private val mask=Path()
  var confirmed=false;var reduceMotion=false
  init{isClickable=false;importantForAccessibility=IMPORTANT_FOR_ACCESSIBILITY_NO}
  private fun setGuide(){
    if(width<=0||height<=0)return
    val w=min(width*.72,height*.62*.716);val h=w/.716;val cx=width/2.0;val cy=height*.51
    doubleArrayOf((cx-w/2)/width,(cy-h/2)/height,(cx+w/2)/width,(cy-h/2)/height,
      (cx+w/2)/width,(cy+h/2)/height,(cx-w/2)/width,(cy+h/2)/height).copyInto(normalized)
    confirmed=false;updateTarget()
  }
  fun setCorners(value:String?) {
    try{val q=JSONArray(value);if(q.length()!=4)return
      for(i in 0..3){val p=q.getJSONObject(i);val x=p.getDouble("x");val y=p.getDouble("y");if(!x.isFinite()||!y.isFinite()||x !in 0.0..1.0||y !in 0.0..1.0)return;normalized[i*2]=x;normalized[i*2+1]=y}
      updateTarget()
    }catch(_:Exception){}
  }
  override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int){super.onSizeChanged(w,h,oldw,oldh);initialized=false;updateTarget()}
  private fun updateTarget(){if(width==0||height==0)return;for(i in 0..7)target[i]=normalized[i]*(if(i%2==0)width else height)
    if(!initialized){target.copyInto(position);velocity.fill(0.0);initialized=true;invalidate()}else animateToTarget()}
  fun animateToTarget(){if(!initialized)return;if(reduceMotion){target.copyInto(position);velocity.fill(0.0);invalidate();return};if(isAttachedToWindow&&!scheduled){scheduled=true;lastFrame=0;Choreographer.getInstance().postFrameCallback(this)}}
  override fun onAttachedToWindow(){super.onAttachedToWindow();current=WeakReference(this);animateToTarget()}
  override fun onDetachedFromWindow(){if(current.get()===this)current.clear();Choreographer.getInstance().removeFrameCallback(this);scheduled=false;lastFrame=0;super.onDetachedFromWindow()}
  override fun doFrame(time:Long){scheduled=false;val dt=if(lastFrame==0L)1.0/60 else min(.032,(time-lastFrame)/1e9);lastFrame=time;var moving=false
    for(i in 0..7){val diff=target[i]-position[i];if(abs(diff)<.15&&abs(velocity[i])<.3){position[i]=target[i];velocity[i]=0.0}else{val stiffness=240.0;velocity[i]+=(stiffness*diff-19*velocity[i])*dt;position[i]+=velocity[i]*dt;moving=true}}
    invalidate();if(moving&&!reduceMotion&&isAttachedToWindow){scheduled=true;Choreographer.getInstance().postFrameCallback(this)}
  }
  override fun onDraw(canvas:Canvas){super.onDraw(canvas);if(!initialized)return;path.reset();val radius=12*resources.displayMetrics.density
    fun near(i:Int,j:Int):Pair<Float,Float>{val x=position[i*2];val y=position[i*2+1];val dx=position[j*2]-x;val dy=position[j*2+1]-y;val k=min(radius.toDouble(),hypot(dx,dy)*.18)/max(1.0,hypot(dx,dy));return Pair((x+dx*k).toFloat(),(y+dy*k).toFloat())}
    for(i in 0..3){val before=near(i,(i+3)%4);val after=near(i,(i+1)%4);if(i==0)path.moveTo(before.first,before.second)else path.lineTo(before.first,before.second);path.quadTo(position[i*2].toFloat(),position[i*2+1].toFloat(),after.first,after.second)}
    path.close();mask.reset();mask.fillType=Path.FillType.EVEN_ODD;mask.addRect(0f,0f,width.toFloat(),height.toFloat(),Path.Direction.CW);mask.addPath(path);canvas.drawPath(mask,shade)
    paint.color=Color.parseColor(if(confirmed)"#ffcf57" else "#ff2638");canvas.drawPath(path,paint)
  }
}
