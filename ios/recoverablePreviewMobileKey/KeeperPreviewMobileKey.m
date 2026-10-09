#import <Foundation/Foundation.h>
#import <string.h>

#if defined(KEEPER_RECOVERABLE_PREVIEW) && KEEPER_RECOVERABLE_PREVIEW

#import <React/RCTBridgeModule.h>
#import <Security/Security.h>

static NSString *const KeeperPreviewBundleID = @"io.hexawallet.hexakeeper.recoverablepreview";
static NSString *const KeeperPreviewSeedService = @"io.hexawallet.hexakeeper.recoverablepreview.mobile-key.v1";
static NSString *const KeeperPreviewSeedAccount = @"seed-v1";

static NSDictionary *KeeperPreviewSeedQuery(void)
{
  return @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: KeeperPreviewSeedService,
    (__bridge id)kSecAttrAccount: KeeperPreviewSeedAccount,
    (__bridge id)kSecAttrSynchronizable: @NO,
    (__bridge id)kSecReturnData: @YES,
    (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
  };
}

static OSStatus KeeperPreviewReadSeed(NSData **seed)
{
  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)KeeperPreviewSeedQuery(), &result);
  if (status != errSecSuccess) {
    if (result != NULL) CFRelease(result);
    return status;
  }
  if (result == NULL || CFGetTypeID(result) != CFDataGetTypeID()) {
    if (result != NULL) CFRelease(result);
    return errSecDecode;
  }
  *seed = CFBridgingRelease(result);
  return [(*seed) length] == 32 ? errSecSuccess : errSecDecode;
}

@interface KeeperPreviewMobileKey : NSObject <RCTBridgeModule>
@end

@implementation KeeperPreviewMobileKey

RCT_EXPORT_MODULE(KeeperPreviewMobileKey);

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(getOrCreateSeedBase64:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSBundle *bundle = [NSBundle mainBundle];
  if (![[bundle bundleIdentifier] isEqualToString:KeeperPreviewBundleID] ||
      ![[bundle objectForInfoDictionaryKey:@"KeeperRecoverablePreview"] isEqual:@YES]) {
    reject(@"PREVIEW_ONLY", @"Mobile Key requires the testnet preview app", nil);
    return;
  }

  @synchronized([KeeperPreviewMobileKey class]) {
    NSData *stored = nil;
    OSStatus status = KeeperPreviewReadSeed(&stored);
    if (status == errSecSuccess) {
      resolve([stored base64EncodedStringWithOptions:0]);
      return;
    }
    if (status != errSecItemNotFound) {
      reject(@"MOBILE_KEY_STORAGE_UNAVAILABLE", @"Mobile Key secure storage is unavailable", nil);
      return;
    }

    NSMutableData *created = [NSMutableData dataWithLength:32];
    if (SecRandomCopyBytes(kSecRandomDefault, created.length, created.mutableBytes) != errSecSuccess) {
      reject(@"MOBILE_KEY_STORAGE_UNAVAILABLE", @"Mobile Key secure storage is unavailable", nil);
      return;
    }

    NSDictionary *item = @{
      (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
      (__bridge id)kSecAttrService: KeeperPreviewSeedService,
      (__bridge id)kSecAttrAccount: KeeperPreviewSeedAccount,
      (__bridge id)kSecAttrSynchronizable: @NO,
      (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      (__bridge id)kSecValueData: created,
    };
    status = SecItemAdd((__bridge CFDictionaryRef)item, NULL);
    if (status != errSecSuccess && status != errSecDuplicateItem) {
      memset(created.mutableBytes, 0, created.length);
      reject(@"MOBILE_KEY_STORAGE_UNAVAILABLE", @"Mobile Key secure storage is unavailable", nil);
      return;
    }

    NSData *readback = nil;
    OSStatus readStatus = KeeperPreviewReadSeed(&readback);
    if (readStatus != errSecSuccess ||
        (status == errSecSuccess && ![readback isEqualToData:created])) {
      memset(created.mutableBytes, 0, created.length);
      reject(@"MOBILE_KEY_STORAGE_UNAVAILABLE", @"Mobile Key secure storage is unavailable", nil);
      return;
    }
    // SecItemAdd is create-if-absent. On a duplicate, use the winner's seed.
    resolve([readback base64EncodedStringWithOptions:0]);
    memset(created.mutableBytes, 0, created.length);
  }
}

@end

#endif
