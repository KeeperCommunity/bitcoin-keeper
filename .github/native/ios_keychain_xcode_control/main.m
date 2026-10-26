// Synthetic Security.framework control only; never product or RN acceptance.
#import <UIKit/UIKit.h>
#import <Security/Security.h>

static NSString *const Service = @"io.hexawallet.hexakeeper.ci.xcode-keychain-control";
static NSString *const Account = @"CI-SYNTHETIC-NOT-A-CREDENTIAL";
static NSString *const First = @"CI-SYNTHETIC-INITIAL";
static NSString *const Second = @"CI-SYNTHETIC-UPDATED";

static NSMutableDictionary *query(void) {
    return [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: Service, (__bridge id)kSecAttrAccount: Account} mutableCopy];
}

static OSStatus readItem(NSData **value) {
    NSMutableDictionary *q = query();
    q[(__bridge id)kSecReturnData] = @YES;
    q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef raw = NULL;
    OSStatus code = SecItemCopyMatching((__bridge CFDictionaryRef)q, &raw);
    *value = raw ? CFBridgingRelease(raw) : nil;
    return code;
}

static NSDictionary *observe(void) {
    NSString *stage = @"failed", *operation = @"READ_EXISTING";
    NSData *before = nil, *after = nil;
    OSStatus code = readItem(&before);
    if (code == errSecItemNotFound) {
        operation = @"WRITE_INITIAL";
        NSMutableDictionary *q = query();
        q[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlocked;
        q[(__bridge id)kSecValueData] = [First dataUsingEncoding:NSUTF8StringEncoding];
        code = SecItemAdd((__bridge CFDictionaryRef)q, NULL);
        if (code == errSecSuccess) {
            operation = @"VERIFY_INITIAL"; code = readItem(&after);
            if (code == errSecSuccess && [after isEqualToData:[First dataUsingEncoding:NSUTF8StringEncoding]]) stage = @"seeded";
            else if (code == errSecSuccess) code = errSecDecode;
        }
    } else if (code == errSecSuccess && [before isEqualToData:[First dataUsingEncoding:NSUTF8StringEncoding]]) {
        operation = @"UPDATE_PERSISTED";
        NSDictionary *update = @{(__bridge id)kSecValueData: [Second dataUsingEncoding:NSUTF8StringEncoding],
            (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleWhenUnlocked};
        code = SecItemUpdate((__bridge CFDictionaryRef)query(), (__bridge CFDictionaryRef)update);
        if (code == errSecSuccess) {
            operation = @"VERIFY_UPDATED"; code = readItem(&after);
            if (code == errSecSuccess && [after isEqualToData:[Second dataUsingEncoding:NSUTF8StringEncoding]]) stage = @"updated";
            else if (code == errSecSuccess) code = errSecDecode;
        }
    } else if (code == errSecSuccess && [before isEqualToData:[Second dataUsingEncoding:NSUTF8StringEncoding]]) {
        operation = @"DELETE_PERSISTED"; code = SecItemDelete((__bridge CFDictionaryRef)query());
        if (code == errSecSuccess) {
            operation = @"VERIFY_DELETED"; code = readItem(&after);
            if (code == errSecItemNotFound) { stage = @"pass"; code = errSecSuccess; }
            else if (code == errSecSuccess) code = errSecDecode;
        }
    } else if (code == errSecSuccess) {
        // Unexpected data on this dedicated service is never overwritten/deleted.
        code = errSecDecode;
    }
    return @{ @"schema": @1,
        @"scope": @"XCODE_GENERATED_SIMULATOR_NATIVE_SECURITY_CONTROL_ONLY",
        @"stage": stage, @"operation": operation, @"os_status": @(code),
        @"native_acceptance": @NO, @"production_app_or_rn_keychain_acceptance": @NO };
}

@interface ControlDelegate : UIResponder <UIApplicationDelegate>
@property(strong, nonatomic) UIWindow *window;
@end
@implementation ControlDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.rootViewController = [UIViewController new];
    [self.window makeKeyAndVisible];
    NSDictionary *receipt = observe();
    NSString *directory = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
    NSData *data = [NSJSONSerialization dataWithJSONObject:receipt options:0 error:nil];
    [data writeToFile:[directory stringByAppendingPathComponent:@"keeper-ci-xcode-keychain-control.json"]
               options:NSDataWritingAtomic error:nil];
    return YES;
}
@end
int main(int argc, char *argv[]) {
    @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(ControlDelegate.class)); }
}
