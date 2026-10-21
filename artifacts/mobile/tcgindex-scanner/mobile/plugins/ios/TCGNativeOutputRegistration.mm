#import <Foundation/Foundation.h>
#import <NitroModules/HybridObjectRegistry.hpp>
#import "HybridCameraOutputSpecSwift.hpp"
#import <NitroModules/ArrayBuffer.hpp>
#import "TCGScannerPipeline.h"

class TCGNativeInputs: public margelo::nitro::HybridObject {
public:
  TCGNativeInputs(): HybridObject("TCGNativeInputs") {}
  std::shared_ptr<margelo::nitro::ArrayBuffer> read(const std::string& token) {
    NSData *data=TCGScannerCopyInput([NSString stringWithUTF8String:token.c_str()]);
    if(!data || data.length!=224*224*3*sizeof(float))throw std::runtime_error("Scanner input expired");
    return margelo::nitro::ArrayBuffer::copy((const uint8_t *)data.bytes,data.length);
  }
protected:
  void loadHybridMethods() override {
    HybridObject::loadHybridMethods();
    registerHybrids(this, [](margelo::nitro::Prototype& prototype) { prototype.registerHybridMethod("read", &TCGNativeInputs::read); });
  }
};
@interface TCGNativeOutputFactory : NSObject
+ (void *)makeOutput;
@end
@interface TCGNativeOutputRegistration : NSObject
@end
@implementation TCGNativeOutputRegistration
+ (void)load {
  margelo::nitro::HybridObjectRegistry::registerHybridObjectConstructor("TCGNativeInputs", []() { return std::make_shared<TCGNativeInputs>(); });
  margelo::nitro::HybridObjectRegistry::registerHybridObjectConstructor("TCGNativeCameraOutput", []() -> std::shared_ptr<margelo::nitro::HybridObject> {
    auto wrapper = VisionCamera::HybridCameraOutputSpec_cxx::fromUnsafe([TCGNativeOutputFactory makeOutput]);
    return std::make_shared<margelo::nitro::camera::HybridCameraOutputSpecSwift>(wrapper);
  });
}
@end
