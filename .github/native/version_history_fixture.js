// Selected only by fixed hosted fixture configurations, never normal index.js.
import React, { useEffect, useState } from 'react';
import { AppRegistry, SafeAreaView, Text } from 'react-native';
import Realm from 'realm';
import * as Keychain from 'react-native-keychain';
import { createMMKV } from 'react-native-mmkv';
import cryptoJS from 'crypto-js';
import DeviceInfo from 'react-native-device-info';
import config from 'react-native-config';
import schema from '../../src/storage/realm/schema';
import { Storage } from '../../src/storage';
import { name as appName } from '../../app.json';
const { runFixture } = require('./version_history_fixture_core');
export function registerFixture(phase) {
  let attempt;
  function HistoryFixture() {
    const [stage, setStage] = useState('running');
    useEffect(() => {
      let active = true;
      if (!attempt) attempt = runFixture({ phase, storage: Storage,
        fixtureStorage: createMMKV({ id: 'keeper-ci-version-history-v1' }), Keychain, cryptoJS,
        Realm, schema, DeviceInfo, config, development: __DEV__ }).catch(() => 'failed');
      attempt.then((result) => { if (active) setStage(result); });
      return () => { active = false; };
    }, []);
    return <SafeAreaView><Text testID={`history-fixture-${phase}-${stage}`}>
      Keeper controlled history fixture {stage}
    </Text></SafeAreaView>;
  }
  AppRegistry.registerComponent(appName, () => HistoryFixture);
}
