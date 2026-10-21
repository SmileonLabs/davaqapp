#import <Foundation/Foundation.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreImage/CoreImage.h>
NS_ASSUME_NONNULL_BEGIN
#ifdef __cplusplus
extern "C" {
#endif
BOOL TCGCompactSubmitFrame(CVPixelBufferRef buffer);
void TCGScannerPublishQuad(NSArray *corners, BOOL confirmed, BOOL photo);
void TCGScannerClearInputs(void);
NSData * _Nullable TCGScannerCopyInput(NSString *token);
void TCGScannerSubmitFrame(CVPixelBufferRef buffer);
NSDictionary * _Nullable TCGScannerLatestFrame(void);
void TCGScannerBegin(void);
void TCGScannerEnd(void);
void TCGScannerSeed(NSArray *corners, double frameAt, NSInteger session);
#ifdef __cplusplus
}
#endif
NS_ASSUME_NONNULL_END
