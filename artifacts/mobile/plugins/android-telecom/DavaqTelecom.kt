
package __PACKAGE__.telecom

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.net.Uri
import android.media.Ringtone
import android.media.RingtoneManager
import android.graphics.Color
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Button
import android.os.*
import android.telecom.DisconnectCause
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.telecom.*
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** All call state changes run on Main. Persistent actions are scoped to the push owner. */
object CallStore {
    var react: ReactApplicationContext? = null
    var service: DavaqCallService? = null
    val ready = mutableMapOf<String, CompletableDeferred<Unit>>()
    fun prefs(c: Context) = c.getSharedPreferences("davaq_android_calls_v1", Context.MODE_PRIVATE)
    @Synchronized fun tombstone(c: Context, id: String) {
        val p = prefs(c); val edit = p.edit()
        p.all.filterKeys { it.startsWith("ended:") }.forEach { (k, v) ->
            if ((v as? Long ?: 0L) < System.currentTimeMillis()) edit.remove(k)
        }
        edit.putLong("ended:" + id, System.currentTimeMillis() + 120_000).commit()
    }
    fun ended(c: Context, id: String) = prefs(c).getLong("ended:" + id, 0) > System.currentTimeMillis()
    @Synchronized fun actions(c: Context): JSONArray {
        val now = System.currentTimeMillis()
        val raw = runCatching { JSONArray(prefs(c).getString("actions", "[]")) }.getOrDefault(JSONArray())
        val result = JSONArray()
        for (i in 0 until raw.length()) {
            val action = raw.optJSONObject(i) ?: continue
            if (action.optLong("expiresAt") > now) result.put(action)
        }
        return result
    }
    @Synchronized fun action(c: Context, descriptor: JSONObject, action: String) {
        val list = actions(c)
        for (i in 0 until list.length()) {
            val item = list.getJSONObject(i)
            if (item.optString("callId") == descriptor.optString("callId") && item.optString("action") == action) return
        }
        val value = JSONObject(descriptor.toString()).put("id", UUID.randomUUID().toString())
            .put("action", action).put("expiresAt", System.currentTimeMillis() + if (action == "accept") 45_000 else 300_000)
        list.put(value)
        check(prefs(c).edit().putString("actions", list.toString()).commit()) { "Cannot persist call action" }
        emit("action", descriptor.optString("callId"))
    }
    @Synchronized fun ack(c: Context, actionId: String) {
        val before = actions(c); val after = JSONArray()
        for (i in 0 until before.length()) if (before.getJSONObject(i).optString("id") != actionId) after.put(before.getJSONObject(i))
        prefs(c).edit().putString("actions", after.toString()).commit()
    }
    fun emit(kind: String, callId: String, value: String = "") {
        val context = react ?: return
        if (!context.hasActiveReactInstance()) return
        val map = Arguments.createMap().apply { putString("kind", kind); putString("callId", callId); putString("value", value) }
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("DavaqTelecom", map)
    }
}

class DavaqCallService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var manager: CallsManager
    private var descriptor: JSONObject? = null
    private var control: CallControlScope? = null
    private var endpoints: List<CallEndpointCompat> = emptyList()
    private var currentEndpoint = ""
    private var active = false
    private var mediaStarted = false
    private var videoStarted = false
    private var ringtone: Ringtone? = null
    private var expiry: Job? = null
    private var callJob: Job? = null
    private val id: String get() = descriptor?.optString("callId") ?: ""
    private val callType: Int get() = if (descriptor?.optString("media") == "video") CallAttributesCompat.CALL_TYPE_VIDEO_CALL else CallAttributesCompat.CALL_TYPE_AUDIO_CALL
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        CallStore.service = this
        manager = CallsManager(this)
        // Registration errors are handled by startCall.
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel("davaq-telecom", "DavaQ 통화", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "전화 수신과 진행 중인 통화"; lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            setSound(null, null); enableVibration(true)
        })
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) { stopSelf(); return START_NOT_STICKY }
        val raw = intent.getStringExtra("descriptor")
        if (raw != null) {
            val next = runCatching { JSONObject(raw) }.getOrNull()
            if (next != null) startCall(next)
        }
        val action = intent.getStringExtra("action")
        val target = intent.getStringExtra("callId")
        if (action != null && target == id) requestAction(action)
        return START_NOT_STICKY
    }
    private fun startCall(next: JSONObject) {
        val nextId = next.optString("callId")
        if (nextId.isBlank() || CallStore.ended(this, nextId)) {
            CallStore.ready.remove(nextId)?.completeExceptionally(IllegalStateException("call_already_ended"))
            if (descriptor == null) stopSelf()
            return
        }
        if (descriptor != null) {
            if (id != nextId) CallStore.ready.remove(nextId)?.completeExceptionally(IllegalStateException("another_call_active"))
            else if (control != null) CallStore.ready[nextId]?.complete(Unit)
            return
        }
        descriptor = next
        val incoming = next.optString("direction") == "incoming"
        val expiresAt = next.optLong("expiresAt", System.currentTimeMillis() + 45_000)
        if (expiresAt <= System.currentTimeMillis()) { finishCall(nextId); return }
        try {
            manager.registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE or CallsManager.CAPABILITY_SUPPORTS_VIDEO_CALLING)
            showNotification()
        } catch (error: Exception) {
            CallStore.ready.remove(nextId)?.completeExceptionally(error); finishCall(nextId); return
        }
        expiry = scope.launch {
            delay((expiresAt - System.currentTimeMillis()).coerceIn(1L, 45_000L))
            if (!active && id == nextId) end(nextId, DisconnectCause.MISSED)
        }
        callJob = scope.launch {
            try {
                manager.addCall(
                    CallAttributesCompat(next.optString("callerName", "DavaQ"), Uri.fromParts("sip", nextId, null),
                        if (incoming) CallAttributesCompat.DIRECTION_INCOMING else CallAttributesCompat.DIRECTION_OUTGOING,
                        callType, 0), // Holding is deliberately not advertised until media hold is implemented.
                    onAnswer = {
                        check(id == nextId && !CallStore.ended(this@DavaqCallService, nextId))
                        CallStore.action(this@DavaqCallService, next, "accept")
                        active = true; awaitMedia(); showNotification()
                        // Android handles the system transaction. JS performs authenticated accept.
                    },
                    onDisconnect = {
                        CallStore.action(this@DavaqCallService, next, if (!active && incoming) "decline" else "end")
                        finishCall(nextId)
                    },
                    onSetActive = { CallStore.emit("resume", nextId) },
                    onSetInactive = { throw IllegalStateException("Hold is not supported") }
                ) {
                    control = this
                    CallStore.ready[nextId]?.complete(Unit)
                    launch { availableEndpoints.collect { endpoints = it; CallStore.emit("endpoints", nextId) } }
                    launch { currentCallEndpoint.collect { currentEndpoint = it.identifier.toString(); CallStore.emit("endpoints", nextId) } }
                    launch { isMuted.collect { CallStore.emit("mute", nextId, it.toString()) } }
                }
            } catch (error: Exception) {
                CallStore.ready[nextId]?.completeExceptionally(error)
                if (error !is CancellationException && id == nextId) {
                    CallStore.action(this@DavaqCallService, next, "end")
                    CallStore.emit("error", nextId, "system_call_failed")
                }
            } finally { if (id == nextId) finishCall(nextId) }
        }
    }
    suspend fun activate(target: String) {
        check(id == target) { "stale_call" }
        CallStore.ready[target]?.await()
        if (active) return
        val ctl = checkNotNull(control)
        val result = if (descriptor?.optString("direction") == "incoming") ctl.answer(callType) else ctl.setActive()
        check(result is CallControlResult.Success) { "system_call_activation_failed" }
        active = true; awaitMedia(); showNotification()
    }
    suspend fun end(target: String, cause: Int = DisconnectCause.LOCAL) {
        CallStore.tombstone(this, target)
        if (id != target) return
        runCatching { withTimeout(3_000) { control?.disconnect(DisconnectCause(cause)) } }
        finishCall(target)
    }
    private fun awaitMedia() {
        expiry?.cancel()
        val target = id
        expiry = scope.launch {
            delay(45_000)
            if (id == target && !mediaStarted) {
                descriptor?.let { CallStore.action(this@DavaqCallService, it, "end") }
                end(target)
            }
        }
    }
    fun mediaStarted(target: String, media: String) {
        check(target == id) { "stale_call" }
        check(active) { "system_call_not_active" }
        expiry?.cancel()
        mediaStarted = true
        videoStarted = media == "video"
        showNotification()
    }
    fun dismissRinging(target: String) {
        if (id == target && !active) {
            // Accepting in JS hides the incoming style but keeps the Telecom call alive.
            descriptor?.put("joining", true)
            showNotification()
        }
    }
    fun snapshot(): String {
        val json = JSONObject(descriptor?.toString() ?: "{}").put("callId", id).put("active", active).put("currentEndpoint", currentEndpoint)
        val list = JSONArray()
        endpoints.forEach { list.put(JSONObject().put("id", it.identifier.toString()).put("name", it.name.toString()).put("type", it.type)) }
        return json.put("endpoints", list).toString()
    }
    suspend fun route(target: String, endpoint: String) {
        check(target == id) { "stale_call" }
        val selected = endpoints.find { it.identifier.toString() == endpoint } ?: error("endpoint_unavailable")
        check(control?.requestEndpointChange(selected) is CallControlResult.Success) { "route_change_failed" }
    }
    fun requestAction(action: String) {
        val desc = descriptor ?: return
        if (action !in listOf("accept", "decline", "end")) return
        CallStore.action(this, desc, action)
        if (action == "accept") { dismissRinging(id); return }
        val target = id
        scope.launch { end(target, if (action == "decline") DisconnectCause.REJECTED else DisconnectCause.LOCAL) }
    }
    private fun activityIntent(action: String): PendingIntent {
        val intent = Intent(this, DavaqCallActionActivity::class.java).apply {
            data = Uri.parse("davaq-call:" + Uri.encode(id) + "/" + action)
            putExtra("callId", id); putExtra("action", action)
        }
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private fun endIntent(): PendingIntent {
        val intent = Intent(this, DavaqCallReceiver::class.java).apply {
            data = Uri.parse("davaq-call:" + Uri.encode(id) + "/end")
            putExtra("callId", id); putExtra("action", if (active) "end" else "decline")
        }
        return PendingIntent.getBroadcast(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private fun showNotification() {
        val desc = descriptor ?: return
        val person = Person.Builder().setName(desc.optString("callerName", "DavaQ")).setImportant(true).build()
        val ringing = !active && !desc.optBoolean("joining") && desc.optString("direction") == "incoming"
        if (ringing && ringtone == null) {
            ringtone = runCatching { RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)).apply {
                if (Build.VERSION.SDK_INT >= 28) isLooping = true
                play()
            } }.getOrNull()
        } else if (!ringing) { ringtone?.stop(); ringtone = null }
        val builder = NotificationCompat.Builder(this, "davaq-telecom")
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle(desc.optString("callerName", "DavaQ"))
            .setContentText(if (ringing) "전화가 왔어요" else if (active) "통화 중" else "연결 중")
            .setContentIntent(activityIntent("open"))
            .setCategory(NotificationCompat.CATEGORY_CALL).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOngoing(true).setOnlyAlertOnce(true)
            .setStyle(if (ringing) NotificationCompat.CallStyle.forIncomingCall(person, endIntent(), activityIntent("accept"))
                else NotificationCompat.CallStyle.forOngoingCall(person, endIntent()))
        if (ringing) {
            builder.setTimeoutAfter((desc.optLong("expiresAt") - System.currentTimeMillis()).coerceAtLeast(1))
            if (Build.VERSION.SDK_INT < 34 || getSystemService(NotificationManager::class.java).canUseFullScreenIntent()) builder.setFullScreenIntent(activityIntent("open"), true)
        }
        if (Build.VERSION.SDK_INT >= 29) {
            var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            if (mediaStarted) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (videoStarted) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            startForeground(2720, builder.build(), types)
        } else startForeground(2720, builder.build())
    }
    private fun finishCall(target: String) {
        if (id != target) return
        CallStore.tombstone(this, target)
        CallStore.ready.remove(target)?.let { if (!it.isCompleted) it.completeExceptionally(IllegalStateException("call_ended")) }
        ringtone?.stop(); ringtone = null
        expiry?.cancel(); expiry = null
        descriptor = null; control = null; endpoints = emptyList(); active = false
        mediaStarted = false; videoStarted = false; currentEndpoint = ""
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
        CallStore.emit("ended", target)
    }
    override fun onDestroy() {
        val target = id
        descriptor?.let { runCatching { CallStore.action(this, it, "end") } }
        if (target.isNotEmpty()) finishCall(target)
        scope.cancel()
        if (CallStore.service === this) CallStore.service = null
        super.onDestroy()
    }
}

class DavaqCallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("callId") ?: return
        val service = CallStore.service ?: return
        val state = JSONObject(service.snapshot())
        if (state.optString("callId") == id) service.requestAction(intent.getStringExtra("action") ?: "end")
    }
}
class DavaqCallActionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra("callId")
        val service = CallStore.service
        val state = service?.let { JSONObject(it.snapshot()) }
        if (service == null || state == null || state.optString("callId") != id) { finish(); return }
        fun openApp() {
            packageManager.getLaunchIntentForPackage(packageName)?.let {
                startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            }
            finish()
        }
        if (intent.getStringExtra("action") == "accept") { service.requestAction("accept"); openApp(); return }
        if (state.optBoolean("active")) { openApp(); return }
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(48, 64, 48, 64); setBackgroundColor(Color.rgb(25, 19, 40))
        }
        layout.addView(TextView(this).apply {
            text = state.optString("callerName", "DavaQ"); textSize = 28f
            setTextColor(Color.WHITE); gravity = Gravity.CENTER
        })
        layout.addView(TextView(this).apply {
            text = "DavaQ 전화가 왔어요"; textSize = 18f; setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER; setPadding(0, 24, 0, 48)
        })
        layout.addView(Button(this).apply {
            text = "받기"; setOnClickListener { service.requestAction("accept"); openApp() }
        })
        layout.addView(Button(this).apply {
            text = "거절"; setOnClickListener { service.requestAction("decline"); finish() }
        })
        setContentView(layout)
        val handler = Handler(Looper.getMainLooper())
        handler.post(object : Runnable {
            override fun run() {
                if (isFinishing || isDestroyed) return
                if (CallStore.ended(this@DavaqCallActionActivity, id ?: "") || CallStore.service == null) finish()
                else handler.postDelayed(this, 500)
            }
        })
    }
}
class DavaqTelecomModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    override fun getName() = "DavaqTelecom"
    override fun initialize() { super.initialize(); CallStore.react = context }
    override fun invalidate() { if (CallStore.react === context) CallStore.react = null; scope.cancel(); super.invalidate() }
    private fun task(promise: Promise, action: suspend () -> Any?) { scope.launch { try { promise.resolve(action()) } catch (e: Exception) { promise.reject("ANDROID_CALL", e.message, e) } } }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
    @ReactMethod fun startCall(raw: String, promise: Promise) = task(promise) {
        val descriptor = JSONObject(raw); val id = descriptor.getString("callId")
        check(id.length in 1..128 && !CallStore.ended(context, id)) { "call_ended" }
        val ready = CallStore.ready.getOrPut(id) { CompletableDeferred() }
        val intent = Intent(context, DavaqCallService::class.java).putExtra("descriptor", raw)
        try {
            context.startForegroundService(intent)
            withTimeout(10_000) { ready.await() }
        } catch (e: Exception) {
            CallStore.tombstone(context, id)
            CallStore.ready.remove(id)?.completeExceptionally(e)
            CallStore.service?.end(id, DisconnectCause.LOCAL)
            throw e
        }
        null
    }
    @ReactMethod fun mediaStarted(id: String, media: String, promise: Promise) = task(promise) { checkNotNull(CallStore.service).mediaStarted(id, media); null }
    @ReactMethod fun activate(id: String, promise: Promise) = task(promise) { checkNotNull(CallStore.service).activate(id); null }
    @ReactMethod fun end(id: String, promise: Promise) = task(promise) { CallStore.tombstone(context, id); CallStore.service?.end(id); null }
    @ReactMethod fun dismiss(id: String, promise: Promise) = task(promise) { CallStore.service?.dismissRinging(id); null }
    @ReactMethod fun snapshot(promise: Promise) = task(promise) { CallStore.service?.snapshot() ?: "{}" }
    @ReactMethod fun selectEndpoint(id: String, endpoint: String, promise: Promise) = task(promise) { checkNotNull(CallStore.service).route(id, endpoint); null }
    @ReactMethod fun pendingActions(promise: Promise) = task(promise) { CallStore.actions(context).toString() }
    @ReactMethod fun acknowledge(id: String, promise: Promise) = task(promise) { CallStore.ack(context, id); null }
}
class DavaqTelecomPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(DavaqTelecomModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
