// CI-only Metro entrypoint. Actual installed react-native-keychain bridge.
import React, { useEffect, useState } from 'react';
import { AppRegistry, SafeAreaView, Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import RNFS from 'react-native-fs';
import { name as appName } from '../../app.json';
import { runKeychain, SCOPE, OPTION_PROFILE } from './keychain_probe_core';

let attempt;
function KeychainProbe() {
  const [result, setResult] = useState({ stage: 'running', failure_code: null });
  useEffect(() => {
    let active = true;
    if (!attempt) attempt = (async () => {
      const value = __DEV__ ? await runKeychain(Keychain) : {
        stage: 'failed', operation: 'DEVELOPMENT_GATE', failure_code: 'DEVELOPMENT_ONLY', native_code: null };
      // Fixed vocabulary only; never serialize a Keychain result or native error.
      await RNFS.writeFile(`${RNFS.DocumentDirectoryPath}/keeper-ci-keychain-evidence.json`,
        JSON.stringify({ schema: 1, scope: SCOPE, option_profile: OPTION_PROFILE,
          ...value, native_acceptance: false }), 'utf8');
      return value;
    })().catch(() => ({ stage: 'failed', failure_code: 'RECEIPT_WRITE_FAILED' }));
    attempt.then(value => { if (active) setResult(value); });
    return () => { active = false; };
  }, []);
  return <SafeAreaView>
    <Text testID={`keychain-probe-${result.stage}`}>Keeper disposable Keychain {result.stage}</Text>
    <Text testID="keychain-probe-code">{result.failure_code || ''}</Text>
  </SafeAreaView>;
}
AppRegistry.registerComponent(appName, () => KeychainProbe);
