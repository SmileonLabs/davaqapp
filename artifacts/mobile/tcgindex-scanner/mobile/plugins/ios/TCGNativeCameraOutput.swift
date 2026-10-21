import AVFoundation
import VisionCamera

// One output connected to VisionCamera's existing session; no second camera session.
final class TCGNativeCameraOutput: HybridCameraOutputSpec, NativeCameraOutput {
  let output = AVCaptureVideoDataOutput()
  let mediaType: MediaType = .video
  let requiresAudioInput = false
  let requiresDepthFormat = false
  let streamType: StreamType = .video
  let targetResolution: ResolutionRule = .closestTo(Size(width: 1280, height: 720))
  private let delegate = TCGFrameDelegate()
  private let queue = DispatchQueue(label: "org.tcgindex.scanner.frames", qos: .userInteractive)
  var currentResolution: Size? {
    guard let port = output.connection(with: .video)?.inputPorts.first,
          let description = port.formatDescription else { return nil }
    let size = CMVideoFormatDescriptionGetDimensions(description)
    return Size(width: Double(size.width), height: Double(size.height))
  }
  var outputOrientation: CameraOrientation = .up { didSet { applyOrientation() } }
  override init() {
    super.init()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    output.alwaysDiscardsLateVideoFrames = true
    output.automaticallyConfiguresOutputBufferDimensions = false
    output.setSampleBufferDelegate(delegate, queue: queue)
  }
  private func applyOrientation() {
    guard let connection = output.connection(with: .video) else { return }
    let angle: CGFloat
    switch outputOrientation {
    case .up: angle = 90
    case .right: angle = 180
    case .down: angle = 270
    case .left: angle = 0
    @unknown default: angle = 90
    }
    if #available(iOS 17.0, *) {
      if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
    } else if connection.isVideoOrientationSupported {
      switch outputOrientation {
      case .up: connection.videoOrientation = .portrait
      case .right: connection.videoOrientation = .landscapeLeft
      case .down: connection.videoOrientation = .portraitUpsideDown
      case .left: connection.videoOrientation = .landscapeRight
      @unknown default: connection.videoOrientation = .portrait
      }
    }
  }
  func configure(config: OutputConfiguration) {
    applyOrientation()
    if let connection = output.connection(with: .video), connection.isVideoMirroringSupported {
      connection.automaticallyAdjustsVideoMirroring = false
      connection.isVideoMirrored = false // scanner uses the back camera
    }
  }
  func dispose() { output.setSampleBufferDelegate(nil, queue: nil) }
}
private final class TCGFrameDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    TCGScannerSubmitFrame(buffer)
  }
}
@objc(TCGNativeOutputFactory)
final class TCGNativeOutputFactory: NSObject {
  @objc static func makeOutput() -> UnsafeMutableRawPointer {
    TCGNativeCameraOutput().getCxxWrapper().toUnsafe()
  }
}
