const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const saga = require('redux-saga');
const effects = require('redux-saga/effects');
const { harness, wallet, loadModule } = require('./helpers.cjs');
const bhr = loadModule('src/store/reducers/bhr.ts', {
  'src/models/enums/BHR': loadModule('src/models/enums/BHR.ts'),
  'src/storage': { reduxStorage:{} },
  'redux-persist': { persistReducer: (_config,reducer) => reducer },
});
function runInspection(f, repair) {
  const filename = 'src/store/sagas/bhr.ts';
  const source = ts.createSourceFile(filename,fs.readFileSync(path.join(__dirname,'../..',filename),'utf8'),ts.ScriptTarget.Latest,true);
  const code = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'runBackupInspection').map(n => n.getText(source)).join('\n');
  const scope = { ...saga, ...effects, ...bhr, inspectBackup:f.repair.inspectBackup,
    RealmSchema:{KeeperApp:'KeeperApp',UAI:'UAI'},
    dbManager:{ getObjectByIndex:()=>f.app, getObjectByField:()=>[] },
    uaiType:{SERVER_BACKUP_FAILURE:'failure'}, uaiActionedWorker:()=>{}, addToUaiStackWorker:()=>{},
  };
  vm.runInNewContext(ts.transpileModule(code,{ compilerOptions:{ target:ts.ScriptTarget.ES2020 }}).outputText,scope);
  let state = bhr.default(undefined,{type:'init'}); const actions = [];
  const task = saga.runSaga({getState:()=>({bhr:state}),dispatch:action=>{ actions.push(action); state=bhr.default(state,action); }},scope.runBackupInspection,repair).toPromise();
  return {task,get state(){ return state; }, actions};
}

test('only verified readback sets durable per-account completion and clears pending', async () => {
  const f = harness(); f.local.Wallet.push(wallet()); const run=runInspection(f,true);
  assert.equal(await run.task,true);
  assert.equal(run.state.backupRepairCompletedByAppId.disposable,true);
  assert.equal(run.state.backupRepairStateByAppId.disposable,'verified');
  assert.equal(run.state.backupRepairRunningByAppId.disposable,false);
  assert.equal(run.state.pendingAllBackup,false);
  const phases=run.actions.filter(a=>a.type==='bhr/setBackupRepairState').map(a=>a.payload.phase);
  assert.deepEqual(phases,['checking','preparing','uploading','verifying','verified']);
});

test('offline/unverified remains pending and retryable, never spins indefinitely', async () => {
  const f=harness({readError:true}); f.local.Wallet.push(wallet()); const run=runInspection(f,true);
  assert.equal(await run.task,false); assert.equal(run.state.pendingAllBackup,true);
  assert.equal(run.state.backupRepairCompletedByAppId.disposable,false);
  assert.equal(run.state.backupRepairRunningByAppId.disposable,false);
});

test('account switch preserves per-account result without clearing another account pending state', async () => {
  const f=harness({post:async ({app})=>{app.id='other';}}); f.local.Wallet.push(wallet());
  const run=runInspection(f,true); await run.task;
  assert.equal(run.state.backupRepairStateByAppId.disposable,'unverified');
  assert.equal(run.state.backupRepairStateByAppId.other,undefined);
  assert.ok(!run.actions.some(a=>a.type==='bhr/setPendingAllBackup'));
});

test('a later mutation invalidates verified status without affecting a second account', () => {
  let state=bhr.default(undefined,bhr.setBackupRepairState({appId:'one',phase:'verified'}));
  state=bhr.default(state,bhr.setBackupRepairState({appId:'two',phase:'verified'}));
  state=bhr.default(state,bhr.invalidateBackupRepair('one'));
  assert.equal(state.backupRepairCompletedByAppId.one,false); assert.equal(state.backupRepairStateByAppId.one,'unverified');
  assert.equal(state.backupRepairCompletedByAppId.two,true);
});
