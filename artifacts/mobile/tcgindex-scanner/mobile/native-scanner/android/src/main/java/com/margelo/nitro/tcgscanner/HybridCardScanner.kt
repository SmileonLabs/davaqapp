package com.margelo.nitro.tcgscanner

import com.margelo.nitro.camera.HybridCameraOutputSpec

class HybridCardScanner : HybridCardScannerSpec() {
  override fun createOutput(): HybridCameraOutputSpec = NativeCardOutput()
}
