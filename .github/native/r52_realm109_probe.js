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
const { run } = require('./r52_realm109_core.js');
let execution;
function Probe() {
  const [stage, setStage] = useState('running');
  useEffect(() => {
    let alive = true;
    if (!execution) execution = (async () => {
      if (!__DEV__ || Platform.OS.toUpperCase() !== config.platform || !/^[a-f0-9]{48}$/.test(config.nonce))
        throw new Error('REALM109_DEVELOPMENT_FIXTURE_REQUIRED');
      const directory = RNFS.DocumentDirectoryPath + '/keeper-realm109-' + config.nonce;
      if (await RNFS.exists(directory)) throw new Error('REALM109_STALE_DATABASE');
      await RNFS.mkdir(directory);
      let payload;
      try { payload = await run({ Realm, RealmDatabase, oldSchema, schema, config, directory,
        randomBytes: length => global.crypto.getRandomValues(new Uint8Array(length)) }); }
      finally { await RNFS.unlink(directory); }
      if (await RNFS.exists(directory)) throw new Error('REALM109_CLEANUP');
      payload.synthetic_database_cleanup = 'PASS';
      await RNFS.writeFile(RNFS.DocumentDirectoryPath + '/keeper-r52-realm109-evidence.json', JSON.stringify(payload), 'utf8');
      return 'pass';
    })().catch(() => 'failed');
    execution.then(value => { if (alive) setStage(value); });
    return () => { alive = false; };
  }, []);
  return <SafeAreaView><Text testID={`r52-realm109-${stage}`}>Keeper native synthetic Realm migration {stage}</Text></SafeAreaView>;
}
AppRegistry.registerComponent(appName, () => Probe);
