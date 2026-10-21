package org.tcgindex.scanner

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.util.Base64
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import com.facebook.react.bridge.Arguments
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.util.ReactFindViewUtil
import com.facebook.react.uimanager.ViewManager
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import android.graphics.Canvas
import android.graphics.Color
import org.opencv.android.Utils
import org.opencv.android.OpenCVLoader
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Core
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.io.ByteArrayOutputStream

class CardTextModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  private val japanese = TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
  private val worker = Executors.newSingleThreadExecutor()
  private val ocrWorker = Executors.newSingleThreadExecutor()
  private val busy = AtomicBoolean(false)
  private val ocrBusy = AtomicBoolean(false)
  override fun getName() = "TCGCardText"

  // Read the same transformed CameraX preview used by takeSnapshot, entirely
  // in native code. No full-preview JPEG or Base64 crosses JavaScript.
  @ReactMethod
  fun capturePreview(includeImage: Boolean, hint:String, promise: Promise) {
    if (!busy.compareAndSet(false, true)) { promise.reject("E_BUSY", "Card analysis is already running"); return }
    val started = SystemClock.elapsedRealtime()
    UiThreadUtil.runOnUiThread {
      var captured: Bitmap? = null
      try {
        val root = requireNotNull(reactApplicationContext.currentActivity).window.decorView
        val tagged = requireNotNull(ReactFindViewUtil.findView(root,"tcgindex-camera-preview"))
        fun preview(view: View): PreviewView? {
          if (view is PreviewView) return view
          if (view is ViewGroup) for (i in 0 until view.childCount) preview(view.getChildAt(i))?.let { return it }
          return null
        }
        val cameraView = requireNotNull(preview(tagged))
        check(cameraView.isShown) { "Camera preview is not visible" }
        val bitmap = requireNotNull(cameraView.bitmap); captured = bitmap
        worker.execute {
          var small: Bitmap? = null
          try {
            val maximum = if (includeImage) 1600.0 else 900.0
            val scale = minOf(1.0,maximum/maxOf(bitmap.width,bitmap.height))
            val input = if (scale<1) Bitmap.createScaledBitmap(bitmap,maxOf(1,(bitmap.width*scale).toInt()),maxOf(1,(bitmap.height*scale).toInt()),true) else bitmap
            if(input!==bitmap)small=input
            promise.resolve(analyzeBitmap(input,includeImage,started,hint))
          } catch(error:Exception) { promise.reject("E_CARD_BORDER",error.message,error) }
          finally { small?.recycle();bitmap.recycle();busy.set(false) }
        }
        captured = null
      } catch(error:Exception) { captured?.recycle();busy.set(false);promise.reject("E_PREVIEW",error.message,error) }
    }
  }

  private fun analyzeBitmap(bitmap:Bitmap,includeImage:Boolean,started:Long,hint:String):WritableMap {
    // detect initializes OpenCV before any Mat JNI call on a cold app start.
    val detected=CardQuadDetector.detect(bitmap,includeImage,hint)
    val source=Mat()
    try {
      val result=Arguments.createMap()
      val candidates=Arguments.createArray()
      if(includeImage)Utils.bitmapToMat(bitmap,source)
      for(card in detected){
        val region=Arguments.createMap()
        val points=Arguments.createArray()
        for(p in card.corners)points.pushMap(Arguments.createMap().apply{putDouble("x",p.x);putDouble("y",p.y)})
        region.putArray("corners",points);region.putBoolean("clear",card.clear);region.putBoolean("tracked",card.tracked);region.putString("source",card.source)
        if(includeImage)encodeRegion(source,bitmap.width,bitmap.height,card,region)
        candidates.pushMap(region)
      }
      result.putArray("candidates",candidates)
      result.putDouble("detectionMs",(SystemClock.elapsedRealtime()-started).toDouble())
      return result
    }finally{source.release()}
  }

  private fun encodeRegion(source:Mat,width:Int,height:Int,card:CardQuadDetector.Card,result:WritableMap) {
    val from=MatOfPoint2f(*card.corners.map{Point(it.x*width,it.y*height)}.toTypedArray())
    val to=MatOfPoint2f(Point(0.0,0.0),Point(223.0,0.0),Point(223.0,223.0),Point(0.0,223.0))
    val modelTransform=Imgproc.getPerspectiveTransform(from,to)
    val pixels=Mat();val footerPixels=Mat();var footer:Bitmap?=null
    val footerTo=MatOfPoint2f(Point(0.0,0.0),Point(959.0,0.0),Point(959.0,1341.0),Point(0.0,1341.0))
    val footerTransform=Imgproc.getPerspectiveTransform(from,footerTo)
    try {
      // Warp directly to model pixels; avoid constructing a full 960x1342 card
      // for every proposal. OCR needs only its lower 40%.
      Imgproc.warpPerspective(source,pixels,modelTransform,Size(224.0,224.0),Imgproc.INTER_LINEAR,Core.BORDER_REPLICATE)
      val rgba=ByteArray(224*224*4);pixels.get(0,0,rgba);val rgb=ByteArray(224*224*3)
      for(i in 0 until 224*224)for(c in 0..2)rgb[i*3+c]=rgba[i*4+c]
      result.putString("rgb",Base64.encodeToString(rgb,Base64.NO_WRAP))
      for(c in 0..2)footerTransform.put(1,c,footerTransform.get(1,c)[0]-805.0*footerTransform.get(2,c)[0])
      Imgproc.warpPerspective(source,footerPixels,footerTransform,Size(960.0,537.0),Imgproc.INTER_LINEAR,Core.BORDER_REPLICATE)
      val lower=Bitmap.createBitmap(960,537,Bitmap.Config.ARGB_8888);footer=lower;Utils.matToBitmap(footerPixels,lower)
      val stream=ByteArrayOutputStream();lower.compress(Bitmap.CompressFormat.JPEG,95,stream)
      result.putString("footer",Base64.encodeToString(stream.toByteArray(),Base64.NO_WRAP))
    }finally{footer?.recycle();pixels.release();footerPixels.release();modelTransform.release();footerTransform.release();from.release();to.release();footerTo.release()}
  }

  @ReactMethod
  fun detectCard(encoded: String, includeImage: Boolean, hint:String, promise: Promise) {
    if (!busy.compareAndSet(false, true)) { promise.reject("E_BUSY", "Card analysis is already running"); return }
    worker.execute {
      var source: Bitmap? = null
      try {
        val started = SystemClock.elapsedRealtime()
        require(encoded.length <= 8_000_000) { "Preview image is too large" }
        val bytes = Base64.decode(encoded, Base64.DEFAULT)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
        require(bounds.outWidth in 1..2400 && bounds.outHeight in 1..2400) { "Invalid preview dimensions" }
        val bitmap = requireNotNull(BitmapFactory.decodeByteArray(bytes,0,bytes.size))
        source = bitmap
        val result = analyzeBitmap(bitmap,includeImage,started,hint)
        busy.set(false)
        promise.resolve(result)
      } catch (error: Exception) { busy.set(false); promise.reject("E_CARD_BORDER",error.message,error) }
      finally { source?.recycle() }
    }
  }

  @ReactMethod
  fun recognizeImage(encoded: String, promise: Promise) {
    if (!ocrBusy.compareAndSet(false, true)) { promise.reject("E_BUSY", "OCR is already running"); return }
    ocrWorker.execute {
      try {
        require(encoded.length <= 1_500_000) { "OCR image is too large" }
        val bytes = Base64.decode(encoded, Base64.DEFAULT)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        require(bounds.outWidth in 1..1400 && bounds.outHeight in 1..1400) { "Invalid OCR image dimensions" }
        val decoded = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size))
        // Enlarge only the collector strip. Upscaling an entire rules paragraph
        // leaves its tiny digits below the text detector's useful resolution.
        fun view(pass:Int):Bitmap {
          val top=when(pass){0,1->(decoded.height*.58).toInt();2->(decoded.height*.48).toInt();else->0}
          val width=when(pass){0,1->(decoded.width*.58).toInt();2->(decoded.width*.72).toInt();else->decoded.width}
          val crop=Bitmap.createBitmap(decoded,0,top,width,decoded.height-top)
          var prepared=crop
          if(pass==1) {
            check(OpenCVLoader.initLocal()) { "OCR contrast processor could not start" }
            // Local contrast restores tiny dark digits against foil/monitor glare.
            val rgba=Mat();val gray=Mat();val adjusted=Mat();val color=Mat()
            val clahe=Imgproc.createCLAHE(3.0,Size(8.0,4.0))
            try {
              Utils.bitmapToMat(crop,rgba);Imgproc.cvtColor(rgba,gray,Imgproc.COLOR_RGBA2GRAY)
              clahe.apply(gray,adjusted);Imgproc.cvtColor(adjusted,color,Imgproc.COLOR_GRAY2RGBA)
              prepared=Bitmap.createBitmap(crop.width,crop.height,Bitmap.Config.ARGB_8888);Utils.matToBitmap(color,prepared)
            }finally{rgba.release();gray.release();adjusted.release();color.release();clahe.collectGarbage()}
          }
          val scale=1280.0/crop.width
          val scaled=Bitmap.createScaledBitmap(prepared,1280,maxOf(1,(crop.height*scale).toInt()),true)
          if(prepared!==crop && prepared!==scaled)prepared.recycle()
          if(crop!==decoded && crop!==scaled)crop.recycle()
          val padded=Bitmap.createBitmap(scaled.width+48,scaled.height+48,Bitmap.Config.ARGB_8888)
          Canvas(padded).apply { drawColor(Color.WHITE);drawBitmap(scaled,24f,24f,null) }
          if(scaled!==decoded)scaled.recycle()
          return padded
        }
        fun hasNumber(text:String)=Regex("[0-9OIlB]{2,3}\\s*[/／⁄|\\-]\\s*[0-9OIlB]{2,3}",RegexOption.IGNORE_CASE).containsMatchIn(text)
        val readings=mutableListOf<String>()
        fun read(pass:Int) {
          try {
          val bitmap=view(pass)
          val reader=if(pass==2)japanese else recognizer
          reader.process(InputImage.fromBitmap(bitmap,0)).addOnCompleteListener(ocrWorker) { task ->
            bitmap.recycle()
            if(task.isSuccessful)readings.add(task.result.text)
            val text=if(task.isSuccessful)task.result.text else ""
            if(hasNumber(text)||pass==3) {
              decoded.recycle();ocrBusy.set(false)
              if(readings.isNotEmpty())promise.resolve(if(hasNumber(text))text else readings.joinToString("\n"))
              else promise.reject("E_OCR",task.exception?.message,task.exception)
            } else read(pass+1)
          }
          }catch(error:Exception){decoded.recycle();ocrBusy.set(false);promise.reject("E_OCR",error.message,error)}
        }
        read(0)
      } catch (error: Exception) {
        ocrBusy.set(false)
        promise.reject("E_OCR", error.message, error)
      }
    }
  }

  override fun invalidate() {
    recognizer.close()
    japanese.close()
    worker.shutdown()
    ocrWorker.shutdown()
    super.invalidate()
  }
}

class CardTextPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(CardTextModule(context), CardVisionModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = listOf(CardOutlineManager())
}
