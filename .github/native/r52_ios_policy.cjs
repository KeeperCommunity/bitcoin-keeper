'use strict';
// Compile exact dependency policy/delegate methods for an owned iOS simulator.
// This source-method probe complements (does not replace) the actual app bridge.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const SHA = { client: '18687347fbf49c4b43cab19812d144944b722f56a3d1161b13acc6c781eb3373',
  policy: 'e1448667c907c16713f88ab33324b054b64a0016e0d54cb3565473b7cd95bd24' };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function method(source, selector) {
  const start = source.indexOf(selector);
  if (start < 0 || source.indexOf(selector, start + 1) >= 0) throw new Error('IOS_POLICY_SELECTOR');
  const end = source.indexOf('\n}\n', start);
  if (end < 0) throw new Error('IOS_POLICY_METHOD_BOUNDARY');
  return source.slice(start, end + 3);
}
function program(client, header) {
  if (digest(client) !== SHA.client || digest(header) !== SHA.policy) throw new Error('IOS_POLICY_SOURCE_CHANGED');
  const methods = [
    '- (BOOL)keeperCertificateAllowed:(SecCertificateRef)certificate {',
    '- (void)socket:(GCDAsyncSocket *)sock\n      didReceiveTrust:(SecTrustRef)trust',
    '- (NSString *)stripPEMHeader:(NSString *)pemData prefix:(NSString *)prefix {',
  ].map(selector => method(client.toString('utf8'), selector));
  return `#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#include <time.h>
#include "KeeperCertificatePolicy.h"
@class GCDAsyncSocket;
@interface FixturePEM : NSObject
@property NSString *value;
- (NSString *)resolve;
@end
@implementation FixturePEM
- (NSString *)resolve { return self.value; }
@end
@interface ExactPolicy : NSObject {
  NSString *_host; BOOL _checkValidity; SecTrustRef _peerTrust; FixturePEM *_resolvableCaCert;
}
- (instancetype)initWithAnchor:(NSString *)anchor;
- (BOOL)keeperCertificateAllowed:(SecCertificateRef)certificate;
- (void)socket:(GCDAsyncSocket *)sock didReceiveTrust:(SecTrustRef)trust completionHandler:(void (^)(BOOL))completionHandler;
- (NSString *)stripPEMHeader:(NSString *)pemData prefix:(NSString *)prefix;
@end
@implementation ExactPolicy
- (instancetype)initWithAnchor:(NSString *)anchor {
  if ((self = [super init])) { _host = @"127.0.0.1"; _checkValidity = YES;
    if (anchor) { _resolvableCaCert = [FixturePEM new]; _resolvableCaCert.value = anchor; } }
  return self;
}
- (void)dealloc { if (_peerTrust) CFRelease(_peerTrust); }
${methods.join('\n')}
@end
static SecCertificateRef certificate(NSString *filename) {
  NSString *pem = [NSString stringWithContentsOfFile:filename encoding:NSUTF8StringEncoding error:NULL];
  ExactPolicy *parser = [[ExactPolicy alloc] initWithAnchor:nil];
  NSString *base64 = [parser stripPEMHeader:pem prefix:@"CERTIFICATE"];
  NSData *der = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
  return der ? SecCertificateCreateWithData(NULL, (__bridge CFDataRef)der) : NULL;
}
int main(int argc, char **argv) { @autoreleasepool {
  if (argc != 2) return 3;
  NSData *bytes = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];
  NSArray *rows = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:NULL];
  if (![rows isKindOfClass:[NSArray class]] || rows.count < 20 || rows.count > 40) return 3;
  NSMutableArray *results = [NSMutableArray array]; BOOL passed = YES;
  for (NSDictionary *row in rows) {
    SecCertificateRef cert = certificate(row[@"certificate"]); if (!cert) return 3;
    NSString *anchor = row[@"anchor"] == [NSNull null] ? nil :
      [NSString stringWithContentsOfFile:row[@"anchor"] encoding:NSUTF8StringEncoding error:NULL];
    ExactPolicy *probe = [[ExactPolicy alloc] initWithAnchor:anchor];
    __block BOOL actual = NO; __block BOOL completed = NO;
    if ([row[@"mode"] isEqual:@"policy"]) { actual = [probe keeperCertificateAllowed:cert]; completed = YES; }
    else {
      SecPolicyRef policy = SecPolicyCreateSSL(true, CFSTR("127.0.0.1")); SecTrustRef trust = NULL;
      if (SecTrustCreateWithCertificates(cert, policy, &trust) != errSecSuccess || !trust) return 3;
      SecTrustSetNetworkFetchAllowed(trust, false);
      [probe socket:nil didReceiveTrust:trust completionHandler:^(BOOL value) { actual = value; completed = YES; }];
      CFRelease(trust); CFRelease(policy);
    }
    CFRelease(cert);
    BOOL good = completed && actual == [row[@"expected"] boolValue]; passed = passed && good;
    [results addObject:@{@"id":row[@"id"], @"status":good ? @"PASS" : @"FAIL"}];
  }
  NSData *output = [NSJSONSerialization dataWithJSONObject:@{@"schema":@1,
    @"scope":@"IOS_SIMULATOR_SECURITY_FRAMEWORK_EXACT_SOURCE_METHODS", @"cases":results,
    @"status":passed ? @"PASS" : @"FAIL"} options:0 error:NULL];
  fwrite(output.bytes, 1, output.length, stdout); putchar('\\n'); return passed ? 0 : 2;
} }
`;
}
function manifest(directory) {
  const cert = name => path.join(directory, name + '.pem');
  const rows = [];
  const add = (id, file, anchor, expected, mode = 'delegate') => rows.push({ id, certificate: file, anchor, expected, mode });
  for (const name of ['root', 'custom', 'selfsigned']) add('policy_' + name, cert(name), null, true, 'policy');
  for (const name of ['expired-root', 'expired-selfsigned']) add('policy_' + name, cert(name), null, false, 'policy');
  for (const [name, anchor, expected] of [['valid', 'root', true], ['custom-leaf', 'custom', true],
    ['selfsigned', 'selfsigned', true], ['wronghost', 'wronghost', false], ['expired', 'root', false],
    ['forged', 'root', false], ['valid', 'expired-root', false], ['expired-selfsigned', 'expired-selfsigned', false]])
    add('delegate_' + name + '_' + anchor, cert(name), cert(anchor), expected);
  const publicRoots = path.resolve(__dirname, '../../tests/electrum/public-trust/roots');
  for (const [i, name] of fs.readdirSync(publicRoots).filter(n => n.endsWith('.pem')).sort().entries())
    add('withdrawn_policy_' + i, path.join(publicRoots, name), null, false, 'policy');
  const keys = fs.readdirSync(directory).filter(n => n.endsWith('.spki.der.pem')).sort();
  if (keys.length !== 8) throw new Error('IOS_POLICY_PUBLIC_KEYS');
  for (const [i, name] of keys.entries()) add('compromised_policy_' + i, path.join(directory, name), null, false, 'policy');
  return rows;
}
function main() {
  if (process.argv.length !== 4 || process.platform !== 'darwin' ||
      !/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(process.argv[2])) throw new Error('IOS_POLICY_SIMULATOR');
  const directory = path.resolve(process.argv[3]), device = process.argv[2];
  if (fs.realpathSync(directory) !== directory || !path.basename(directory).startsWith('keeper-electrum-tls-')) throw new Error('IOS_POLICY_FIXTURE');
  const dependency = path.join(path.dirname(require.resolve('react-native-tcp-socket/package.json')), 'ios');
  const client = fs.readFileSync(path.join(dependency, 'TcpSocketClient.m'));
  const header = fs.readFileSync(path.join(dependency, 'KeeperCertificatePolicy.h'));
  const source = path.join(directory, 'policy.m'), binary = path.join(directory, 'policy'), input = path.join(directory, 'policy.json');
  const rows = manifest(directory);
  fs.writeFileSync(source, program(client, header), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(input, JSON.stringify(rows), { flag: 'wx', mode: 0o600 });
  const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : null;
  if (!arch) throw new Error('IOS_POLICY_ARCH');
  execFileSync('xcrun', ['--sdk', 'iphonesimulator', 'clang', '-target', arch + '-apple-ios18.5-simulator',
    '-isysroot', sdk, '-fobjc-arc', '-fblocks', '-framework', 'Foundation', '-framework', 'Security',
    '-I', dependency, source, '-o', binary], { stdio: 'pipe', timeout: 60000, maxBuffer: 65536 });
  // Ad-hoc diagnostic executable only; no Apple identity, profile or release artifact.
  execFileSync('codesign', ['--force', '--sign', '-', binary], { stdio: 'pipe', timeout: 30000 });
  const raw = execFileSync('xcrun', ['simctl', 'spawn', device, binary, input], { encoding: 'utf8', timeout: 60000, maxBuffer: 65536 });
  const result = JSON.parse(raw);
  if (result.status !== 'PASS' || result.cases?.length !== rows.length ||
      result.cases.some((c, i) => c.id !== rows[i].id || c.status !== 'PASS')) throw new Error('IOS_POLICY_FAILED');
  process.stdout.write(JSON.stringify({ ...result, production_source_sha256: SHA, actual_app_bridge: false }) + '\n');
}
module.exports = { program, manifest, SHA };
if (require.main === module) { try { main(); } catch { process.stderr.write('Actual iOS policy probe failed.\n'); process.exitCode = 1; } }
