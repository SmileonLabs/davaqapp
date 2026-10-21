package com.margelo.nitro.tcgscanner

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import android.util.Size as AndroidSize
import com.margelo.nitro.camera.*
import com.margelo.nitro.camera.extensions.surfaceRotation
import com.margelo.nitro.camera.public.NativeCameraOutput
import java.util.concurrent.Executors

/** An independent CameraX analysis use case, bound by VisionCamera's session. */
class NativeCardOutput:HybridCameraOutputSpec(),NativeCameraOutput {
  private val executor=Executors.newSingleThreadExecutor()
  private var analysis:ImageAnalysis?=null
  override val mediaType=MediaType.VIDEO
  override var mirrorMode=MirrorMode.AUTO
  override var outputOrientation=CameraOrientation.UP
    set(value){field=value;analysis?.targetRotation=value.surfaceRotation}
  override val currentResolution:Size?
    get()=analysis?.resolutionInfo?.resolution?.let{Size(it.width.toDouble(),it.height.toDouble())}
  override fun createUseCase(mirrorMode:MirrorMode,config:NativeCameraOutput.Config):NativeCameraOutput.PreparedUseCase {
    this.mirrorMode=mirrorMode
    val selector=ResolutionSelector.Builder().setResolutionStrategy(ResolutionStrategy(AndroidSize(1280,720),ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()
    val output=ImageAnalysis.Builder().setResolutionSelector(selector)
      .setTargetRotation(outputOrientation.surfaceRotation)
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888).build()
    return NativeCameraOutput.PreparedUseCase(output){
      analysis?.clearAnalyzer()
      analysis=output
      output.setAnalyzer(executor){image->
        try{CardVisionEngine.accept(image,false,CardVisionEngine.viewWidth,CardVisionEngine.viewHeight)}finally{image.close()}
      }
    }
  }
  override fun dispose(){analysis?.clearAnalyzer();executor.shutdown();super.dispose()}
}
