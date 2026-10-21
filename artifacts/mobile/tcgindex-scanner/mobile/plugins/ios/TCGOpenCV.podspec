Pod::Spec.new do |s|
  s.name = 'TCGOpenCV'
  s.version = '4.13.0'
  s.summary = 'Official OpenCV iOS framework for TCGIndex native scanning'
  s.homepage = 'https://opencv.org'
  s.license = { :type => 'Apache-2.0' }
  s.author = 'OpenCV'
  s.source = { :http => 'https://github.com/opencv/opencv/releases/download/4.13.0/opencv-4.13.0-ios-framework.zip' }
  s.platform = :ios, '16.4'
  s.vendored_frameworks = 'opencv2.framework'
  s.frameworks = 'Accelerate', 'AVFoundation', 'CoreMedia', 'CoreVideo', 'CoreGraphics', 'ImageIO', 'QuartzCore'
  s.libraries = 'c++', 'z'
end
