'use strict';
// Fabricated API and byte transport only; no current artifact/native operation.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const SCRIPT = path.join(__dirname, '../scripts/read-d270-ios-artifact.cjs');
const SOURCE = 'd27007078808617a97ee460b592eefb44e7e5325';
const WORKFLOW = 'f5f20e6d959109cdc2e0096099992d72307255bf';
const PAYLOAD = Buffer.from('OFFLINE_SYNTHETIC_METADATA_ZIP_BYTES');
const DIGEST = crypto.createHash('sha256').update(PAYLOAD).digest('hex');
const SELECTION = "const ARTIFACT = 12550480968, ZIP_SIZE = 7339, DIGEST = '5891036cd8225b97c7edaff9bc057e2c70a8f8720e8f9def3ef0369de043d032';";
const OUTCOME = "const NATIVE_CONCLUSION = 'failure', STEP_CONCLUSIONS = ['success', 'failure', 'skipped', 'skipped', 'skipped'];";

function fixture(options = {}) {
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    eventName: 'push', ref: 'refs/heads/codex/r5-d270-ios-artifact-readout-20261024' };
  const runData = { id: 40065599904, run_attempt: 1, repository: { id: 470904030 },
    head_repository: { id: 470904030 }, head_sha: SOURCE, event: 'pull_request',
    head_branch: 'codex/r5-native-acceptance-20261024',
    path: '.github/workflows/keeper-native-diagnostic.yml', status: 'in_progress', conclusion: null,
    referenced_workflows: [{path: `KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: 'refs/pull/7149/merge', sha: WORKFLOW}] };
  const jobData = { id: 120788067210, run_id: 40065599904, run_attempt: 1, head_sha: SOURCE,
    status: 'completed', conclusion: 'failure', steps: [
      ['Build development app', 'success'], ['Run disposable startup smoke', 'failure'],
      ['Run disposable native persistence probe', 'skipped'], ['Run R5 production worker native scenarios', 'skipped'],
      ['Measure five full-product startup and first-wallet runs', 'skipped'], ['Retain safe Phase A evidence', 'success']
    ].map(([name, conclusion]) => ({name, conclusion, status: 'completed'})) };
  const artifact = {id: options.production ? 12550480968 : 991,
    name: `keeper-diagnostic-native-IOS-${SOURCE}-40065599904-1`, expired: false,
    size_in_bytes: options.production ? 7339 : PAYLOAD.length,
    digest: 'sha256:' + (options.production ? '5891036cd8225b97c7edaff9bc057e2c70a8f8720e8f9def3ef0369de043d032' : DIGEST), workflow_run: {
      id: 40065599904, head_sha: SOURCE, repository_id: 470904030, head_repository_id: 470904030}};
  const calls = [], events = [], output = [], actions = {};
  for (const [name, data] of [['getWorkflowRun', runData], ['getJobForWorkflowRun', jobData], ['getArtifact', artifact]]) {
    actions[name] = async args => { calls.push([name, args]); return {data}; };
  }
  actions.downloadArtifact = async args => {calls.push(['downloadArtifact', args]); if(options.after) options.after({runData,jobData,artifact}); return {data: options.payload ?? PAYLOAD};};
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
      openSync(file, flags, mode) {assert.equal(file, '/owned/r5-d270-ios-fixed.zip'); assert.equal(flags, 'wx'); assert.equal(mode, 0o600); events.push('open'); return 42;},
      writeFileSync(fd, bytes) {assert.equal(fd,42); assert.deepEqual(bytes,PAYLOAD); events.push('write'); if(options.write) throw Error('PRIVATE_SENTINEL');},
      closeSync(fd) {assert.equal(fd,42); events.push('close'); if(options.close) throw Error('PRIVATE_SENTINEL');},
      unlinkSync() {events.push('unlink'); if(options.unlink) throw Error('PRIVATE_SENTINEL');}};
    if (name === 'node:child_process') return {execFileSync(command,args,settings) {
      assert.equal(command,'python3'); assert.deepEqual(Array.from(args),['-B','.github/scripts/read-d270-ios-artifact.py']);
      assert.equal(settings.timeout,30000); events.push('decoder'); if(options.decoder) {
        const error = Error('PRIVATE_SENTINEL'); error.stdout = options.decoderOutput; throw error;
      }
      return options.wrongOutput ? 'PRIVATE_SENTINEL' : 'D270_IOS_OBSERVATIONS_BEGIN\n' + JSON.stringify({schema:1,scope:'OBSERVATIONS_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE',original_zip_sha256:DIGEST,metadata_sha256:'a'.repeat(64),observations:{source_sha:SOURCE,run_id:'40065599904',run_attempt:'1'}}) + '\nD270_IOS_OBSERVATIONS_END\n';}};
    throw Error('Unexpected test import');
  }};
  vm.runInNewContext(source,api);
  return {context,runData,jobData,artifact,calls,events,output,inputs,invoke:()=>api.module.exports.run(inputs)};
}

test('exact observed production selection reaches only its archive and rejects wrong digest before file/log', async()=>{
  const f=fixture({production:true,payload:Buffer.alloc(7339)});
  await assert.rejects(f.invoke,/FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
  assert.deepEqual(f.calls.map(([name])=>name),['getWorkflowRun','getJobForWorkflowRun','getArtifact','downloadArtifact']);
  assert.equal(f.calls[2][1].artifact_id,12550480968); assert.equal(f.calls[3][1].artifact_id,12550480968);
  assert.deepEqual(f.events,[]); assert.deepEqual(f.output,[]);
});

test('every incomplete observed binding fails before API/filesystem', async()=>{
  for(const [before,after] of [["ARTIFACT = 12550480968","ARTIFACT = null"], ['ZIP_SIZE = 7339','ZIP_SIZE = null'],
    ["DIGEST = '5891036cd8225b97c7edaff9bc057e2c70a8f8720e8f9def3ef0369de043d032'",'DIGEST = null'], ["NATIVE_CONCLUSION = 'failure'",'NATIVE_CONCLUSION = null'],
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
    await f.invoke(); assert.equal(f.calls.filter(([name])=>name==='getJobForWorkflowRun').length,2);
    assert.equal(f.calls[1][1].job_id,120788067210);
    assert.ok(f.events.indexOf('close')<f.events.indexOf('unlink')); assert.ok(f.events.indexOf('unlink')<f.events.indexOf('info'));
    assert.equal(JSON.parse(f.output[0].split('\n')[1]).observations.source_sha,SOURCE);
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


test('post-download official identity or attempt race rejects before output',async()=>{
  for(const after of [v=>v.runData.run_attempt++,v=>v.jobData.head_sha='0'.repeat(40),v=>v.artifact.expired=true]) {
    const f=fixture({after});
    await assert.rejects(f.invoke,/FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
    assert.equal(f.events.includes('info'),false);
    assert.equal(f.events.filter(x=>x==='unlink').length,1);
  }
});

test('decoder diagnostics admit only fixed stage labels without private output',async()=>{
  for(const [decoderOutput,stage] of [
    ['D270_IOS_OBSERVATION_READOUT_FAILED:STARTUP_OBSERVATION\n','DECODE_STARTUP_OBSERVATION'],
    ['D270_IOS_OBSERVATION_READOUT_FAILED:PRIVATE_SENTINEL\n','DECODE'],
    ['PRIVATE_SENTINEL','DECODE']]) {
    const f=fixture({decoder:true,decoderOutput});
    await assert.rejects(f.invoke,error=>error.message==='FIXED_NATIVE_ARTIFACT_READOUT_FAILED_'+stage);
    assert.deepEqual(f.output,[]);
    assert.equal(f.events.filter(x=>x==='unlink').length,1);
  }
});
