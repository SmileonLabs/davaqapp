import Foundation
import CallKit
import AVFAudio

// Owns the OS call UI. Server-authoritative accept/join still happens in JS.
@objc(DavaQSystemCallManager)
final class DavaQSystemCallManager: NSObject, CXProviderDelegate {
  @objc static let shared = DavaQSystemCallManager()
  private let provider: CXProvider
  private var intents: [UUID: [String: Any]] = [:]
  private var endedCalls: [UUID: Date] = [:]
  private var answered = Set<UUID>()
  private let controller = CXCallController()
  private var appAnswers = Set<UUID>()
  private var timers: [UUID: DispatchWorkItem] = [:]
  private var queuedEvents: [[String: Any]] = []
  @objc var eventHandler: (([String: Any]) -> Void)?

  override private init() {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = true
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    provider = CXProvider(configuration: configuration)
    super.init()
    provider.setDelegate(self, queue: .main)
  }

  @objc func reportIncoming(_ intent: [String: Any], completion: @escaping (String?) -> Void) {
    guard let id = intent["callId"] as? String, let uuid = UUID(uuidString: id) else {
      completion("invalid_call_id"); return
    }
    endedCalls = endedCalls.filter { Date().timeIntervalSince($0.value) < 90 }
    if endedCalls[uuid] != nil { completion("ended_call"); return }
    if intents[uuid] != nil { completion(nil); return }
    let deadline = (intent["expiresAt"] as? NSNumber)?.doubleValue ?? (Date().timeIntervalSince1970 * 1000 + 45000)
    let remaining = deadline / 1000 - Date().timeIntervalSince1970
    guard remaining > 0 else { completion("expired_call"); return }
    // Reserve before the async report to deduplicate concurrent push deliveries.
    intents[uuid] = intent
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: intent["callerName"] as? String ?? "DavaQ")
    update.localizedCallerName = intent["callerName"] as? String ?? "수신 전화"
    update.hasVideo = intent["media"] as? String == "video"
    update.supportsDTMF = false
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    provider.reportNewIncomingCall(with: uuid, update: update) { error in
      DispatchQueue.main.async {
        if let error = error {
          self.intents.removeValue(forKey: uuid)
          completion(error.localizedDescription)
          return
        }
        guard self.intents[uuid] != nil else {
          self.provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
          completion("cancelled_call"); return
        }
        let timer = DispatchWorkItem { [weak self] in
          guard let self = self, !self.answered.contains(uuid), self.intents[uuid] != nil else { return }
          self.end(id)
        }
        self.timers[uuid] = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, deadline / 1000 - Date().timeIntervalSince1970), execute: timer)
        completion(nil)
      }
    }
  }

  @objc func markActive(_ id: String, completion: @escaping (String?) -> Void) {
    guard let uuid = UUID(uuidString: id), intents[uuid] != nil else { completion(nil); return }
    if answered.contains(uuid) || appAnswers.contains(uuid) { completion(nil); return }
    appAnswers.insert(uuid)
    controller.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { error in
      DispatchQueue.main.async {
        if let error = error { self.appAnswers.remove(uuid); completion(error.localizedDescription) }
        else { completion(nil) }
      }
    }
  }

  @objc func end(_ id: String) {
    guard let uuid = UUID(uuidString: id) else { return }
    endedCalls[uuid] = Date()
    guard intents.removeValue(forKey: uuid) != nil else { return }
    timers.removeValue(forKey: uuid)?.cancel()
    answered.remove(uuid)
    appAnswers.remove(uuid)
    provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
  }

  @objc func endAll() {
    for uuid in Array(intents.keys) { end(uuid.uuidString) }
    queuedEvents.removeAll()
  }

  @objc func drainEvents() -> [[String: Any]] {
    let events = queuedEvents
    queuedEvents.removeAll()
    return events
  }

  private func emit(_ action: String, uuid: UUID, extras: [String: Any] = [:]) {
    guard let intent = intents[uuid] else { return }
    var event: [String: Any] = ["action": action, "intent": intent]
    extras.forEach { event[$0.key] = $0.value }
    if let handler = eventHandler { handler(event) }
    else { queuedEvents.append(event) }
  }

  func providerDidReset(_ provider: CXProvider) {
    for uuid in Array(intents.keys) { emit("end", uuid: uuid) }
    timers.values.forEach { $0.cancel() }
    timers.removeAll(); answered.removeAll(); appAnswers.removeAll(); intents.removeAll()
  }

  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard intents[action.callUUID] != nil else { action.fail(); return }
    timers.removeValue(forKey: action.callUUID)?.cancel()
    answered.insert(action.callUUID)
    if appAnswers.remove(action.callUUID) == nil { emit("accept", uuid: action.callUUID) }
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    guard intents[action.callUUID] != nil else { action.fulfill(); return }
    emit(answered.contains(action.callUUID) ? "end" : "decline", uuid: action.callUUID)
    timers.removeValue(forKey: action.callUUID)?.cancel()
    answered.remove(action.callUUID)
    appAnswers.remove(action.callUUID)
    intents.removeValue(forKey: action.callUUID)
    endedCalls[action.callUUID] = Date()
    action.fulfill()
  }

  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    guard intents[action.callUUID] != nil else { action.fail(); return }
    emit("mute", uuid: action.callUUID, extras: ["muted": action.isMuted])
    action.fulfill()
  }

  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    for uuid in answered { emit("audioActivated", uuid: uuid) }
  }
}
