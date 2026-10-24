// Alternative Metro entrypoint, used only by the disposable release acceptance job.
// The production app entrypoint and bundle remain unchanged on disk.
import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { AppRegistry, SafeAreaView, Text } from 'react-native';
import Realm from 'realm';
import schema from '../../src/storage/realm/schema';
import * as storage from '../../src/storage';
import { name as appName } from '../../app.json';
import { runProbe, ProbeFailure } from './release_probe_core';

// No app services, Sentry, account creation, keychain, migrations or network imports.
let attempt;
function ReleaseProbe() {
  const [result, setResult] = useState({ stage: 'running', code: '' });
  useEffect(() => {
    let active = true;
    // A remount must not advance the persistence phase in the same JS process.
    if (!attempt) {
      attempt = __DEV__
        ? runProbe({ Realm, schema, storage }).then(
            (stage) => ({ stage, code: '' }),
            (error) => ({ stage: 'failed', code: error instanceof ProbeFailure ? error.code : 'native-exception' })
          )
        : Promise.resolve({ stage: 'failed', code: 'development-only' });
    }
    attempt.then((value) => { if (active) setResult(value); });
    return () => { active = false; };
  }, []);
  return (
    <SafeAreaView>
      <Text testID={`native-probe-${result.stage}`}>Keeper native probe {result.stage}</Text>
      <Text testID="native-probe-code">{result.code}</Text>
    </SafeAreaView>
  );
}

AppRegistry.registerComponent(appName, () => ReleaseProbe);
