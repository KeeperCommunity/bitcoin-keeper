#import "backupfile.h"

#import <Foundation/Foundation.h>
#import "hexa_keeper-Swift.h"
#import <React/RCTConvert.h>

@implementation BackupFile

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(setFileProtection:(NSString *)filePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject){
  BackupFileHelper *helper = [[BackupFileHelper alloc]init];
  [helper setFileProtectionWithFilePath:filePath callback:^(BOOL success, NSString * _Nullable error) {
    if (success) {
      resolve(@YES);
    } else {
      reject(@"FILE_PROTECTION_ERROR", error ?: @"Failed to set file protection", nil);
    }
  }];
}

@end
