// CI-only entrypoint: never imported by the production app entrypoint.
import 'react-native-get-random-values';
import React, { useEffect, useState } from 'react';
import { AppRegistry, SafeAreaView, Text } from 'react-native';
import Realm from 'realm';
import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';
import { runSaga } from 'redux-saga';
import * as effects from 'redux-saga/effects';
import schema from '../../src/storage/realm/schema';
import * as storage from '../../src/storage';
import * as enums from '../../src/services/wallets/enums';
import * as subscription from '../../src/models/enums/SubscriptionTier';
import { RealmSchema } from '../../src/storage/realm/enum';
import { name as appName } from '../../app.json';
import { createWorkers, provenance } from './.generated/r5_workers';
import { runFeatures, FeatureFailure, SCENARIOS, LIMITS } from './r5_features_core';

const startedAt = performance.now();
let attempt;
function FeatureProbe() {
  const [stage, setStage] = useState('running');
  useEffect(() => {
    let active = true;
    if (!attempt) {
      attempt = (async () => {
        let result;
        let failure;
        try {
          if (!__DEV__) throw new FeatureFailure('development-only');
          result = await runFeatures({
            Realm,
            schema,
            storage,
            createWorkers,
            effects,
            runSaga,
            enums,
            subscription,
            RealmSchema,
            DeviceInfo,
            now: () => performance.now(),
            startedAt,
          });
        } catch (error) {
          failure = error instanceof FeatureFailure ? error.code : 'native-exception';
          result = {
            stage: 'failed',
            measurements: [],
            scenarios: SCENARIOS.map((id) => ({ id, status: 'FAIL' })),
          };
        }
        const evidence = {
          schema: 1,
          scope: 'production-worker-native-storage',
          status:
            result.stage === 'pass' ? 'PASS' : result.stage === 'failed' ? 'FAIL' : 'IN PROGRESS',
          stage: result.stage,
          scenarios: result.scenarios,
          measurements: result.measurements,
          limits: LIMITS,
          source_functions: provenance,
          ...(failure ? { failure } : {}),
        };
        await RNFS.writeFile(
          `${RNFS.DocumentDirectoryPath}/keeper-r5-native-evidence.json`,
          JSON.stringify(evidence),
          'utf8'
        );
        return result.stage;
      })().catch(() => 'failed');
    }
    attempt.then((value) => {
      if (active) setStage(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <SafeAreaView>
      <Text testID={`r5-features-${stage}`}>Keeper R5 native worker probe {stage}</Text>
    </SafeAreaView>
  );
}
AppRegistry.registerComponent(appName, () => FeatureProbe);
