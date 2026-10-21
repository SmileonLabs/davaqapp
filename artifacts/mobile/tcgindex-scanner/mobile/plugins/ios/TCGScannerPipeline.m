#import "TCGScannerPipeline.h"
#import <Vision/Vision.h>
#import <React/RCTViewManager.h>
#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>

// Shared state is bounded: one newest buffer, one latest quad, one optional correction.
static BOOL fixedQuad;
static NSLock *lock;
static CIImage *latest, *referenceImage, *seedImage;
static double referenceAt;
static NSLock *trackingLock;
static NSArray *quad, *seed;
static double frameAt, quadAt, seedAt;
static NSInteger generation;
static BOOL running, verified;
static CGSize viewport;
static void initializeState(void) { static dispatch_once_t once; dispatch_once(&once, ^{lock=[NSLock new];trackingLock=[NSLock new];}); }
static double nowMs(void) { return CACurrentMediaTime()*1000; }
static NSArray *guide(CGSize size) {
  double w=MIN(size.width*.72,size.height*.62*.716),h=w/.716,cx=size.width/2,cy=size.height*.51;
  return @[@{@"x":@((cx-w/2)/size.width),@"y":@((cy-h/2)/size.height)},@{@"x":@((cx+w/2)/size.width),@"y":@((cy-h/2)/size.height)},@{@"x":@((cx+w/2)/size.width),@"y":@((cy+h/2)/size.height)},@{@"x":@((cx-w/2)/size.width),@"y":@((cy+h/2)/size.height)}];
}
static NSArray *points(VNRectangleObservation *r) {
  CGPoint p[]={r.topLeft,r.topRight,r.bottomRight,r.bottomLeft}; NSMutableArray *a=[NSMutableArray new];
  for(int i=0;i<4;i++)[a addObject:@{@"x":@(p[i].x),@"y":@(1-p[i].y)}]; return a;
}
static VNRectangleObservation *rectangle(NSArray *a) {
  if(a.count!=4)return nil;
  CGPoint p[4];for(int i=0;i<4;i++)p[i]=CGPointMake([a[i][@"x"] doubleValue],1-[a[i][@"y"] doubleValue]);
  return [VNRectangleObservation rectangleObservationWithRequestRevision:VNTrackRectangleRequestRevision1 topLeft:p[0] topRight:p[1] bottomRight:p[2] bottomLeft:p[3]];
}
void TCGScannerBegin(void) { initializeState();[lock lock];generation++;running=YES;fixedQuad=NO;latest=nil;referenceImage=nil;seedImage=nil;quad=nil;seed=nil;verified=NO;frameAt=0;[lock unlock]; }
void TCGScannerEnd(void) { initializeState();[lock lock];generation++;running=NO;fixedQuad=NO;latest=nil;referenceImage=nil;seedImage=nil;quad=nil;seed=nil;verified=NO;[lock unlock]; }
void TCGScannerSeed(NSArray *corners,double at,NSInteger session) {
  initializeState();[lock lock];
  // Never let a slow recognition result move the current border to old coordinates.
  if(running&&session==generation&&at>0&&frameAt-at<=1500&&at==referenceAt&&referenceImage&&at>=seedAt){seed=[corners copy];seedAt=at;seedImage=referenceImage;}
  [lock unlock];
}
NSDictionary *TCGScannerLatestFrame(void) {
  initializeState();[lock lock];
  NSDictionary *value=running&&latest&&nowMs()-frameAt<500?@{@"image":latest,@"corners":quad?:@[],@"frameAt":@(frameAt),@"session":@(generation),@"verified":@(verified)}:nil;
  [lock unlock];
  if(value){
    // Keep one detached, downscaled reference, not a camera pool buffer held during OCR.
    CIImage *image=value[@"image"];double scale=MIN(1,640/MAX(image.extent.size.width,image.extent.size.height));
    CIImage *small=[image imageByApplyingTransform:CGAffineTransformMakeScale(scale,scale)];
    static CIContext *context;static dispatch_once_t once;dispatch_once(&once,^{context=[CIContext contextWithOptions:nil];});
    CGImageRef copy=[context createCGImage:small fromRect:small.extent];
    if(copy){CIImage *detached=[CIImage imageWithCGImage:copy];CGImageRelease(copy);[lock lock];if(generation==[value[@"session"] integerValue]){referenceImage=detached;referenceAt=[value[@"frameAt"] doubleValue];}[lock unlock];}
  }
  return value;
}
void TCGScannerPublishQuad(NSArray *corners,BOOL confirmed,BOOL photo) { initializeState();[lock lock];if(photo)running=YES;quad=corners.count==4?[corners copy]:nil;quadAt=nowMs();verified=confirmed;fixedQuad=photo;[lock unlock]; }
void TCGScannerSubmitFrame(CVPixelBufferRef buffer) {
  if(TCGCompactSubmitFrame(buffer))return;
  initializeState();if(![trackingLock tryLock])return;
  @try { @autoreleasepool {
    initializeState();[lock lock];BOOL enabled=running;NSInteger session=generation;CGSize size=viewport;NSArray *correction=seed;CIImage *correctionImage=seedImage;seed=nil;seedImage=nil;[lock unlock];
    if(!enabled||size.width<=0||size.height<=0)return;
    CIImage *image=[CIImage imageWithCVPixelBuffer:buffer];CGRect e=image.extent;
    double scale=MAX(size.width/e.size.width,size.height/e.size.height);
    CGRect crop=CGRectMake((e.size.width-size.width/scale)/2,(e.size.height-size.height/scale)/2,size.width/scale,size.height/scale);
    image=[[image imageByCroppingToRect:crop] imageByApplyingTransform:CGAffineTransformMakeTranslation(-crop.origin.x,-crop.origin.y)];
    // Sequence handler lives only on VisionCamera's serial output queue.
    static VNSequenceRequestHandler *handler;static VNRectangleObservation *tracked;static NSInteger trackSession=-1;static CGSize oldSize;static double searchedAt;
    if(trackSession!=session||!CGSizeEqualToSize(oldSize,size)){handler=[VNSequenceRequestHandler new];tracked=nil;trackSession=session;oldSize=size;searchedAt=0;}
    double at=nowMs();
    double down=MIN(1,640/MAX(image.extent.size.width,image.extent.size.height));
    CIImage *trackingImage=[image imageByApplyingTransform:CGAffineTransformMakeScale(down,down)];
    BOOL corrected=NO;
    if(correction&&correctionImage){
      VNSequenceRequestHandler *correctionHandler=[VNSequenceRequestHandler new];
      VNTrackRectangleRequest *request=[[VNTrackRectangleRequest alloc] initWithRectangleObservation:rectangle(correction)];request.trackingLevel=VNRequestTrackingLevelAccurate;
      NSError *error=nil;
      if([correctionHandler performRequests:@[request] onCIImage:correctionImage error:&error]&&request.results.count){
        VNTrackRectangleRequest *current=[[VNTrackRectangleRequest alloc] initWithRectangleObservation:request.results.firstObject];current.trackingLevel=VNRequestTrackingLevelAccurate;
        if([correctionHandler performRequests:@[current] onCIImage:trackingImage error:&error]&&current.results.firstObject.confidence>=.5){tracked=current.results.firstObject;handler=correctionHandler;corrected=YES;}
      }
    }
    if(tracked&&!corrected) {
      VNTrackRectangleRequest *request=[[VNTrackRectangleRequest alloc] initWithRectangleObservation:tracked];request.trackingLevel=VNRequestTrackingLevelFast;
      NSError *error=nil;BOOL ok=[handler performRequests:@[request] onCIImage:trackingImage error:&error];
      VNRectangleObservation *next=request.results.firstObject;tracked=ok&&next.confidence>=.5?next:nil;
    }
    if(!tracked&&at-searchedAt>=150) {
      searchedAt=at;VNDetectRectanglesRequest *request=[VNDetectRectanglesRequest new];
      request.minimumAspectRatio=.45;request.maximumAspectRatio=.9;request.minimumConfidence=.65;request.minimumSize=.15;request.maximumObservations=6;request.quadratureTolerance=30;
      VNImageRequestHandler *detect=[[VNImageRequestHandler alloc] initWithCIImage:trackingImage options:@{}];NSError *error=nil;
      if([detect performRequests:@[request] error:&error]) {
        double best=DBL_MAX;
        for(VNRectangleObservation *r in request.results) {
          CGRect b=r.boundingBox;double distance=hypot(CGRectGetMidX(b)-.5,CGRectGetMidY(b)-.49);
          if(distance>.3)continue;double score=distance+fabs(b.size.width/b.size.height*(size.width/size.height)-.716)*.04;
          if(score<best){best=score;tracked=r;}
        }
        if(tracked)handler=[VNSequenceRequestHandler new];
      }
    }
    [lock lock];if(running&&generation==session){latest=image;frameAt=at;quad=tracked?points(tracked):nil;quadAt=at;if(corrected)verified=YES;if(!tracked)verified=NO;}[lock unlock];
  } } @finally { [trackingLock unlock]; }
}

@interface TCGOutlineView : UIView
@property(nonatomic,strong) CADisplayLink *displayLink;
@property(nonatomic,strong) CAShapeLayer *border;
@property(nonatomic,strong) NSArray *corners;
@property(nonatomic) BOOL live;
@property(nonatomic) BOOL confirmed;
@property(nonatomic) BOOL reduceMotion;
@end
@implementation TCGOutlineView {
  CGPoint displayed[4],velocity[4];BOOL initialized;CFTimeInterval previous;
}
- (instancetype)init { if((self=[super init])){self.userInteractionEnabled=NO;_live=YES;_border=[CAShapeLayer layer];_border.fillColor=UIColor.clearColor.CGColor;_border.lineWidth=3;_border.lineJoin=kCALineJoinRound;[self.layer addSublayer:_border];}return self; }
- (void)didMoveToWindow {
  [super didMoveToWindow];[self.displayLink invalidate];self.displayLink=nil;
  if(self.window){self.displayLink=[CADisplayLink displayLinkWithTarget:self selector:@selector(tick:)];[self.displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];}
}
- (void)layoutSubviews { [super layoutSubviews];initializeState();[lock lock];viewport=self.bounds.size;[lock unlock];self.border.frame=self.bounds; }
- (void)tick:(CADisplayLink *)link {
  if(self.bounds.size.width<=0||self.bounds.size.height<=0)return;
  [lock lock];NSArray *target=self.live&&running&&quad&&(fixedQuad||nowMs()-quadAt<250)?quad:nil;BOOL green=target&&verified;[lock unlock];
  target=target?:(!self.live?self.corners:nil)?:guide(self.bounds.size);
  if(target.count!=4)return;
  double dt=previous?MIN(.033,link.timestamp-previous):1./60;previous=link.timestamp;
  UIBezierPath *path=[UIBezierPath bezierPath];
  for(int i=0;i<4;i++){
    CGPoint goal=CGPointMake([target[i][@"x"] doubleValue]*self.bounds.size.width,[target[i][@"y"] doubleValue]*self.bounds.size.height);
    if(!initialized||self.reduceMotion){displayed[i]=goal;velocity[i]=CGPointZero;}
    else { // Critically damped spring affects display only, never recognition coordinates.
      velocity[i].x+=(400*(goal.x-displayed[i].x)-40*velocity[i].x)*dt;
      velocity[i].y+=(400*(goal.y-displayed[i].y)-40*velocity[i].y)*dt;
      displayed[i].x+=velocity[i].x*dt;displayed[i].y+=velocity[i].y*dt;
    }
    if(i==0)[path moveToPoint:displayed[i]];else[path addLineToPoint:displayed[i]];
  }
  initialized=YES;[path closePath];[CATransaction begin];[CATransaction setDisableActions:YES];self.border.path=path.CGPath;
  self.border.strokeColor=(green||(!self.live&&self.confirmed)?[UIColor colorWithRed:.22 green:.85 blue:.59 alpha:1]:[UIColor colorWithRed:1 green:.15 blue:.22 alpha:1]).CGColor;[CATransaction commit];
}
- (void)dealloc { [_displayLink invalidate]; }
@end
@interface TCGCardOutlineManager : RCTViewManager @end
@implementation TCGCardOutlineManager
RCT_EXPORT_MODULE(TCGCardOutline)
+ (BOOL)requiresMainQueueSetup{return YES;}
- (UIView *)view{return [TCGOutlineView new];}
RCT_EXPORT_VIEW_PROPERTY(live,BOOL)
RCT_EXPORT_VIEW_PROPERTY(confirmed,BOOL)
RCT_EXPORT_VIEW_PROPERTY(reduceMotion,BOOL)
RCT_CUSTOM_VIEW_PROPERTY(corners,NSString,TCGOutlineView){view.corners=json?[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]:nil;}
@end
