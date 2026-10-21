#import <React/RCTBridgeModule.h>
#import <Vision/Vision.h>
#import <CoreImage/CoreImage.h>
#import <UIKit/UIKit.h>
#import "TCGScannerPipeline.h"

// One bounded batch of native recognition inputs. Camera buffers are detached before OCR.
static NSLock *inputLock;
static NSDictionary<NSString *, NSDictionary *> *nativeInputs;
static NSUInteger inputSequence;
static void prepareInputLock(void) { static dispatch_once_t once; dispatch_once(&once, ^{inputLock=[NSLock new];}); }
void TCGScannerClearInputs(void) { prepareInputLock();[inputLock lock];nativeInputs=nil;[inputLock unlock]; }
NSData *TCGScannerCopyInput(NSString *token) {
  prepareInputLock();[inputLock lock];NSData *data=nativeInputs[token][@"pixels"];[inputLock unlock];return data;
}
static CIImage *nativeFooter(NSString *token) {
  prepareInputLock();[inputLock lock];CIImage *image=nativeInputs[token][@"footer"];[inputLock unlock];return image;
}

@interface TCGCardText : NSObject <RCTBridgeModule>
@property(nonatomic, strong) CIContext *context;
@property(nonatomic, strong) VNSequenceRequestHandler *tracker;
@property(nonatomic, strong) VNRectangleObservation *trackedRectangle;
@end

@implementation TCGCardText
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue {
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ queue = dispatch_queue_create("org.tcgindex.scanner.vision", DISPATCH_QUEUE_SERIAL); });
  return queue;
}
- (CIContext *)context {
  if (!_context) _context = [CIContext contextWithOptions:nil];
  return _context;
}
- (CIImage *)image:(NSString *)encoded {
  if([encoded hasPrefix:@"native:"])return nativeFooter([encoded substringFromIndex:7]);
  NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
  return data ? [CIImage imageWithData:data options:@{kCIImageApplyOrientationProperty:@YES}] : nil;
}
RCT_REMAP_METHOD(recognizeImage, recognizeImage:(NSString *)encoded
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  CIImage *image = [self image:encoded];
  if (!image) { reject(@"INVALID_IMAGE", @"카드 이미지를 읽을 수 없습니다.", nil); return; }
  static dispatch_queue_t ocrQueue;static dispatch_once_t once;
  dispatch_once(&once,^{ocrQueue=dispatch_queue_create("org.tcgindex.scanner.ocr",DISPATCH_QUEUE_SERIAL);});
  dispatch_async(ocrQueue, ^{ @autoreleasepool {
    VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = NO;
    // Card identifiers contain Latin letters/digits even on localized cards.
    NSArray *supported=[request supportedRecognitionLanguagesAndReturnError:nil];
    NSMutableArray *languages=[NSMutableArray new];
    for(NSString *language in @[@"ko-KR",@"ja-JP",@"en-US"])if([supported containsObject:language])[languages addObject:language];
    if(languages.count)request.recognitionLanguages=languages;
    if(@available(iOS 16.0,*))request.automaticallyDetectsLanguage=YES;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCIImage:image options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error]) { reject(@"OCR_FAILED", error.localizedDescription, error); return; }
    NSMutableArray *lines = [NSMutableArray new];
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *text = [observation topCandidates:1].firstObject;
      if (text.string.length) [lines addObject:text.string];
    }
    resolve([lines componentsJoinedByString:@"\n"]);
  } });
}
- (NSArray *)corners:(VNRectangleObservation *)rectangle {
  CGPoint points[] = {rectangle.topLeft, rectangle.topRight, rectangle.bottomRight, rectangle.bottomLeft};
  NSMutableArray *result = [NSMutableArray new];
  for (int i = 0; i < 4; i++) [result addObject:@{@"x":@(points[i].x), @"y":@(1-points[i].y)}];
  return result;
}
- (CIImage *)rectify:(CIImage *)image corners:(NSArray *)corners {
  if (![corners isKindOfClass:NSArray.class] || corners.count != 4) return nil;
  CGRect extent = image.extent;
  NSMutableArray *vectors = [NSMutableArray new];
  for (id point in corners) {
    if (![point isKindOfClass:NSDictionary.class] || ![point[@"x"] isKindOfClass:NSNumber.class] || ![point[@"y"] isKindOfClass:NSNumber.class]) return nil;
    double x = [point[@"x"] doubleValue], y = [point[@"y"] doubleValue];
    if (!isfinite(x) || !isfinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return nil;
    [vectors addObject:[CIVector vectorWithX:extent.origin.x+x*extent.size.width Y:extent.origin.y+(1-y)*extent.size.height]];
  }
  return [image imageByApplyingFilter:@"CIPerspectiveCorrection" withInputParameters:@{@"inputTopLeft":vectors[0], @"inputTopRight":vectors[1], @"inputBottomRight":vectors[2], @"inputBottomLeft":vectors[3]}];
}
- (NSDictionary *)pixels:(CIImage *)card includeImage:(BOOL)includeImage native:(BOOL)native {
  CGRect extent = card.extent;
  if (CGRectIsEmpty(extent) || !isfinite(extent.size.width) || !isfinite(extent.size.height)) return nil;
  CIImage *origin = [card imageByApplyingTransform:CGAffineTransformMakeTranslation(-extent.origin.x,-extent.origin.y)];
  CIImage *square = [origin imageByApplyingTransform:CGAffineTransformMakeScale(224/extent.size.width,224/extent.size.height)];
  NSMutableData *rgba = [NSMutableData dataWithLength:224*224*4];
  CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
  // Core Image bitmap rows are top-to-bottom, matching the JS RGB contract.
  [self.context render:square toBitmap:rgba.mutableBytes rowBytes:224*4 bounds:CGRectMake(0,0,224,224) format:kCIFormatRGBA8 colorSpace:color];
  CGColorSpaceRelease(color);
  NSMutableData *rgb = [NSMutableData dataWithLength:224*224*3];
  const uint8_t *source = rgba.bytes; uint8_t *target = rgb.mutableBytes;
  for (int y=0; y<224; y++) for (int x=0; x<224; x++) {
    size_t s=(y*224+x)*4, t=(y*224+x)*3;
    target[t]=source[s]; target[t+1]=source[s+1]; target[t+2]=source[s+2];
  }
  double sum=0, sumSquared=0; size_t count=0;
  for (int y=1; y<223; y++) for (int x=1; x<223; x++) {
    size_t at=(y*224+x)*3;
    double laplacian=0;
    for (int c=0; c<3; c++) laplacian += target[at-224*3+c]+target[at+224*3+c]+target[at-3+c]+target[at+3+c]-4.0*target[at+c];
    laplacian/=3; sum+=laplacian; sumSquared+=laplacian*laplacian; count++;
  }
  BOOL clear=(sumSquared/count-pow(sum/count,2))>=100;
  if (!includeImage) return @{@"clear":@(clear)};
  if(native){
    NSMutableData *floats=[NSMutableData dataWithLength:224*224*3*sizeof(float)];float *values=floats.mutableBytes;
    for(size_t i=0;i<224*224*3;i++)values[i]=target[i]/255.0f;
    // Detached upright footer: no JPEG encoder/decoder and no retained camera pool buffer.
    CGRect footerBounds=CGRectMake(0,0,extent.size.width,extent.size.height*.4);
    double scale=MIN(1,512/extent.size.width);
    CIImage *small=[[origin imageByCroppingToRect:footerBounds] imageByApplyingTransform:CGAffineTransformMakeScale(scale,scale)];
    CGImageRef copy=[self.context createCGImage:small fromRect:small.extent];
    if(!copy)return nil;CIImage *footer=[CIImage imageWithCGImage:copy];CGImageRelease(copy);
    return @{@"clear":@(clear),@"pixels":floats,@"footer":footer};
  }
  CGRect footerRect = CGRectMake(0,0,extent.size.width,extent.size.height*0.3);
  CGImageRef footerImage = [self.context createCGImage:origin fromRect:footerRect];
  if (!footerImage) return nil;
  NSData *footer = UIImageJPEGRepresentation([UIImage imageWithCGImage:footerImage],0.95);
  CGImageRelease(footerImage);
  if (!footer) return nil;
  return @{@"clear":@(clear), @"rgb":[rgb base64EncodedStringWithOptions:0], @"footer":[footer base64EncodedStringWithOptions:0]};
}
RCT_EXPORT_METHOD(beginScanner:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { TCGScannerClearInputs();TCGScannerBegin();resolve(@YES); }
RCT_EXPORT_METHOD(endScanner) { TCGScannerEnd();TCGScannerClearInputs(); }
RCT_EXPORT_METHOD(seedScanner:(NSString *)encoded frameAt:(double)at session:(NSInteger)session) {
  NSArray *corners=[NSJSONSerialization JSONObjectWithData:[encoded dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if([corners isKindOfClass:NSArray.class]&&corners.count==4)TCGScannerSeed(corners,at,session);
}
RCT_REMAP_METHOD(capturePreview, capturePreview:(BOOL)includeImage hint:(NSString *)hint resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  @autoreleasepool {
    double started=CFAbsoluteTimeGetCurrent();NSDictionary *frame=TCGScannerLatestFrame();
    if(!frame){resolve((id)kCFNull);return;}
    CIImage *image=frame[@"image"];
    NSDictionary *options=[NSJSONSerialization JSONObjectWithData:[hint dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSArray *guide=options[@"guide"];
    NSMutableArray *regions=[NSMutableArray new];
    // Retrieval never depends on a detected border. Search guide plus wider/narrower crops.
    if([guide isKindOfClass:NSArray.class]&&guide.count==4) {
      double cx=0,cy=0;for(NSDictionary *p in guide){cx+=[p[@"x"] doubleValue]/4;cy+=[p[@"y"] doubleValue]/4;}
      for(NSNumber *factor in @[@1,@1.2,@.8]) {
        NSMutableArray *corners=[NSMutableArray new];for(NSDictionary *p in guide)[corners addObject:@{@"x":@(MAX(0,MIN(1,cx+([p[@"x"] doubleValue]-cx)*factor.doubleValue))),@"y":@(MAX(0,MIN(1,cy+([p[@"y"] doubleValue]-cy)*factor.doubleValue)))}];
        [regions addObject:@{@"corners":corners,@"source":@"guide",@"tracked":@NO}];
      }
    }
    if([frame[@"corners"] count]==4)[regions addObject:@{@"corners":frame[@"corners"],@"source":@"tracked",@"tracked":@YES}];
    NSMutableArray *candidates=[NSMutableArray new];NSMutableDictionary *inputs=[NSMutableDictionary new];
    NSString *batch=[NSString stringWithFormat:@"%ld-%lu",[frame[@"session"] longValue],(unsigned long)++inputSequence];
    for(NSDictionary *region in regions){
      CIImage *card=[self rectify:image corners:region[@"corners"]];if(!card)continue;
      NSDictionary *pixels=[self pixels:card includeImage:includeImage native:YES];if(!pixels)continue;
      NSMutableDictionary *candidate=[region mutableCopy];candidate[@"clear"]=pixels[@"clear"];if(includeImage){NSString *token=[batch stringByAppendingFormat:@"-%lu",(unsigned long)candidates.count];inputs[token]=pixels;candidate[@"inputToken"]=token;candidate[@"footer"]=[@"native:" stringByAppendingString:token];}[candidates addObject:candidate];
    }
    prepareInputLock();[inputLock lock];nativeInputs=[inputs copy];[inputLock unlock];
    resolve(@{@"candidates":candidates,@"detectionMs":@((CFAbsoluteTimeGetCurrent()-started)*1000),@"frameAt":frame[@"frameAt"],@"session":frame[@"session"]});
  }
}
RCT_REMAP_METHOD(detectCard, detectCard:(NSString *)encoded includeImage:(BOOL)includeImage hint:(NSString *)hint
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  @autoreleasepool {
    CFAbsoluteTime started = CFAbsoluteTimeGetCurrent();
    CIImage *image = [self image:encoded];
    if (!image) { reject(@"INVALID_IMAGE", @"카드 이미지를 읽을 수 없습니다.", nil); return; }
    NSDictionary *options=[NSJSONSerialization JSONObjectWithData:[hint dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (![options isKindOfClass:NSDictionary.class]) options=@{};
    NSMutableArray *regions=[NSMutableArray new];
    if (![options[@"previous"] isKindOfClass:NSArray.class]) { self.tracker=nil; self.trackedRectangle=nil; }
    if (self.trackedRectangle) {
      VNTrackRectangleRequest *tracking=[[VNTrackRectangleRequest alloc] initWithRectangleObservation:self.trackedRectangle];
      tracking.trackingLevel=VNRequestTrackingLevelAccurate;
      NSError *trackingError=nil;
      if ([self.tracker performRequests:@[tracking] onCIImage:image error:&trackingError]) {
        VNRectangleObservation *rectangle=tracking.results.firstObject;
        if (rectangle.confidence>=0.5) {
          self.trackedRectangle=rectangle;
          [regions addObject:@{@"corners":[self corners:rectangle],@"source":@"tracked",@"tracked":@YES}];
        } else self.trackedRectangle=nil;
      } else self.trackedRectangle=nil;
    }
    VNDetectRectanglesRequest *request = [VNDetectRectanglesRequest new];
    request.minimumAspectRatio=0.45; request.maximumAspectRatio=0.9;
    request.minimumConfidence=0.6; request.minimumSize=0.15;
    request.quadratureTolerance=35; request.maximumObservations=3;
    NSError *error=nil;
    VNImageRequestHandler *handler=[[VNImageRequestHandler alloc] initWithCIImage:image options:@{}];
    if (([options[@"redetect"] boolValue] || !self.trackedRectangle) && ![handler performRequests:@[request] error:&error]) { reject(@"DETECTION_FAILED", error.localizedDescription, error); return; }
    if (!self.trackedRectangle && request.results.count) {
      self.tracker=[VNSequenceRequestHandler new];
      self.trackedRectangle=request.results.firstObject;
    }
    for (VNRectangleObservation *rectangle in request.results) [regions addObject:@{@"corners":[self corners:rectangle],@"source":@"edge"}];
    if ( [options[@"guide"] isKindOfClass:NSArray.class]) [regions addObject:@{@"corners":options[@"guide"],@"source":@"guide"}];
    NSMutableArray *candidates=[NSMutableArray new];
    for (NSDictionary *region in regions) {
      CIImage *card=[self rectify:image corners:region[@"corners"]];
      if (!card) continue;
      NSMutableDictionary *candidate=[region mutableCopy];
      candidate[@"tracked"]=region[@"tracked"]?:@NO;
      NSDictionary *pixels=[self pixels:card includeImage:includeImage native:NO];
      if (!pixels) continue;
      candidate[@"clear"]=pixels[@"clear"];
      if (includeImage) [candidate addEntriesFromDictionary:pixels];
      [candidates addObject:candidate];
    }
    resolve(@{@"candidates":candidates,@"detectionMs":@((CFAbsoluteTimeGetCurrent()-started)*1000)});
  }
}
@end
