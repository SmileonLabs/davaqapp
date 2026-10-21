package org.tcgindex.scanner

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.margelo.nitro.tcgscanner.CardVisionEngine
import com.margelo.nitro.tcgscanner.CompactCardIndex

class CardVisionModule(private val context: ReactApplicationContext): ReactContextBaseJavaModule(context) {
  private val ui = Handler(Looper.getMainLooper())
  init {
    System.loadLibrary("TCGScanner")
    CardVisionEngine.onEvent = { event -> if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("TCGCardVision", map(event)) }
    CardVisionEngine.onQuad = { points, confirmed ->
      val values = points.flatMap { listOf(it.x,it.y) }.toDoubleArray()
      ui.post { CardOutlineView.applyNative(values,confirmed) }
    }
  }
  override fun getName() = "TCGCardVision"
  private fun map(e: CardVisionEngine.Event) = Arguments.createMap().apply {
    putString("id",e.id);putBoolean("confirmed",e.confirmed);putBoolean("searched",e.searched);putInt("inliers",e.inliers)
    putDouble("coverage",e.coverage);putDouble("processingMs",e.processingMs);putDouble("trackingMs",e.trackingMs)
    putDouble("retrievalMs",e.retrievalMs);putDouble("verificationMs",e.verificationMs)
    putInt("ready",e.ready);putString("message",e.message)
    putInt("frames",e.frames)
    putString("cardsJson",e.cardsJson);putDouble("similarity",e.similarity);putDouble("ocrMs",e.ocrMs)
    putArray("ids",Arguments.fromList(e.ids))
    putArray("corners",Arguments.createArray().apply {
      e.corners.forEach { point -> pushMap(Arguments.createMap().apply { putDouble("x",point.x);putDouble("y",point.y) }) }
    })
  }
  @ReactMethod fun configure(paths:ReadableArray,ids:ReadableArray,promise:Promise) {
    CardVisionEngine.configure(paths.toArrayList().map { it as String },ids.toArrayList().map { it as String }.toSet(), { promise.resolve(it) }, { promise.reject("E_FEATURES",it) })
  }
  private fun part(value:ReadableMap)=CompactCardIndex.Part(requireNotNull(value.getString("path")),requireNotNull(value.getString("sha256")),value.getDouble("bytes").toLong())
  @ReactMethod fun configureCompact(files:ReadableMap,language:String,promise:Promise) {
    try{CardVisionEngine.configureCompact(listOf("model","index","cards","prices").map {part(requireNotNull(files.getMap(it)))},language,{promise.resolve(it)},{promise.reject("E_COMPACT",it)})}
    catch(error:Exception){promise.reject("E_COMPACT",error.message,error)}
  }
  @ReactMethod fun verifyCompactPart(value:ReadableMap,promise:Promise) {
    try{CardVisionEngine.verifyCompact(part(value),{promise.resolve(null)},{promise.reject("E_COMPACT",it)})}
    catch(error:Exception){promise.reject("E_COMPACT",error.message,error)}
  }
  @ReactMethod fun setEnabled(enabled:Boolean) { CardVisionEngine.setEnabled(enabled) }
  @ReactMethod fun setViewport(width:Double,height:Double) { CardVisionEngine.viewWidth=width;CardVisionEngine.viewHeight=height }
  @ReactMethod fun analyzePhoto(path:String,width:Double,height:Double,promise:Promise) {
    CardVisionEngine.photo(path.removePrefix("file://"),width,height) { e -> if(e.message.isNotEmpty())promise.reject("E_PHOTO",e.message) else promise.resolve(map(e)) }
  }
  @ReactMethod fun addListener(name:String) {}
  @ReactMethod fun removeListeners(count:Int) {}
  override fun invalidate() { CardVisionEngine.setEnabled(false);CardVisionEngine.onEvent=null;CardVisionEngine.onQuad=null;super.invalidate() }
}
