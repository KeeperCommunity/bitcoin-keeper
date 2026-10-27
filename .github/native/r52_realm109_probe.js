// Fixed development entrypoint in a disposable app instance; no Storage/Keychain reads.
import '../../shim';
import 'react-native-get-random-values';
import '../../src/services/backup/encoding';
import React, { useEffect, useState } from 'react';
import { AppRegistry, SafeAreaView, Text, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import Realm from 'realm';
import { RealmDatabase } from '../../src/storage/realm/realm';
import schema from '../../src/storage/realm/schema';
import { name as appName } from '../../app.json';
import oldSchema from './.generated/r52_realm109/src/storage/realm/schema/index';
import config from './.generated/r52_realm109/config.json';
const { run, CASES, failureCode } = require('./r52_realm109_core.js');
let execution;
async function executeProbe() {
  const scope = 'ACTUAL_NATIVE_SYNTHETIC_REALM109_TO_110';
  const validContext = __DEV__ && config.schema === 1 && config.scope === scope
    && Platform.OS.toUpperCase() === config.platform && ['IOS', 'ANDROID'].includes(config.platform)
    && /^[a-f0-9]{40}$/.test(config.source_sha) && /^[a-f0-9]{48}$/.test(config.nonce)
    && config.historical_commit === '2b6c3ce56857b5dc92f17cc37453ff308d5a3ae8'
    && config.manifest_sha256 === 'bc46b37001c423f96e8aff5ed3e8b63a3ac261224e5647a1dab13179eb54d4d2';
  const directory = RNFS.DocumentDirectoryPath + '/keeper-realm109-' + config.nonce;
  const evidence = RNFS.DocumentDirectoryPath + '/keeper-r52-realm109-evidence.json';
  let completed = [], primary, primaryPresent = false, payload, ownedDirectory = false, attempted = false;
  let code, capturePhase, firstWrite = 'NOT_ATTEMPTED', beforeCleanup = 'PENDING';
  let directoryCleanup = 'NOT_STARTED';
  let nativeCleanup = { native_handles: 'UNAVAILABLE', key_zeroization: 'UNAVAILABLE' };
  const prefix = rows => {
    if (!Array.isArray(rows) || rows.length > CASES.length || rows.some((row, i) =>
      row.id !== CASES[i] || row.status !== 'PASS')) throw new Error('REALM109_CASE_ORDER');
    return rows.map((row, i) => ({ id: CASES[i], status: 'PASS' }));
  };
  const failurePayload = () => ({ schema: 1, scope, source_sha: config.source_sha,
    platform: config.platform, nonce: config.nonce, historical_commit: config.historical_commit,
    manifest_sha256: config.manifest_sha256, status: 'FAIL', failure: code, cases: prefix(completed),
    complete_native_acceptance: false, failure_capture_phase: capturePhase,
    first_write_before_cleanup: beforeCleanup, failure_receipt_write: firstWrite,
    cleanup: { ...nativeCleanup, owned_directory: directoryCleanup } });
  const captureFirst = async (failure, phase, rows = completed) => {
    if (attempted || !validContext) return;
    attempted = true; code = failureCode({ message: failure }); capturePhase = phase;
    try {
      completed = prefix(rows); firstWrite = 'ATTEMPTED';
      await RNFS.writeFile(evidence, JSON.stringify(failurePayload()), 'utf8');
      firstWrite = 'PASS';
      beforeCleanup = phase === 'BEFORE_NATIVE_HANDLE_CLEANUP' || phase === 'BEFORE_DIRECTORY_CLEANUP' ? 'PASS' : 'NOT_APPLICABLE';
    } catch { firstWrite = 'FAIL'; beforeCleanup = 'FAIL'; }
  };
  try {
    if (!validContext) throw new Error('REALM109_DEVELOPMENT_FIXTURE_REQUIRED');
    if (await RNFS.exists(directory)) {
      directoryCleanup = 'NOT_OWNED'; throw new Error('REALM109_STALE_DATABASE');
    }
    directoryCleanup = 'UNVERIFIED';
    await RNFS.mkdir(directory); ownedDirectory = true; directoryCleanup = 'PENDING';
    payload = await run({ Realm, RealmDatabase, oldSchema, schema, config, directory,
      randomBytes: length => global.crypto.getRandomValues(new Uint8Array(length)),
      onProgress: rows => { completed = prefix(rows); },
      onFailure: record => captureFirst(record.failure, 'BEFORE_NATIVE_HANDLE_CLEANUP', record.cases),
      onCleanup: record => {
        if (['PASS', 'FAIL'].includes(record.native_handles) && ['PASS', 'FAIL'].includes(record.key_zeroization))
          nativeCleanup = { native_handles: record.native_handles, key_zeroization: record.key_zeroization };
      } });
  } catch (error) {
    primary = error; primaryPresent = true;
    await captureFirst(failureCode(error), 'BEFORE_DIRECTORY_CLEANUP');
  }
  if (ownedDirectory) {
    try {
      await RNFS.unlink(directory);
      if (await RNFS.exists(directory)) throw new Error('REALM109_CLEANUP');
      directoryCleanup = 'PASS';
    } catch (error) {
      directoryCleanup = 'FAIL';
      if (!primaryPresent) { primary = error; primaryPresent = true; await captureFirst(failureCode(error), 'DURING_DIRECTORY_CLEANUP'); }
    }
  }
  if (primaryPresent) {
    if (attempted) { try { await RNFS.writeFile(evidence, JSON.stringify(failurePayload()), 'utf8'); } catch {} }
    throw primary;
  }
  payload.synthetic_database_cleanup = 'PASS';
  try { await RNFS.writeFile(evidence, JSON.stringify(payload), 'utf8'); }
  catch (error) {
    await captureFirst(failureCode(error), 'AFTER_DIRECTORY_CLEANUP');
    if (attempted) { try { await RNFS.writeFile(evidence, JSON.stringify(failurePayload()), 'utf8'); } catch {} }
    throw error;
  }
  return 'pass';
}
function Probe() {
  const [stage, setStage] = useState('running');
  useEffect(() => {
    let alive = true;
    if (!execution) execution = executeProbe().catch(() => 'failed');
    execution.then(value => { if (alive) setStage(value); });
    return () => { alive = false; };
  }, []);
  return <SafeAreaView><Text testID={`r52-realm109-${stage}`}>Keeper native synthetic Realm migration {stage}</Text></SafeAreaView>;
}
AppRegistry.registerComponent(appName, () => Probe);
