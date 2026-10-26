'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const m=require('../native/android_canonical_custody.cjs');
const S='a'.repeat(40),T='b'.repeat(40),W='c'.repeat(40);
function fixture(role='runtime',priv=true){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'android-current-api-'));
 const repo={id:priv?839671816:470904030,full_name:'KeeperCommunity/bitcoin-keeper'+(priv?'-private':''),private:priv};
 const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_ARCH:'X64',ImageOS:'ubuntu24',KEEPER_NATIVE_PLATFORM:'ANDROID',
  KEEPER_ANDROID_CUSTODY_ROLE:role,GITHUB_REPOSITORY:repo.full_name,GITHUB_REPOSITORY_ID:String(repo.id),KEEPER_SOURCE_SHA:S,GITHUB_RUN_ID:'11',GITHUB_RUN_ATTEMPT:'2',GITHUB_WORKFLOW_SHA:S,
  GITHUB_WORKFLOW_REF:repo.full_name+'/.github/workflows/keeper-canonical-native.yml@refs/heads/sprint',KEEPER_DIAGNOSTIC:'false',RUNNER_NAME:'runner-'+role,RUNNER_TEMP:directory};
 const context={repo:{owner:'KeeperCommunity',repo:priv?'bitcoin-keeper-private':'bitcoin-keeper'},eventName:'workflow_dispatch',ref:'refs/heads/sprint',sha:S,payload:{}};
 const run={id:11,run_attempt:2,head_sha:S,repository:repo,head_repository:repo,event:'workflow_dispatch',path:'.github/workflows/keeper-canonical-native.yml',workflow_id:12,check_suite_id:14,status:'in_progress',referenced_workflows:[{path:repo.full_name+'/.github/workflows/keeper-canonical-native-platform.yml@'+S,ref:'refs/heads/sprint',sha:S}]};
 const producer={id:13,name:'android / Canonical ANDROID compile producer',run_id:11,run_attempt:2,head_sha:S,status:role==='producer'?'in_progress':'completed',conclusion:role==='producer'?null:'success',runner_name:'runner-producer',check_run_url:'https://api.github.com/repos/'+repo.full_name+'/check-runs/17',steps:m.requiredProducerSteps.map(name=>({name,status:'completed',conclusion:'success'}))};
 const runtime={id:15,name:'android / Canonical ANDROID build and features',run_id:11,run_attempt:2,head_sha:S,status:'in_progress',runner_name:'runner-runtime'};
 const bytes=Buffer.from('bounded archive transfer fixture; Python tests real ZIP members');
 const artifact={id:19,name:m.artifactName(S,11,2),expired:false,size_in_bytes:bytes.length,digest:'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex'),expires_at:new Date(Date.now()+3600000).toISOString(),workflow_run:{id:11,head_sha:S,repository_id:repo.id,head_repository_id:repo.id}};
 env.KEEPER_ANDROID_ARTIFACT_ID='19';env.KEEPER_ANDROID_ARTIFACT_DIGEST=artifact.digest.slice(7);
 const check={id:17,name:producer.name,head_sha:S,check_suite:{id:14},app:{id:15368,slug:'github-actions'},status:'completed',conclusion:'success'};
 const state={repo,run,producer,runtime,artifact,check,branch:{name:'sprint',protected:true,commit:{sha:S}},commit:{sha:S,tree:{sha:T}}};
 const get=key=>async()=>({data:state[key]});
 const github={rest:{repos:{get:get('repo'),getBranch:get('branch')},git:{getCommit:get('commit')},checks:{get:get('check')},actions:{getWorkflowRun:get('run'),listJobsForWorkflowRunAttempt:async()=>({data:{total_count:2,jobs:[producer,runtime]}}),getArtifact:get('artifact'),downloadArtifact:async options=>{
  const url='https://api.github.com/repos/'+repo.full_name+'/actions/artifacts/19/zip';
  const response=await options.request.fetch(url,{method:'GET',headers:{authorization:'token MUST_NOT_REACH_STORAGE'}});
  return {status:response.status,headers:{location:response.headers.get('location')}};
 }}}};
 return {env,context,github,state,bytes,directory,close:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('successful producer is admitted during same overall in-progress run, exact attempt and source retained',async()=>{const f=fixture();try{const s=await m.snapshot(f.github,f.context,f.env);assert.equal(s.producer_job_id,13);assert.equal(s.run_attempt,2);assert.equal(s.source_sha,S);assert.equal(s.artifact.id,19);}finally{f.close();}});
test('public protected canonical repository is finite and supported',async()=>{const f=fixture('runtime',false);try{assert.equal((await m.snapshot(f.github,f.context,f.env)).repository_id,470904030);}finally{f.close();}});
test('producer origin writes only actual current producer identity after successful build step',async()=>{const f=fixture('producer');try{await m.producer(f.github,f.context,f.env);const o=JSON.parse(fs.readFileSync(path.join(f.directory,'keeper-android-compile-origin.json')));assert.equal(o.producer_job_id,13);assert.equal(o.source_tree,T);}finally{f.close();}});
for(const [name,change] of [
 ['wrong source',f=>f.state.run.head_sha=W],['wrong attempt',f=>f.state.run.run_attempt=1],['wrong workflow control',f=>f.state.run.referenced_workflows[0].sha=W],
 ['foreign repository',f=>f.state.repo.id=1],['missing positive private visibility',f=>delete f.state.repo.private],['unprotected source',f=>f.state.branch.protected=false],
 ['moved protected source',f=>f.state.branch.commit.sha=W],['failed producer',f=>f.state.producer.conclusion='failure'],['pending producer',f=>f.state.producer.status='in_progress'],
 ['skipped required compile step',f=>f.state.producer.steps[2].conclusion='skipped'],['wrong producer check owner',f=>f.state.check.app.id=1],
 ['wrong producer check head',f=>f.state.check.head_sha=W],['foreign artifact run',f=>f.state.artifact.workflow_run.id=1],['expired artifact',f=>f.state.artifact.expired=true],
 ['wrong archive size',f=>f.state.artifact.size_in_bytes=0],['wrong archive digest',f=>f.state.artifact.digest='sha256:'+'f'.repeat(64)],
 ['failed entire completed run',f=>{f.state.run.status='completed';f.state.run.conclusion='failure';}],
 ['false host role',f=>f.env.KEEPER_ANDROID_CUSTODY_ROLE='other']])test('reject '+name,async()=>{const f=fixture();try{change(f);await assert.rejects(()=>m.snapshot(f.github,f.context,f.env));}finally{f.close();}});
test('authenticated API hop alone receives token; archive hop is separate and both API snapshots match',async()=>{const f=fixture();const calls=[];try{
 const fetchImpl=async(url,init)=>{calls.push({url:String(url),init});if(String(url).startsWith('https://api.github.com/'))return new Response(null,{status:302,headers:{location:'https://unit.blob.core.windows.net/archive?signed=yes'}});return new Response(f.bytes,{status:200});};
 await m.download(f.github,f.context,f.env,fetchImpl);assert.equal(calls[0].init.headers.authorization,'token MUST_NOT_REACH_STORAGE');assert.equal(calls[1].init.headers,undefined);
 assert.equal(calls[1].init.redirect,'error');assert.deepEqual(fs.readFileSync(path.join(f.directory,'keeper-android-checkpoint.zip')),f.bytes);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'keeper-android-compile-admission.json'))).artifact.id,19);
}finally{f.close();}});
test('post-download official artifact movement rejects and purges bytes without admission',async()=>{const f=fixture();try{
 const fetchImpl=async(url)=>{if(String(url).startsWith('https://api.github.com/'))return new Response(null,{status:302,headers:{location:'https://unit.blob.core.windows.net/archive'}});f.state.artifact.size_in_bytes+=1;return new Response(f.bytes,{status:200});};
 await assert.rejects(()=>m.download(f.github,f.context,f.env,fetchImpl));assert.equal(fs.existsSync(path.join(f.directory,'keeper-android-checkpoint.zip')),false);assert.equal(fs.existsSync(path.join(f.directory,'keeper-android-compile-admission.json')),false);
}finally{f.close();}});
for(const location of ['http://unit.blob.core.windows.net/a','https://evil.example/a','https://user:pass@unit.blob.core.windows.net/a'])test('reject unsafe archive redirect '+location,async()=>{const f=fixture();try{await assert.rejects(()=>m.download(f.github,f.context,f.env,async()=>new Response(null,{status:302,headers:{location}})));}finally{f.close();}});
function prFixture(diagnostic=true,priv=true){
 const f=fixture('runtime',priv),ref='refs/pull/99/merge',caller='.github/workflows/keeper-'+(diagnostic?'native-diagnostic':'release-acceptance')+'.yml';
 f.context.eventName='pull_request';f.context.ref=ref;f.context.sha=W;
 const pr={number:99,draft:false,head:{sha:S,ref:'candidate',repo:f.state.repo},base:{ref:'sprint',sha:S,repo:f.state.repo},labels:diagnostic?[{name:'keeper/native-diagnostic'}]:[]};
 f.context.payload={pull_request:structuredClone(pr)};f.github.rest.pulls={get:async()=>({data:pr})};
 f.env.KEEPER_DIAGNOSTIC=String(diagnostic);f.env.GITHUB_WORKFLOW_SHA=W;f.env.GITHUB_WORKFLOW_REF=f.state.repo.full_name+'/'+caller+'@'+ref;
 f.state.run.event='pull_request';f.state.run.path=caller;f.state.run.referenced_workflows=[{path:f.state.repo.full_name+'/.github/workflows/keeper-native-platform.yml@'+W,sha:W,ref}];
 f.state.producer.name='android / Native ANDROID compile producer';f.state.runtime.name='android / Native ANDROID build and probes';f.state.check.name=f.state.producer.name;
 f.pr=pr;return f;
}
test('explicit private diagnostic route is source-generic and not PR73-only',async()=>{const f=prFixture();try{const got=await m.snapshot(f.github,f.context,f.env);assert.equal(got.caller_path,'.github/workflows/keeper-native-diagnostic.yml');assert.equal(got.source_sha,S);assert.equal(got.diagnostic_only,true);}finally{f.close();}});
test('private diagnostic label removal is not bypassed by environment',async()=>{const f=prFixture();try{f.pr.labels=[];await assert.rejects(()=>m.snapshot(f.github,f.context,f.env));}finally{f.close();}});
test('public diagnostic context cannot authorize fixed-tool cleanup/custody',async()=>{const f=prFixture(true,false);try{await assert.rejects(()=>m.host(f.github,f.context,f.env));assert.equal(fs.existsSync(path.join(f.directory,'keeper-android-host-admission.json')),false);}finally{f.close();}});
test('ordinary PR requires installed-base preflight and protected current base',async()=>{const f=prFixture(false);const preflight=require('../native/release_preflight.cjs');const original=preflight.preflight;try{
 preflight.preflight=async()=>({trusted:false});await assert.rejects(()=>m.snapshot(f.github,f.context,f.env));
 preflight.preflight=async()=>({trusted:true});assert.equal((await m.snapshot(f.github,f.context,f.env)).diagnostic_only,false);
 f.state.branch.protected=false;await assert.rejects(()=>m.snapshot(f.github,f.context,f.env));
}finally{preflight.preflight=original;f.close();}});
