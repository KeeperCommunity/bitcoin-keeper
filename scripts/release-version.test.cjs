const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, validateIntent, validateSources, applyVersions } = require('./release-version.cjs');

const now = Date.parse('2026-09-25T14:00:00Z');
const intent = () => ({
  version: '2.5.15', androidVersionCode: 622, iosBuildNumber: 622,
  baselines: {
    android: { applicationId: 'io.hexawallet.bitcoinkeeper', verifiedAt: '2026-09-25T13:00:00Z', highestUploadedBuild: 621, highestMarketingVersion: '2.5.14' },
    ios: { applicationId: 'io.hexawallet.keeper', verifiedAt: '2026-09-25T13:00:00Z', highestUploadedBuild: 615, highestMarketingVersion: '2.5.14' },
  },
});
const fixtures = () => ({
  packageText: '{"name":"keeper","version":"2.5.15"}',
  iosPlists: Array(2).fill('<key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string><key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>'),
  android: 'android {\n versionName "2.5.15"\n versionCode 622\n}\n',
  ios: ['io.hexawallet.keeper', 'io.hexawallet.keeper', 'io.hexawallet.hexakeeper.dev', 'io.hexawallet.hexakeeper.dev'].map((id, i) =>
    `\t\t${String(i).padStart(24, 'A')} /* Build config */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${id};\n\t\t\t\tMARKETING_VERSION = 2.5.15;\n\t\t\t\tCURRENT_PROJECT_VERSION = 622;\n\t\t\t};\n\t\t};\n`).join(''),
});

test('consistent versions with authenticated fresh baselines pass', () => {
  assert.deepEqual(validateIntent(intent(), { now }), []);
  assert.deepEqual(validateSources(intent(), fixtures()), []);
});
test('rejects the actual 2.5.14 -> 2.3.15 regression even with higher build code', () => {
  const m = intent(); m.version = '2.3.15';
  assert.ok(validateIntent(m, { now }).some((e) => e.includes('marketing version must exceed 2.5.14')));
});
test('numeric version comparison handles multi-digit segments', () => {
  assert.equal(compareVersions('2.10.0', '2.9.99'), 1);
  assert.equal(compareVersions('2.5.15', '2.5.15'), 0);
  assert.throws(() => compareVersions('2.05.15', '2.5.14'));
});
test('rejects a reused Android build', () => {
  const m = intent(); m.androidVersionCode = 621;
  assert.ok(validateIntent(m, { now }).some((e) => e.includes('must exceed uploaded build 621')));
});
test('does not turn missing iOS evidence or a public listing into a verified baseline', () => {
  const m = intent(); m.iosBuildNumber = null; m.baselines.ios.verifiedAt = null; m.baselines.ios.highestUploadedBuild = null;
  assert.ok(validateIntent(m, { now }).some((e) => e.includes('highest uploaded build has not been verified')));
  assert.ok(validateIntent(m, { now }).some((e) => e.includes('refresh authenticated store baseline')));
});
test('rejects stale and future-dated evidence', () => {
  for (const date of ['2026-09-20T00:00:00Z', '2026-09-26T00:00:00Z']) {
    const m = intent(); m.baselines.android.verifiedAt = date;
    assert.ok(validateIntent(m, { now }).some((e) => e.includes('refresh authenticated store baseline')));
  }
});

test('draft validation permits stale evidence while publication validation rejects it', () => {
  const m = intent();
  m.baselines.android.verifiedAt = '2026-09-20T00:00:00Z';
  assert.deepEqual(validateIntent(m, { now, requireEvidence: false }), []);
  assert.ok(validateIntent(m, { now, requireEvidence: true }).some((e) => e.includes('refresh authenticated store baseline')));
});
test('rejects the similarly named non-production Play package', () => {
  const m = intent(); m.baselines.android.applicationId = 'io.hexawallet.keeper';
  assert.ok(validateIntent(m, { now }).some((e) => e.includes('wrong production application ID')));
});
test('detects package drift and a single stale iOS configuration', () => {
  const s = fixtures(); s.packageText = '{"version":"2.5.13"}'; s.ios = s.ios.replace('CURRENT_PROJECT_VERSION = 622;', 'CURRENT_PROJECT_VERSION = 614;');
  const errors = validateSources(intent(), s);
  assert.ok(errors.some((e) => e.includes('package.json')));
  assert.ok(errors.some((e) => e.includes('iOS')));
});
test('apply synchronizes all version fields while preserving unrelated text', () => {
  const s = fixtures(); s.android += '// Preserve existing signing configuration\n';
  const m = intent(); m.version = '2.5.16'; m.androidVersionCode = 623; m.iosBuildNumber = 624;
  const updated = applyVersions(m, s);
  assert.deepEqual(validateSources(m, updated), []);
  assert.ok(updated.android.includes('// Preserve existing signing configuration'));
  assert.equal(JSON.parse(updated.packageText).name, 'keeper');
  assert.ok(s.android.includes('versionCode 622'));
});
test('apply refuses ambiguous Android values and missing iOS targets', () => {
  const s = fixtures(); s.android += '\nversionCode 999\n';
  assert.throws(() => applyVersions(intent(), s), /Unexpected native version structure/);
  const incomplete = fixtures(); incomplete.ios = '';
  assert.throws(() => applyVersions(intent(), incomplete), /Unexpected native version structure/);
});

test('rejects hardcoded plist build numbers even when Xcode project versions agree', () => {
  const s = fixtures();
  s.iosPlists[0] = s.iosPlists[0].replace('$(CURRENT_PROJECT_VERSION)', '614');
  assert.ok(validateSources(intent(), s).some((e) => e.includes('CFBundleVersion')));
  assert.throws(() => applyVersions(intent(), s), /CFBundleVersion/);
});
