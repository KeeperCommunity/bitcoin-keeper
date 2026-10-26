// Selected-SDK XCTest control, independent of Maestro and product acceptance.
#import <XCTest/XCTest.h>
@interface ControlUITests : XCTestCase
@end
@implementation ControlUITests
- (void)testOwnedControlLaunch {
    XCUIApplication *app = [[XCUIApplication alloc] initWithBundleIdentifier:@"io.hexawallet.hexakeeper.ci.xcode-keychain-control"];
    [app launch];
    XCTAssertTrue([app waitForState:XCUIApplicationStateRunningForeground timeout:10]);
    [app terminate];
}
@end
