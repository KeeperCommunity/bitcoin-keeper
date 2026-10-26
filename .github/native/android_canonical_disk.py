"""Generic admitted Android host: fixed unused stock only, unchanged24/12GiB budgets."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import stat
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
TARGET=24*1024**3
RESERVE=12*1024**3


def require(value):
    if not value:raise ValueError('ANDROID_CANONICAL_DISK_REJECTED')


def load(name):
    p=Path(__file__).with_name(name+'.py')
    require(p.read_bytes()==subprocess.check_output(['git','show','HEAD:.github/native/'+name+'.py'],cwd=ROOT))
    spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def context(env):
    fixed={'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','RUNNER_OS':'Linux','RUNNER_ARCH':'X64',
        'ImageOS':'ubuntu24','KEEPER_NATIVE_PLATFORM':'ANDROID','GITHUB_WORKSPACE':str(ROOT),'RUNNER_TOOL_CACHE':'/opt/hostedtoolcache'}
    require(all(env.get(k)==v for k,v in fixed.items()))
    require(platform.system()=='Linux' and platform.machine()=='x86_64' and platform.freedesktop_os_release().get('VERSION_ID')=='24.04')
    require(ROOT.resolve(strict=True)==ROOT and Path.cwd()==ROOT)
    source=load('android_apk_checkpoint');base=source.directory(Path(env['RUNNER_TEMP']))
    try:admitted=source.json_document(source.read_file(base,'keeper-android-host-admission.json',16384)['bytes'])
    finally:os.close(base)
    require(type(admitted.get('schema')) is int and admitted['schema']==1 and admitted.get('role')==env.get('KEEPER_ANDROID_CUSTODY_ROLE') and admitted['role'] in ('producer','runtime'))
    require(type(admitted.get('current_job_id')) is int and 0<admitted['current_job_id']<2**53)
    profiles={'KeeperCommunity/bitcoin-keeper':(470904030,False),'KeeperCommunity/bitcoin-keeper-private':(839671816,True)}
    require(admitted.get('repository') in profiles)
    rid,private=profiles[admitted['repository']]
    require(admitted.get('repository_id')==rid and admitted.get('repository_private') is private and env.get('GITHUB_REPOSITORY')==admitted['repository'] and env.get('GITHUB_REPOSITORY_ID')==str(rid))
    for key,variable in [('source_sha','KEEPER_SOURCE_SHA'),('workflow_sha','GITHUB_WORKFLOW_SHA'),('workflow_ref','GITHUB_WORKFLOW_REF')]:require(admitted.get(key)==env.get(variable))
    for key,variable in [('run_id','GITHUB_RUN_ID'),('run_attempt','GITHUB_RUN_ATTEMPT')]:require(type(admitted.get(key)) is int and admitted[key]>0 and str(admitted[key])==env.get(variable))
    require(subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==admitted['source_sha'])
    if env.get('GITHUB_EVENT_NAME')=='workflow_dispatch':
        require(env.get('GITHUB_REF')=='refs/heads/sprint' and admitted['source_sha']==admitted['workflow_sha'] and admitted.get('diagnostic_only') is False and admitted.get('caller_path')=='.github/workflows/keeper-canonical-native.yml')
    else:
        require(env.get('GITHUB_EVENT_NAME')=='pull_request' and (admitted.get('diagnostic_only') is False or private))
        require(admitted.get('caller_path')==('.github/workflows/keeper-native-diagnostic.yml' if admitted.get('diagnostic_only') else '.github/workflows/keeper-release-acceptance.yml'))
    require(all(env.get(k)=='/usr/local/lib/android/sdk' for k in ('ANDROID_HOME','ANDROID_SDK_ROOT')))
    return admitted


def prepare(env):
    context(env)
    policy=load('android_runner_disk');extra=load('android_runtime_stock_codeql')
    require(policy.TARGET==extra.TARGET==TARGET and policy.RESERVE==extra.RESERVE==RESERVE)
    candidates=(*policy.TOOLS,*extra.EXTRA)
    require(len(candidates)==5)
    # Extend the existing active executable/open FD/mapped-library check to all
    # five fixed unused targets. No deletion selector is accepted from env/input.
    extra.EXTRA=candidates
    extra.runtime_paths_clear(ROOT,env)
    for alias in (extra.SDK/'ndk-bundle',extra.SDK/'ndk/default',extra.SDK/'ndk/latest'):
        if alias.exists() or alias.is_symlink():require(not alias.resolve().is_relative_to(extra.NDK))
    result={'schema':1,'scope':'ADMITTED_GENERIC_ANDROID_FIXED_UNUSED_STOCK_ONLY','target_bytes':TARGET,'reserve_bytes':RESERVE,'removed':[],'native_acceptance':False}
    before=policy.free_bytes();result['before_free_bytes']=before
    if before>=TARGET:return {**result,'result':'PASS','after_free_bytes':before}
    def identity(label,path):return policy.stock_identity(path) if label in policy.REMOVE else extra.stock_identity(policy,path)
    identities={label:identity(label,path) for label,path in candidates}
    existing=[path for label,path in candidates if identities[label] is not None]
    sizes=extra.allocated_bytes(existing) if existing else {}
    require(before+sum(sizes.values())>=TARGET)
    result['measured_reclaim_bytes']={str(p):n for p,n in sizes.items()}
    for label,path in candidates:
        if identities[label] is None:continue
        extra.runtime_paths_clear(ROOT,env);require(identity(label,path)==identities[label])
        command=(policy.REMOVE if label in policy.REMOVE else extra.REMOVE)[label]
        require(subprocess.run(command,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=120,check=False).returncode==0)
        try:path.lstat()
        except FileNotFoundError:result['removed'].append(label)
        require(label in result['removed'])
        after=policy.free_bytes()
        if after>=TARGET:return {**result,'result':'PASS','after_free_bytes':after}
    raise ValueError('ANDROID_CANONICAL_DISK_BUDGET_UNAVAILABLE')

if __name__=='__main__':
    require(len(sys.argv)==1)
    print(json.dumps(prepare(os.environ),sort_keys=True))
