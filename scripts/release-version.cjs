#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const appIds = { android: 'io.hexawallet.bitcoinkeeper', ios: 'io.hexawallet.keeper' };
const iosIds = new Set([appIds.ios, 'io.hexawallet.hexakeeper.dev']);

function versionParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid marketing version: ${String(version)}`);
  }
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Marketing version exceeds safe integer range');
  return parts;
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function validateIntent(manifest, { requireEvidence = true, now = Date.now() } = {}) {
  const errors = [];
  try { versionParts(manifest.version); } catch (e) { errors.push(e.message); }
  for (const [platform, field] of [['android', 'androidVersionCode'], ['ios', 'iosBuildNumber']]) {
    const value = manifest[field];
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2100000000) {
      errors.push(`${field} must be an explicit positive integer`);
    }
    const baseline = manifest.baselines?.[platform];
    if (!baseline || baseline.applicationId !== appIds[platform]) {
      errors.push(`${platform}: missing baseline or wrong production application ID`);
      continue;
    }
    try {
      if (compareVersions(manifest.version, baseline.highestMarketingVersion) <= 0) {
        errors.push(`${platform}: marketing version must exceed ${baseline.highestMarketingVersion}`);
      }
    } catch (e) { errors.push(`${platform}: ${e.message}`); }
    if (!Number.isSafeInteger(baseline.highestUploadedBuild) || baseline.highestUploadedBuild < 0) {
      errors.push(`${platform}: highest uploaded build has not been verified`);
    } else if (Number.isSafeInteger(value) && value <= baseline.highestUploadedBuild) {
      errors.push(`${platform}: build ${value} must exceed uploaded build ${baseline.highestUploadedBuild}`);
    }
    if (requireEvidence) {
      const verified = Date.parse(baseline.verifiedAt);
      if (!Number.isFinite(verified) || verified > now || now - verified > 24 * 60 * 60 * 1000) {
        errors.push(`${platform}: refresh authenticated store baseline (must be within 24 hours)`);
      }
    }
  }
  return errors;
}

function iosConfigurations(text) {
  const blocks = [...text.matchAll(/^\t\t[A-F0-9]{24} \/\*.*?\*\/ = \{\n([\s\S]*?)^\t\t\};/gm)];
  return blocks.filter((m) => m[1].includes('isa = XCBuildConfiguration;')).map((m) => {
    const value = (name) => m[1].match(new RegExp(`\\b${name} = ([^;]+);`))?.[1]?.replace(/^"|"$/g, '');
    return { block: m[0], id: value('PRODUCT_BUNDLE_IDENTIFIER'), version: value('MARKETING_VERSION'), build: value('CURRENT_PROJECT_VERSION') };
  }).filter((config) => iosIds.has(config.id));
}

function readSources(root) {
  return {
    packageText: fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    android: fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8'),
    ios: fs.readFileSync(path.join(root, 'ios/hexa_keeper.xcodeproj/project.pbxproj'), 'utf8'),
    iosPlists: ['ios/hexa_keeper/Info.plist', 'ios/hexa_keeper_dev-Info.plist'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')),
  };
}

function validateSources(manifest, sources) {
  const errors = [];
  if (JSON.parse(sources.packageText).version !== manifest.version) errors.push('package.json version differs from manifest');
  const names = [...sources.android.matchAll(/^\s*versionName\s+"([^"]+)"/gm)];
  const codes = [...sources.android.matchAll(/^\s*versionCode\s+(\d+)/gm)];
  if (names.length !== 1 || names[0][1] !== manifest.version) errors.push('Android versionName missing, ambiguous or different from manifest');
  if (codes.length !== 1 || Number(codes[0][1]) !== manifest.androidVersionCode) errors.push('Android versionCode missing, ambiguous or different from manifest');
  if (!Array.isArray(sources.iosPlists) || sources.iosPlists.length !== 2) {
    errors.push('Expected both Keeper Info.plist files');
  } else {
    for (const plist of sources.iosPlists) {
      for (const [key, expected] of [['CFBundleVersion', '$(CURRENT_PROJECT_VERSION)'], ['CFBundleShortVersionString', '$(MARKETING_VERSION)']]) {
        const matches = [...plist.matchAll(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, 'g'))];
        if (matches.length !== 1 || matches[0][1] !== expected) errors.push(`iOS Info.plist ${key} must reference ${expected}`);
      }
    }
  }
  const configs = iosConfigurations(sources.ios);
  for (const id of iosIds) {
    if (configs.filter((c) => c.id === id).length !== 2) errors.push(`Expected Debug and Release configurations for ${id}`);
  }
  for (const c of configs) {
    if (c.version !== manifest.version || c.build !== String(manifest.iosBuildNumber)) errors.push(`iOS ${c.id} version/build differs from manifest`);
  }
  return errors;
}

function applyVersions(manifest, sources) {
  // Validate structure before writing anything. Existing version differences are
  // expected here; missing/ambiguous fields must never be silently ignored.
  const configs = iosConfigurations(sources.ios);
  if ([...sources.android.matchAll(/^\s*versionName\s+"([^"]+)"/gm)].length !== 1 ||
      [...sources.android.matchAll(/^\s*versionCode\s+(\d+)/gm)].length !== 1 ||
      [...iosIds].some((id) => configs.filter((c) => c.id === id).length !== 2)) throw new Error('Unexpected native version structure; no files written');
  const pkg = JSON.parse(sources.packageText);
  pkg.version = manifest.version;
  const android = sources.android.replace(/(^\s*versionName\s+)"[^"]+"/m, (_match, prefix) => `${prefix}"${manifest.version}"`)
    .replace(/(^\s*versionCode\s+)\d+/m, (_match, prefix) => `${prefix}${manifest.androidVersionCode}`);
  let ios = sources.ios;
  for (const c of iosConfigurations(ios)) {
    if (!c.version || !c.build) throw new Error('Missing iOS version fields; no files written');
    const block = c.block.replace(/\bMARKETING_VERSION = [^;]+;/, `MARKETING_VERSION = ${manifest.version};`)
      .replace(/\bCURRENT_PROJECT_VERSION = [^;]+;/, `CURRENT_PROJECT_VERSION = ${manifest.iosBuildNumber};`);
    ios = ios.replace(c.block, block);
  }
  const result = { packageText: JSON.stringify(pkg, null, 2) + '\n', android, ios, iosPlists: sources.iosPlists };
  const errors = validateSources(manifest, result);
  if (errors.length) throw new Error(errors.join('\n'));
  return result;
}

function main() {
  const command = process.argv[2] || 'check';
  if (!['check', 'release-check', 'apply', 'inspect'].includes(command)) throw new Error('Usage: release-version.cjs check|release-check|apply|inspect');
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release/version.json'), 'utf8'));
  const sources = readSources(root);
  if (command === 'inspect') {
    console.log(JSON.stringify({ manifest, packageVersion: JSON.parse(sources.packageText).version,
      androidVersion: sources.android.match(/versionName\s+"([^"]+)"/)?.[1],
      androidBuild: sources.android.match(/versionCode\s+(\d+)/)?.[1],
      ios: iosConfigurations(sources.ios).map(({ id, version, build }) => ({ id, version, build })) }, null, 2));
    return;
  }
  const errors = validateIntent(manifest);
  if (errors.length) throw new Error(errors.join('\n'));
  if (command === 'apply') {
    const updated = applyVersions(manifest, sources);
    fs.writeFileSync(path.join(root, 'package.json'), updated.packageText);
    fs.writeFileSync(path.join(root, 'android/app/build.gradle'), updated.android);
    fs.writeFileSync(path.join(root, 'ios/hexa_keeper.xcodeproj/project.pbxproj'), updated.ios);
    console.log(`Applied ${manifest.version}; Android ${manifest.androidVersionCode}; iOS ${manifest.iosBuildNumber}`);
    return;
  }
  errors.push(...validateSources(manifest, sources));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (command === 'release-check') {
    const expectedCommit = process.env.KEEPER_RELEASE_COMMIT;
    if (!/^[a-f0-9]{40}$/.test(expectedCommit || '') || expectedCommit !== head) errors.push('KEEPER_RELEASE_COMMIT must identify the verified canonical HEAD');
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' }).trim();
    if (dirty) errors.push('Release checkout must be clean; preserve existing work and prepare an isolated release checkout');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Release versions verified: ${manifest.version}; Android ${manifest.androidVersionCode}; iOS ${manifest.iosBuildNumber}; source ${head}`);
}

module.exports = { versionParts, compareVersions, validateIntent, validateSources, applyVersions, iosConfigurations };
if (require.main === module) {
  try { main(); } catch (e) { console.error(`Release preflight failed:\n${e.message}`); process.exitCode = 1; }
}
