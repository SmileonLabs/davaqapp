package __PACKAGE__.updates

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability

class DavaqPlayUpdateModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "DavaqPlayUpdate"
  @ReactMethod fun check(promise: Promise) {
    AppUpdateManagerFactory.create(reactApplicationContext).appUpdateInfo
      .addOnSuccessListener { info ->
        val result = Arguments.createMap()
        result.putBoolean("available", info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE)
        result.putInt("versionCode", info.availableVersionCode())
        promise.resolve(result)
      }
      .addOnFailureListener { error -> promise.reject("play_update_unavailable", error) }
  }
}
class DavaqPlayUpdatePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(DavaqPlayUpdateModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
