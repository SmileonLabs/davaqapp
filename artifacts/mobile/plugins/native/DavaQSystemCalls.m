#import <React/RCTBridgeModule.h>
#import <UserNotifications/UserNotifications.h>
#import <React/RCTEventEmitter.h>
#import "__PROJECT_NAME__-Swift.h"

@interface DavaQSystemCalls : RCTEventEmitter <RCTBridgeModule>
@end

@implementation DavaQSystemCalls
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"DavaQSystemCallAction", @"DavaQPushToken"]; }
- (void)startObserving {
  __weak DavaQSystemCalls *weakSelf = self;
  [DavaQPushRegistry shared].tokenHandler = ^(NSString *token) {
    [weakSelf sendEventWithName:@"DavaQPushToken" body:token ?: [NSNull null]];
  };
  [DavaQSystemCallManager shared].eventHandler = ^(NSDictionary *event) {
    [weakSelf sendEventWithName:@"DavaQSystemCallAction" body:event];
  };
}
- (void)stopObserving { [DavaQSystemCallManager shared].eventHandler = nil; [DavaQPushRegistry shared].tokenHandler = nil; }
RCT_REMAP_METHOD(reportIncoming, reportIncoming:(NSDictionary *)intent
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [[DavaQSystemCallManager shared] reportIncoming:intent completion:^(NSString *error) {
    if (error) reject(@"system_call_report_failed", error, nil);
    else resolve(@YES);
  }];
}
RCT_REMAP_METHOD(markActive, markActive:(NSString *)callId
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [[DavaQSystemCallManager shared] markActive:callId completion:^(NSString *error) {
    if (error) reject(@"system_call_answer_failed", error, nil);
    else resolve(nil);
  }];
}
RCT_REMAP_METHOD(end, end:(NSString *)callId
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [[DavaQSystemCallManager shared] end:callId]; resolve(nil);
}
RCT_REMAP_METHOD(endAll, endAllWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  [[DavaQSystemCallManager shared] endAll]; resolve(nil);
}
RCT_REMAP_METHOD(drainEvents, drainEventsWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  resolve([[DavaQSystemCallManager shared] drainEvents]);
}
RCT_REMAP_METHOD(getPushInfo, getPushInfoWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  [[DavaQPushRegistry shared] start];
  resolve(@{@"voipToken": [DavaQPushRegistry shared].token ?: [NSNull null], @"environment": [DavaQPushRegistry shared].environment});
}
RCT_REMAP_METHOD(setPushOwner, setPushOwner:(NSString *)owner
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [[DavaQPushRegistry shared] setOwner:owner]; resolve(nil);
}
RCT_REMAP_METHOD(clearPushOwner, clearPushOwner:(NSString *)owner
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [[DavaQPushRegistry shared] clearOwner:owner]; resolve(nil);
}
// Enumerate both direct APNs and locally displayed notifications without an SDK envelope.
RCT_REMAP_METHOD(getDeliveredNotifications, getDeliveredNotificationsWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject) {
  [[UNUserNotificationCenter currentNotificationCenter] getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *items) {
    NSMutableArray *result = [NSMutableArray array];
    for (UNNotification *item in items) {
      NSDictionary *raw = item.request.content.userInfo;
      NSDictionary *local = [raw[@"__notifee_notification"] isKindOfClass:[NSDictionary class]] ? raw[@"__notifee_notification"] : nil;
      NSDictionary *data = [local[@"data"] isKindOfClass:[NSDictionary class]] ? local[@"data"] : raw;
      [result addObject:@{@"id": item.request.identifier, @"date": @([item.date timeIntervalSince1970] * 1000),
                         @"notification": @{@"id": item.request.identifier, @"data": data}}];
    }
    resolve(result);
  }];
}
RCT_REMAP_METHOD(removeDeliveredNotifications, removeDeliveredNotifications:(NSArray<NSString *> *)identifiers
                 resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [[UNUserNotificationCenter currentNotificationCenter] removeDeliveredNotificationsWithIdentifiers:identifiers];
  resolve(nil);
}
@end

