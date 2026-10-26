'use strict';
// Same-source/same-run Android compile custody. No signing, dispatch or credentials in receipts.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const profiles = require('./release_repository_profiles.cjs');
const SHA = /^[a-f0-9]{40}$/, HEX = /^sha256:[a-f0-9]{64}$/;
const MAX_ARCHIVE = 514 * 1024 * 1024;
const requireFact = v => { if (!v) throw Error('ANDROID_CANONICAL_CUSTODY_REJECTED'); };
const id = n => Number.isSafeInteger(n) && n > 0;
const artifactName = (source, run, attempt) => `keeper-android-build-checkpoint-${source}-${run}-${attempt}`;
const names = canonical => ({ producer: `android / ${canonical ? 'Canonical' : 'Native'} ANDROID compile producer`,
  runtime: `android / ${canonical ? 'Canonical ANDROID build and features' : 'Native ANDROID build and probes'}` });
const requiredProducerSteps = ['Verify Android hosted source admission', 'Record runner and toolchain', 'Install immutable native dependencies',
  'Build development app', 'Record official Android compile producer', 'Prepare exact Android build checkpoint',
  'Upload exact Android build checkpoint'];
function step(job, name) {
  const matches = job.steps?.filter(x => x.name === name) || [];
  requireFact(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success');
}
function artifactIdentity(a, run, repository, source, attempt) {
  requireFact(id(a.id) && a.name === artifactName(source, run.id, attempt) && a.expired === false &&
    id(a.size_in_bytes) && a.size_in_bytes <= MAX_ARCHIVE && HEX.test(a.digest || '') &&
    Number.isFinite(Date.parse(a.expires_at)) && Date.parse(a.expires_at) > Date.now() &&
    a.workflow_run?.id === run.id && a.workflow_run.head_sha === source &&
    a.workflow_run.repository_id === repository.id && a.workflow_run.head_repository_id === repository.id);
  return { id: a.id, name: a.name, sha256: a.digest.slice(7), size_bytes: a.size_in_bytes };
}
async function admission(github, context, env, role) {
  requireFact(['producer', 'runtime'].includes(role) && env.KEEPER_ANDROID_CUSTODY_ROLE === role &&
    env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.RUNNER_OS === 'Linux' &&
    env.RUNNER_ARCH === 'X64' && env.ImageOS === 'ubuntu24' && env.KEEPER_NATIVE_PLATFORM === 'ANDROID');
  const profile = profiles.forContext(context), args = { ...context.repo };
  const repository = (await github.rest.repos.get(args)).data;
  requireFact(profiles.matches(repository, profile) && repository.private === profile.private &&
    String(repository.id) === env.GITHUB_REPOSITORY_ID && repository.full_name === env.GITHUB_REPOSITORY);
  const source = env.KEEPER_SOURCE_SHA, runId = Number(env.GITHUB_RUN_ID), attempt = Number(env.GITHUB_RUN_ATTEMPT);
  requireFact(SHA.test(source || '') && id(runId) && id(attempt) && SHA.test(env.GITHUB_WORKFLOW_SHA || ''));
  const canonical = context.eventName === 'workflow_dispatch';
  let caller, ref, diagnostic = env.KEEPER_DIAGNOSTIC === 'true';
  if (canonical) {
    caller = '.github/workflows/keeper-canonical-native.yml'; ref = 'refs/heads/sprint';
    requireFact(context.ref === ref && context.sha === source && env.GITHUB_WORKFLOW_SHA === source && !diagnostic);
    const branch = (await github.rest.repos.getBranch({ ...args, branch: 'sprint' })).data;
    requireFact(branch.name === 'sprint' && branch.protected === true && branch.commit?.sha === source);
  } else {
    requireFact(context.eventName === 'pull_request' && id(context.payload.pull_request?.number));
    const initial = context.payload.pull_request;
    const pr = (await github.rest.pulls.get({ ...args, pull_number: initial.number })).data;
    requireFact(pr.number !== 7045 && pr.head?.sha === source && initial.head.sha === source &&
      profiles.matches(pr.head.repo, profile) && profiles.matches(pr.base.repo, profile) && pr.base.ref === 'sprint');
    ref = `refs/pull/${pr.number}/merge`;
    if (diagnostic) {
      requireFact(profile.private && pr.labels?.some(x => x.name === 'keeper/native-diagnostic'));
      caller = '.github/workflows/keeper-native-diagnostic.yml';
    } else {
      requireFact(pr.draft === false && (await require('./release_preflight.cjs').preflight(github, context)).trusted === true);
      const branch = (await github.rest.repos.getBranch({ ...args, branch: 'sprint' })).data;
      requireFact(branch.protected === true && branch.commit?.sha === pr.base.sha);
      caller = '.github/workflows/keeper-release-acceptance.yml';
    }
  }
  requireFact(env.GITHUB_WORKFLOW_REF === `${profile.repository}/${caller}@${ref}`);
  const run = (await github.rest.actions.getWorkflowRun({ ...args, run_id: runId })).data;
  const worker = `.github/workflows/keeper-${canonical ? 'canonical-' : ''}native-platform.yml`;
  requireFact(run.id === runId && run.run_attempt === attempt && run.head_sha === source &&
    profiles.matches(run.repository, profile) && profiles.matches(run.head_repository, profile) &&
    run.event === context.eventName && run.path?.split('@')[0] === caller && id(run.workflow_id) && id(run.check_suite_id) &&
    (run.status === 'in_progress' || (run.status === 'completed' && run.conclusion === 'success')) &&
    run.referenced_workflows?.filter(x => x.path === `${profile.repository}/${worker}@${env.GITHUB_WORKFLOW_SHA}` &&
      x.ref === ref && x.sha === env.GITHUB_WORKFLOW_SHA).length === 1);
  const commit = (await github.rest.git.getCommit({ ...args, commit_sha: source })).data;
  requireFact(commit.sha === source && SHA.test(commit.tree?.sha || ''));
  const jobs = (await github.rest.actions.listJobsForWorkflowRunAttempt({ ...args, run_id: runId,
    attempt_number: attempt, per_page: 100 })).data;
  requireFact(id(jobs.total_count) && jobs.total_count <= 100 && jobs.jobs?.length === jobs.total_count);
  const expected = names(canonical), current = jobs.jobs.filter(j => j.name === expected[role] && j.runner_name === env.RUNNER_NAME);
  requireFact(current.length === 1 && id(current[0].id) && current[0].run_id === runId && current[0].run_attempt === attempt &&
    current[0].head_sha === source && current[0].status === 'in_progress');
  const origin = { schema: 1, repository: profile.repository, repository_id: repository.id,
    repository_private: repository.private, source_sha: source, source_tree: commit.tree.sha,
    run_id: runId, run_attempt: attempt, workflow_id: run.workflow_id, workflow_sha: env.GITHUB_WORKFLOW_SHA,
    workflow_ref: env.GITHUB_WORKFLOW_REF, caller_path: caller, worker_path: worker, diagnostic_only: diagnostic };
  return { args, run, jobs: jobs.jobs, expected, origin, current: current[0] };
}
async function producer(github, context, env) {
  const a = await admission(github, context, env, 'producer');
  step(a.current, 'Build development app');
  const result = { ...a.origin, producer_job_id: a.current.id, producer_job_name: a.current.name };
  fs.writeFileSync(path.join(env.RUNNER_TEMP, 'keeper-android-compile-origin.json'), JSON.stringify(result) + '\n', {flag:'wx',mode:0o600});
  return result;
}
async function snapshot(github, context, env) {
  const a = await admission(github, context, env, 'runtime');
  const selected = a.jobs.filter(j => j.name === a.expected.producer);
  requireFact(selected.length === 1); const job = selected[0];
  requireFact(id(job.id) && job.run_id === a.run.id && job.run_attempt === a.origin.run_attempt &&
    job.head_sha === a.origin.source_sha && job.status === 'completed' && job.conclusion === 'success');
  for (const name of requiredProducerSteps) step(job, name);
  const match = job.check_run_url?.match(new RegExp(`^https://api\\.github\\.com/repos/${a.origin.repository}/check-runs/([1-9][0-9]*)$`));
  requireFact(match); const check = (await github.rest.checks.get({...a.args,check_run_id:Number(match[1])})).data;
  requireFact(check.id === Number(match[1]) && check.name === job.name && check.head_sha === a.origin.source_sha &&
    check.check_suite?.id === a.run.check_suite_id && check.app?.id === 15368 && check.app.slug === 'github-actions' &&
    check.status === 'completed' && check.conclusion === 'success');
  const artifactId = Number(env.KEEPER_ANDROID_ARTIFACT_ID);
  requireFact(id(artifactId));
  const info = (await github.rest.actions.getArtifact({...a.args,artifact_id:artifactId})).data;
  const artifact = artifactIdentity(info,a.run,{id:a.origin.repository_id},a.origin.source_sha,a.origin.run_attempt);
  requireFact(artifact.sha256 === env.KEEPER_ANDROID_ARTIFACT_DIGEST);
  return { ...a.origin, producer_job_id: job.id, producer_job_name: job.name, producer_check_run_id: check.id, artifact };
}
async function download(github, context, env, fetchImpl=fetch) {
  const before = await snapshot(github,context,env), target = path.join(env.RUNNER_TEMP,'keeper-android-checkpoint.zip');
  const apiURL = `https://api.github.com/repos/${before.repository}/actions/artifacts/${before.artifact.id}/zip`;
  let intercepted=false, fd, created=false, owner;
  try {
    const response=await github.rest.actions.downloadArtifact({...context.repo,artifact_id:before.artifact.id,archive_format:'zip',
      request:{timeout:30000,parseSuccessResponseBody:false,fetch:async(url,init)=>{
        requireFact(!intercepted && url===apiURL && init?.method==='GET' && init.body==null);intercepted=true;
        const r=await fetchImpl(url,{...init,redirect:'manual',signal:AbortSignal.timeout(30000)});
        try {requireFact(r.status===302);return r;} finally {await r.body?.cancel();}
      }}});
    requireFact(intercepted && response.status===302);
    const url=new URL(response.headers.location);
    requireFact(url.protocol==='https:' && !url.username && !url.password && !url.hash && (!url.port||url.port==='443') &&
      (url.hostname.endsWith('.blob.core.windows.net')||url.hostname.endsWith('.actions.githubusercontent.com')));
    fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);created=true;
    const createdInfo=fs.fstatSync(fd);owner=[createdInfo.dev,createdInfo.ino];
    const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(180000)});
    const reader=r.body?.getReader();requireFact(r.ok && reader);
    let size=0;const hash=crypto.createHash('sha256');
    try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      requireFact(size<=before.artifact.size_bytes && size<=MAX_ARCHIVE);hash.update(value);let at=0;while(at<value.length){const written=fs.writeSync(fd,value,at,value.length-at);requireFact(written>0);at+=written;}}}
    finally {await reader.cancel();}
    fs.closeSync(fd);fd=undefined;
    requireFact(size===before.artifact.size_bytes && hash.digest('hex')===before.artifact.sha256);
    const after=await snapshot(github,context,env);requireFact(equal(before,after));
    fs.writeFileSync(path.join(env.RUNNER_TEMP,'keeper-android-compile-admission.json'),JSON.stringify(before)+'\n',{flag:'wx',mode:0o600});
    return before;
  } catch(e) {if(fd!==undefined)fs.closeSync(fd);if(created){const current=fs.lstatSync(target);requireFact(current.isFile() && current.dev===owner[0] && current.ino===owner[1]);fs.unlinkSync(target);}throw Error('ANDROID_CANONICAL_CUSTODY_REJECTED');}
}
async function host(github,context,env) {
  const a=await admission(github,context,env,env.KEEPER_ANDROID_CUSTODY_ROLE);
  const value={...a.origin,role:env.KEEPER_ANDROID_CUSTODY_ROLE,current_job_id:a.current.id};
  fs.writeFileSync(path.join(env.RUNNER_TEMP,'keeper-android-host-admission.json'),JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
  return value;
}
module.exports={admission,host,producer,snapshot,download,artifactIdentity,artifactName,requiredProducerSteps};
