#import "AppDelegate.h"

#import <React/RCTLinkingManager.h>
#import <React/RCTBundleURLProvider.h>
#import <Firebase.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"hexa_keeper";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  if (![[NSUserDefaults standardUserDefaults] objectForKey:@"FirstRun"]) {
    // Delete values from keychain here
    NSArray *secItemClasses = @[(__bridge id)kSecClassGenericPassword,
                    (__bridge id)kSecClassInternetPassword,
                    (__bridge id)kSecClassCertificate,
                    (__bridge id)kSecClassKey,
                    (__bridge id)kSecClassIdentity];
    for (id secItemClass in secItemClasses) {
        NSDictionary *spec = @{(__bridge id)kSecClass: secItemClass};
        SecItemDelete((__bridge CFDictionaryRef)spec);
    }
    [[NSUserDefaults standardUserDefaults] setValue:@"1strun" forKey:@"FirstRun"];
    [[NSUserDefaults standardUserDefaults] synchronize];
  }
#if !KEEPER_RECOVERABLE_PREVIEW
  [FIRApp configure];
#endif

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
   return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

// for universal links
- (BOOL)application:(UIApplication *)application
   openURL:(NSURL *)url
   options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  return [RCTLinkingManager application:application openURL:url options:options];
}

- (BOOL)application:(UIApplication *)application continueUserActivity:(nonnull NSUserActivity *)userActivity
 restorationHandler:(nonnull void (^)(NSArray<id<UIUserActivityRestoring>> * _Nullable))restorationHandler
{
  return [RCTLinkingManager application:application
                   continueUserActivity:userActivity
                     restorationHandler:restorationHandler];
}

@end
