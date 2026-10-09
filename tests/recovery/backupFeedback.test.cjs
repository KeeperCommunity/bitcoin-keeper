const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture, wallet, encryption, enums } = require('./sagaHarness.cjs');

test('opening Recovery Key after restore does not replay health-check consent or enable backup', async () => {
  const f = fixture({ bhr: { automaticCloudBackup: false, seedConfirmed: true } });
  const key = encryption.generateEncryptionKey(f.scope.bip39.mnemonicToSeedSync().toString('hex'));
  f.remote.wallets.local = encryption.encrypt(key, JSON.stringify(wallet('local', enums.NetworkType.MAINNET)));
  await f.run('getAppImageWorker', { payload: { primaryMnemonic: 'mock fixture only' } });
  assert.equal(f.state.account.recoveryKeyStatusByAppId[f.app.id], 'confirmed');
  const signal = f.actions.filter((a) => a.type === 'setSeedConfirmed').at(-1);
  assert.equal(signal?.payload, false, 'restore must clear the transient health-check signal');
  assert.equal(f.state.bhr.automaticCloudBackup, false);
  const file = 'src/components/Backup/BackupHealthCheckList.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('if (seedConfirmed)')) callback = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  const actions = [];
  vm.runInNewContext(ts.transpileModule(`(${callback})()`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    seedConfirmed: signal.payload, automaticCloudBackup: false,
    dispatch: (action) => actions.push(action),
  });
  assert.deepEqual(actions, [], 'mounting the backup page must not upload or enable backup');
});
for (const file of ['src/components/Backup/BackupHealthCheckList.tsx', 'src/screens/SeedScreens/ExportSeedScreen.tsx', 'src/screens/BackupWallet/ViewRecoveryKeyScreen.tsx']) {
  test(`${path.basename(file)} never enables backup or shows success after failure`, () => {
    const source = ts.createSourceFile(file,fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
      if (!callback && ts.isCallExpression(node) && node.expression.getText(source)==='useEffect' && node.arguments[0]?.getText(source).includes('backupAllSuccess')) callback=node.arguments[0].getText(source);
      ts.forEachChild(node,visit);
    }
    visit(source);
    if (!callback) {
      assert.ok(!source.getFullText().includes('backupAllSignersAndVaults('),
        'Recovery Key confirmation must not start Assisted Server Backup');
      return;
    }
    const actions=[], ui=[];
    const context={ backupAllSuccess:false,backupAllFailure:true,automaticCloudBackup:false,
      dispatch:a=>actions.push(a),setBackupAllSuccess:v=>({type:'success',value:v}),setBackupAllFailure:v=>({type:'failure',value:v}),setAutomaticCloudBackup:v=>({type:'enabled',value:v}),
      setAsbEnabled:v=>ui.push(['enabled',v]),setHealthCheckModal:v=>ui.push(['success',v]),setBackupSuccessModal:v=>ui.push(['success',v]),
      showToast:()=>ui.push(['toast']),setLoader:()=>{},navigation:{goBack:()=>{}},
      translations:{recoveryBackup:{unverified:{title:'not verified'}}},recoveryBackup:{unverified:{title:'not verified'}},
    };
    const js=ts.transpileModule(`(${callback})()`,{compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText;
    vm.runInNewContext(js,context);
    assert.ok(!actions.some(a=>a.type==='enabled'&&a.value)); assert.ok(!ui.some(a=>(a[0]==='enabled'||a[0]==='success')&&a[1]));
  });
}


test('home backup warning opens comparison without starting a backup', () => {
  const file = 'src/components/HomeScreenHeader.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === '[uaiType.SERVER_BACKUP_FAILURE]') callback = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  const actions = [], destinations = [];
  vm.runInNewContext(ts.transpileModule(`(${callback})()`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    localLatestUnseenUai: { id: 'disposable-backup-warning' },
    dispatch: action => actions.push(action),
    uaiActioned: payload => ({ type: 'uaiActioned', payload }),
    backupAllSignersAndVaults: () => ({ type: 'backupAllSignersAndVaults' }),
    CommonActions: { navigate: route => route },
    navigation: { dispatch: route => destinations.push(route) },
  });
  assert.deepEqual(destinations, ['AssistedBackupStatus']);
  assert.ok(!actions.some(action => action.type === 'backupAllSignersAndVaults'), 'view details must not write a backup before the user chooses Back Up Now');
});
