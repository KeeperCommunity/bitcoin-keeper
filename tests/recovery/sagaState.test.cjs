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
function inspectionRunner(f) {
  const filename = 'src/store/sagas/bhr.ts';
  const source = ts.createSourceFile(filename,fs.readFileSync(path.join(__dirname,'../..',filename),'utf8'),ts.ScriptTarget.Latest,true);
  const code = source.statements.filter(n =>
    (ts.isFunctionDeclaration(n) && n.name?.text === 'runBackupInspection') ||
    (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name?.text === 'backupInspectionOwners'))
  ).map(n => n.getText(source)).join('\n');
  const operations = [];
  const scope = { ...saga, ...effects, ...bhr, inspectBackup:(...args) => {
    const operation = f.repair.inspectBackup(...args);
    operations.push(operation);
    return operation;
  },
    RealmSchema:{KeeperApp:'KeeperApp',UAI:'UAI'},
    dbManager:{ getObjectByIndex:()=>f.app, getObjectByField:()=>[] },
    currentBackupAppId:()=>f.app.id,
    uaiType:{SERVER_BACKUP_FAILURE:'failure'}, uaiActionedWorker:()=>{}, addToUaiStackWorker:()=>{},
  };
  vm.runInNewContext(ts.transpileModule(code,{ compilerOptions:{ target:ts.ScriptTarget.ES2020 }}).outputText,scope);
  let state = bhr.default(undefined,{type:'init'}); const actions = [];
  return {
    start(repair) {
      const sagaTask = saga.runSaga({getState:()=>({bhr:state,storage:{appId:f.app.id}}),dispatch:action=>{ actions.push(action); state=bhr.default(state,action); }},scope.runBackupInspection,repair);
      return {task:sagaTask.toPromise(),sagaTask,settled:()=>Promise.all(operations),get state(){ return state; },actions};
    },
  };
}
const runInspection = (f, repair) => inspectionRunner(f).start(repair);

const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return {promise,release};
};

test('queued repair keeps actions disabled after the read-only wrapper finishes', async (t) => {
  const read = gate(), readStarted = gate(), upload = gate(), uploadStarted = gate();
  t.after(() => { read.release(); upload.release(); });
  let firstRead = true;
  const f = harness({post:async ({path}) => {
    if (path.endsWith('getBackupSnapshot') && firstRead) {
      firstRead = false; readStarted.release(); await read.promise;
    }
    if (path.endsWith('repairAppBackup')) { uploadStarted.release(); await upload.promise; }
  }});
  f.local.Wallet.push(wallet());
  const runner = inspectionRunner(f);
  const check = runner.start(false);
  await readStarted.promise;
  const repair = runner.start(true);
  read.release();
  assert.equal(await check.task, false);
  await uploadStarted.promise;
  assert.equal(repair.state.backupRepairRunningByAppId.disposable, true);
  assert.equal(repair.actions.some(a => a.type === 'bhr/setBackupRepairRunning' && !a.payload.running), false);
  upload.release();
  assert.equal(await repair.task, true);
  assert.equal(repair.state.backupRepairRunningByAppId.disposable, false);
});

test('cancelling a coalesced wrapper does not clear another running repair', async (t) => {
  const upload = gate(), uploadStarted = gate();
  t.after(() => upload.release());
  const f = harness({post:async ({path}) => {
    if (path.endsWith('repairAppBackup')) { uploadStarted.release(); await upload.promise; }
  }});
  f.local.Wallet.push(wallet());
  const runner = inspectionRunner(f), first = runner.start(true);
  await uploadStarted.promise;
  const second = runner.start(true);
  first.sagaTask.cancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(second.state.backupRepairRunningByAppId.disposable, true);
  upload.release();
  await first.task;
  assert.equal(await second.task, true);
  assert.equal(second.state.backupRepairRunningByAppId.disposable, false);
  assert.equal(f.calls.filter(path => path === 'repairAppBackup').length, 1);
});

test('cancellation retains progress until its non-cancellable inspection actually settles', async (t) => {
  const read = gate(), readStarted = gate();
  t.after(() => read.release());
  const f = harness({post:async () => { readStarted.release(); await read.promise; }});
  const run = runInspection(f, false);
  await readStarted.promise;
  run.sagaTask.cancel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.state.backupRepairRunningByAppId.disposable, true);
  read.release();
  await run.task;
  await run.settled();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.state.backupRepairRunningByAppId.disposable, false);
});

test('only verified readback sets durable per-account completion and clears pending', async () => {
  const f = harness(); f.local.Wallet.push(wallet()); const run=runInspection(f,true);
  assert.equal(await run.task,true);
  assert.equal(run.state.backupRepairCompletedByAppId.disposable,true);
  assert.equal(run.state.backupRepairStateByAppId.disposable,'verified');
  assert.equal(run.state.backupRepairRunningByAppId.disposable,false);
  assert.equal(run.state.pendingAllBackupByAppId.disposable,false);
  const phases=run.actions.filter(a=>a.type==='bhr/setBackupRepairState').map(a=>a.payload.phase);
  assert.deepEqual(phases,['checking','preparing','uploading','verifying','verified']);
});

test('offline/unverified remains pending and retryable, never spins indefinitely', async () => {
  const f=harness({readError:true}); f.local.Wallet.push(wallet()); const run=runInspection(f,true);
  assert.equal(await run.task,false); assert.equal(run.state.pendingAllBackupByAppId.disposable,true);
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
