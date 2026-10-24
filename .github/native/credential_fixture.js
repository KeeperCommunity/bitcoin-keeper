// Alternate fixture entrypoint only; ordinary app source is never patched.
import React, { useEffect, useState } from 'react';
import { AppRegistry, SafeAreaView, Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import config from 'react-native-config';
import { Storage } from '../../src/storage';
import { name as appName } from '../../app.json';
import { runFixture } from './credential_fixture_core';
// Selected by the two fixed entry wrappers, never by production app state.
export function registerFixture(phase) {
  let attempt;
  function CredentialFixture() {
    const [stage, setStage] = useState('running');
    useEffect(() => {
      let active = true;
      if (!attempt) attempt = runFixture({ phase, Keychain, storage: Storage, config,
        development: __DEV__ }).catch(() => 'failed');
      attempt.then((value) => { if (active) setStage(value); });
      return () => { active = false; };
    }, []);
    return <SafeAreaView><Text testID={`credential-fixture-${stage}`}>
      Keeper disposable credential fixture {stage}
    </Text></SafeAreaView>;
  }
  AppRegistry.registerComponent(appName, () => CredentialFixture);
}
