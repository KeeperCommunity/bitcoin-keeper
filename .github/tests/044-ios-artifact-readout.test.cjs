'use strict';
// Fabricated API and byte transport only; no current artifact/native operation.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const SCRIPT = path.join(__dirname, '../scripts/read-044-ios-artifact.cjs');
const SOURCE = '044ebb6ea2d465f6a70e9116e3feac5a604cd696';
const WORKFLOW = '5a7b0c5da0a38197f6dd675ff424f3ba3f441d02';
const PAYLOAD = Buffer.from('OFFLINE_SYNTHETIC_METADATA_ZIP_BYTES');
const DIGEST = crypto.createHash('sha256').update(PAYLOAD).digest('hex');
const SELECTION = "const ARTIFACT = 12469536083, ZIP_SIZE = 7232, DIGEST = 'e244015128d4aa72e1e1c8be3072bc70d506ba11a804067448122d1318621caf';";
const OUTCOME = "const NATIVE_CONCLUSION = 'failure', STEP_CONCLUSIONS = ['success', 'failure', 'skipped', 'skipped', 'skipped'];";

function fixture(options = {}) {
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    eventName: 'push', ref: 'refs/heads/codex/r5-044-artifact-readout-preparation-20261023' };
  const runData = { id: 39873063291, run_attempt: 1, repository: { id: 470904030 },
    head_repository: { id: 470904030 }, head_sha: SOURCE, event: 'pull_request',
    head_branch: 'codex/r5-startup-credential-failure-observation-20261022',
    path: '.github/workflows/keeper-native-diagnostic.yml', status: 'in_progress', conclusion: null,
    referenced_workflows: [{path: `KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: 'refs/pull/7131/merge', sha: WORKFLOW}] };
  const jobData = { id: 120151926152, run_id: 39873063291, run_attempt: 1, head_sha: SOURCE,
    status: 'completed', conclusion: 'failure', steps: [
      ['Build development app', 'success'], ['Run disposable startup smoke', 'failure'],
      ['Run disposable native persistence probe', 'skipped'], ['Run R5 production worker native scenarios', 'skipped'],
      ['Measure five full-product startup and first-wallet runs', 'skipped'], ['Retain safe Phase A evidence', 'success']
    ].map(([name, conclusion]) => ({name, conclusion, status: 'completed'})) };
  const artifact = {id: options.production ? 12469536083 : 991,
    name: `keeper-diagnostic-native-IOS-${SOURCE}-39873063291-1`, expired: false,
    size_in_bytes: options.production ? 7232 : PAYLOAD.length,
    digest: 'sha256:' + (options.production ? 'e244015128d4aa72e1e1c8be3072bc70d506ba11a804067448122d1318621caf' : DIGEST), workflow_run: {
      id: 39873063291, head_sha: SOURCE, repository_id: 470904030, head_repository_id: 470904030}};
  const calls = [], events = [], output = [], actions = {};
  for (const [name, data] of [['getWorkflowRun', runData], ['getJobForWorkflowRun', jobData], ['getArtifact', artifact]]) {
    actions[name] = async args => { calls.push([name, args]); return {data}; };
  }
  actions.downloadArtifact = async args => {calls.push(['downloadArtifact', args]); return {data: options.payload ?? PAYLOAD};};
  const inputs = {github: {rest: {actions}}, context, core: {
    info(value) {events.push('info'); if (options.info) throw Error('PRIVATE_SENTINEL'); output.push(value);},
    warning(value) {events.push('warning'); if (options.warning) throw Error('PRIVATE_SENTINEL'); output.push(value);}}};
  let source = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(source.includes(SELECTION) && source.includes(OUTCOME));
  if (!options.production) source = source.replace(SELECTION,
    `const ARTIFACT = 991, ZIP_SIZE = ${PAYLOAD.length}, DIGEST = '${DIGEST}';`);
  if (options.edit) source = options.edit(source);
  const api = {module: {exports: {}}, Buffer, process: {env: {RUNNER_TEMP: '/owned'}}, require(name) {
    if (name === 'node:assert/strict') return {...assert, deepEqual(a,b) {assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));}};
    if (name === 'node:crypto') return crypto;
    if (name === 'node:path') return path;
    if (name === 'node:fs') return {realpathSync: x => x,
      openSync(file, flags, mode) {assert.equal(file, '/owned/r5-044-ios-fixed.zip'); assert.equal(flags, 'wx'); assert.equal(mode, 0o600); events.push('open'); return 42;},
      writeFileSync(fd, bytes) {assert.equal(fd,42); assert.deepEqual(bytes,PAYLOAD); events.push('write'); if(options.write) throw Error('PRIVATE_SENTINEL');},
      closeSync(fd) {assert.equal(fd,42); events.push('close'); if(options.close) throw Error('PRIVATE_SENTINEL');},
      unlinkSync() {events.push('unlink'); if(options.unlink) throw Error('PRIVATE_SENTINEL');}};
    if (name === 'node:child_process') return {execFileSync(command,args,settings) {
      assert.equal(command,'python3'); assert.deepEqual(Array.from(args),['-B','.github/scripts/read-044-ios-artifact.py']);
      assert.equal(settings.timeout,30000); events.push('decoder'); if(options.decoder) throw Error('PRIVATE_SENTINEL');
      return options.wrongOutput ? 'PRIVATE_SENTINEL' : `FIXED_044_IOS_ARTIFACT_ZIP_BASE64_BEGIN\n${PAYLOAD.toString('base64')}\nFIXED_044_IOS_ARTIFACT_ZIP_BASE64_END\n`;}};
    throw Error('Unexpected test import');
  }};
  vm.runInNewContext(source,api);
  return {context,runData,jobData,artifact,calls,events,output,inputs,invoke:()=>api.module.exports.run(inputs)};
}

test('exact observed production selection reaches only its archive and rejects wrong digest before file/log', async()=>{
  const f=fixture({production:true,payload:Buffer.alloc(7232)});
  await assert.rejects(f.invoke,/FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
  assert.deepEqual(f.calls.map(([name])=>name),['getWorkflowRun','getJobForWorkflowRun','getArtifact','downloadArtifact']);
  assert.equal(f.calls[2][1].artifact_id,12469536083); assert.equal(f.calls[3][1].artifact_id,12469536083);
  assert.deepEqual(f.events,[]); assert.deepEqual(f.output,[]);
});

test('every incomplete observed binding fails before API/filesystem', async()=>{
  for(const [before,after] of [["ARTIFACT = 12469536083","ARTIFACT = null"], ['ZIP_SIZE = 7232','ZIP_SIZE = null'],
    ["DIGEST = 'e244015128d4aa72e1e1c8be3072bc70d506ba11a804067448122d1318621caf'",'DIGEST = null'], ["NATIVE_CONCLUSION = 'failure'",'NATIVE_CONCLUSION = null'],
    ["STEP_CONCLUSIONS = ['success', 'failure', 'skipped', 'skipped', 'skipped']",'STEP_CONCLUSIONS = null'],
    ["STEP_CONCLUSIONS = ['success', 'failure', 'skipped', 'skipped', 'skipped']", "STEP_CONCLUSIONS = ['success', , 'skipped', 'skipped', 'skipped']"],
    ["STEP_CONCLUSIONS = ['success', 'failure', 'skipped', 'skipped', 'skipped']", "STEP_CONCLUSIONS = ['success', undefined, 'skipped', 'skipped', 'skipped']"],
    ["STEP_CONCLUSIONS = ['success', 'failure', 'skipped', 'skipped', 'skipped']", "STEP_CONCLUSIONS = ['success', null, 'skipped', 'skipped', 'skipped']"]]) {
    const f=fixture({production:true,edit:s=>{assert.ok(s.includes(before)); return s.replace(before,after);}});
    await assert.rejects(f.invoke,/FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
    assert.deepEqual(f.calls,[]); assert.deepEqual(f.events,[]); assert.deepEqual(f.output,[]);
  }
});

test('synthetic completed iOS job can be read while Android continues and purge precedes exact-byte output',async()=>{
  for(const completed of [false,true]) {
    const f=fixture(); if(completed) Object.assign(f.runData,{status:'completed',conclusion:'failure'});
    await f.invoke(); assert.equal(f.calls.filter(([name])=>name==='getJobForWorkflowRun').length,1);
    assert.equal(f.calls[1][1].job_id,120151926152);
    assert.ok(f.events.indexOf('close')<f.events.indexOf('unlink')); assert.ok(f.events.indexOf('unlink')<f.events.indexOf('info'));
    assert.deepEqual(Buffer.from(f.output[0].split('\n')[1],'base64'),PAYLOAD);
  }
});

test('foreign stale source workflow job artifact or incomplete critical step never downloads',async()=>{
  for(const change of [f=>f.context.eventName='workflow_dispatch',f=>f.context.repo.owner='foreign',f=>f.context.ref='refs/heads/sprint',
    f=>f.runData.id++,f=>f.runData.run_attempt++,f=>f.runData.head_sha=WORKFLOW,f=>f.runData.repository.id++,
    f=>f.runData.head_repository.id++,f=>f.runData.status='queued',f=>f.runData.referenced_workflows=[],
    f=>f.runData.referenced_workflows[0].sha=SOURCE,f=>f.jobData.id++,f=>f.jobData.run_attempt++,f=>f.jobData.run_id++,
    f=>f.jobData.status='in_progress',f=>f.jobData.conclusion='success',f=>f.jobData.steps[0].conclusion='failure',
    f=>f.jobData.steps[5].conclusion='failure',f=>f.jobData.steps.push(f.jobData.steps[5]),f=>f.artifact.id++,
    f=>f.artifact.name+='foreign',f=>f.artifact.size_in_bytes++,f=>f.artifact.expired=true,
    f=>f.artifact.digest='sha256:'+'0'.repeat(64),f=>f.artifact.workflow_run.id++,f=>f.artifact.workflow_run.head_sha=WORKFLOW]) {
    const f=fixture({production:true}); change(f); await assert.rejects(f.invoke,/FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
    assert.equal(f.calls.some(([name])=>name==='downloadArtifact'),false); assert.deepEqual(f.events,[]); assert.deepEqual(f.output,[]);
  }
});

test('wrong ZIP size or digest fails before any filesystem or log operation',async()=>{
  for(const payload of [Buffer.from('PRIVATE_SENTINEL'),Buffer.alloc(PAYLOAD.length)]) {
    const f=fixture({payload}); await assert.rejects(f.invoke,/FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
    assert.deepEqual(f.events,[]); assert.deepEqual(f.output,[]);
  }
});

test('decoder write close cleanup and logging errors stay fixed and preserve purge ordering',async()=>{
  for(const options of [{write:true,unlink:true,warning:true},{close:true},{decoder:true,unlink:true,warning:true},
    {wrongOutput:true},{unlink:true,warning:true},{info:true}]) {
    const f=fixture(options); await assert.rejects(f.invoke,options.unlink&&!options.write&&!options.decoder ?
      /FIXED_NATIVE_ARTIFACT_PRIVATE_CLEANUP_FAILED/:/FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
    assert.equal(f.events.filter(x=>x==='unlink').length,1);
    if(options.info) assert.ok(f.events.indexOf('unlink')<f.events.indexOf('info')); else assert.equal(f.events.includes('info'),false);
    assert.equal(JSON.stringify(f.output).includes('PRIVATE_SENTINEL'),false);
  }
});
