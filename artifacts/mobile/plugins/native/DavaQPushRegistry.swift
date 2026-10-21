import Foundation
import PushKit
import UIKit

// Starts before React: a VoIP push must report CallKit immediately, even when
// JavaScript is suspended or has not started. No FCM silent-push dependency.
@objc(DavaQPushRegistry)
final class DavaQPushRegistry: NSObject, PKPushRegistryDelegate {
  @objc static let shared = DavaQPushRegistry()
  private var registry: PKPushRegistry?
  @objc var tokenHandler: ((String?) -> Void)?
  private let defaults = UserDefaults.standard
  private let ownerKey = "DavaQPushOwner"
  private let tokenKey = "DavaQVoipToken"
  @objc var token: String? { defaults.string(forKey: tokenKey) }
  @objc var environment: String {
#if DEBUG
    return "sandbox"
#else
    return "production"
#endif
  }
  @objc func start() {
    guard registry == nil else { return }
    let registry = PKPushRegistry(queue: .main)
    self.registry = registry
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
  }
  @objc func setOwner(_ owner: String?) {
    if let owner = owner, !owner.isEmpty { defaults.set(owner, forKey: ownerKey) }
    else { defaults.removeObject(forKey: ownerKey) }
  }
  @objc func clearOwner(_ owner: String) {
    if defaults.string(forKey: ownerKey) == owner { defaults.removeObject(forKey: ownerKey) }
  }
  @objc func handleRemoteNotification(_ data: [AnyHashable: Any]) -> Bool {
    let statuses = ["call_ended", "call_declined", "call_missed", "call_cancelled", "call_failed"]
    guard let type = data["type"] as? String, statuses.contains(type),
          let owner = defaults.string(forKey: ownerKey), owner == (data["recipientUserId"] as? String),
          let id = data["callId"] as? String else { return false }
    DavaQSystemCallManager.shared.end(id)
    return true
  }
  func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let value = credentials.token.map { String(format: "%02x", $0) }.joined()
    defaults.set(value, forKey: tokenKey)
    tokenHandler?(value)
  }
  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    defaults.removeObject(forKey: tokenKey)
    tokenHandler?(nil)
  }
  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    guard type == .voIP else { completion(); return }
    let data = payload.dictionaryPayload
    let rawId = data["callId"] as? String ?? ""
    let id = UUID(uuidString: rawId) != nil ? rawId : UUID().uuidString
    let expectedOwner = defaults.string(forKey: ownerKey)
    let matchingOwner = expectedOwner != nil && expectedOwner == (data["recipientUserId"] as? String)
    let rawDeadline = (data["expiresAt"] as? NSNumber)?.doubleValue ?? Double(data["expiresAt"] as? String ?? "") ?? 0
    let valid = matchingOwner && (data["type"] as? String) == "incoming_call" && rawDeadline > Date().timeIntervalSince1970 * 1000
    let intent: [String: Any] = [
      "callId": id,
      "callerName": valid ? (data["callerName"] as? String ?? "수신 전화") : "DavaQ",
      "chatRoomId": valid ? (data["chatRoomId"] as? String ?? "") : "",
      "media": valid ? (data["media"] as? String ?? "audio") : "audio",
      "expiresAt": valid ? rawDeadline : Date().timeIntervalSince1970 * 1000 + 1000
    ]
    // Every VoIP push must report a call. Stale/wrong-account payloads get a
    // generic call that is ended immediately, without exposing caller details.
    DavaQSystemCallManager.shared.reportIncoming(intent) { _ in
      if !valid { DavaQSystemCallManager.shared.end(id) }
      completion()
    }
  }
}
