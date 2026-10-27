"""Exact current-source Android compile checkpoint and fresh-host restoration.

The producer and runtime are jobs of one official run/attempt. Build PASS on the
runtime attributes compilation to that successful producer; no native pass is copied.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
APK = 'android/app/build/outputs/apk/development/debug/app-development-debug.apk'
META = 'artifacts/native/android/metadata.json'
OUTPUT = 'artifacts/android-build-checkpoint'
MAX_APK, MAX_META = 512 * 1024 ** 2, 1024 ** 2
FILES = {'app-development-debug.apk': APK, 'build-metadata.json': META}
SCOPE = 'SAME_CURRENT_SOURCE_SAME_RUN_OFFICIAL_ANDROID_COMPILE_PRODUCER'


def require(value):
    if not value: raise ValueError('ANDROID_CANONICAL_CUSTODY_REJECTED')


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


raw = module('android_apk_checkpoint')


def document(path):
    base = raw.directory(path.parent)
    try: return raw.json_document(raw.read_file(base, path.name, MAX_META)['bytes'])
    finally: os.close(base)


def save(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as output:
        output.write((json.dumps(value, sort_keys=True) + '\n').encode())


def context(env, role):
    require(role in ('producer', 'runtime') and env.get('KEEPER_ANDROID_CUSTODY_ROLE') == role)
    fixed = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux',
        'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24', 'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'GITHUB_WORKSPACE': str(ROOT)}
    require(all(env.get(k) == v for k,v in fixed.items()))
    origin = document(Path(env['RUNNER_TEMP']) / ('keeper-android-compile-origin.json' if role == 'producer' else 'keeper-android-compile-admission.json'))
    profiles = {'KeeperCommunity/bitcoin-keeper': (470904030,False), 'KeeperCommunity/bitcoin-keeper-private': (839671816,True)}
    require(origin.get('repository') in profiles)
    rid, private = profiles[origin['repository']]
    require(type(origin.get('schema')) is int and origin.get('schema') == 1 and type(origin.get('repository_id')) is int and origin['repository_id'] == rid and
        origin.get('repository_private') is private and env.get('GITHUB_REPOSITORY') == origin['repository'] and env.get('GITHUB_REPOSITORY_ID') == str(rid))
    for key in ('source_sha','source_tree','workflow_sha'):
        require(type(origin.get(key)) is str and re.fullmatch('[a-f0-9]{40}',origin[key]))
    for key in ('run_id','run_attempt','workflow_id','producer_job_id'):
        require(type(origin.get(key)) is int and 0 < origin[key] < 2 ** 53)
    require(origin['source_sha'] == env.get('KEEPER_SOURCE_SHA') == raw.git(ROOT,'rev-parse','HEAD').decode().strip())
    require(origin['source_tree'] == raw.git(ROOT,'rev-parse','HEAD^{tree}').decode().strip())
    require(str(origin['run_id']) == env.get('GITHUB_RUN_ID') and str(origin['run_attempt']) == env.get('GITHUB_RUN_ATTEMPT') and
        origin['workflow_sha'] == env.get('GITHUB_WORKFLOW_SHA') and origin.get('workflow_ref') == env.get('GITHUB_WORKFLOW_REF') and
        origin.get('diagnostic_only') is (env.get('KEEPER_DIAGNOSTIC') == 'true'))
    canonical = env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
    if canonical:
        require(origin['caller_path'] == '.github/workflows/keeper-canonical-native.yml' and env.get('GITHUB_REF') == 'refs/heads/sprint' and
            origin['workflow_sha'] == origin['source_sha'] and not origin['diagnostic_only'])
    else:
        require(env.get('GITHUB_EVENT_NAME') == 'pull_request')
        require(origin['caller_path'] == ('.github/workflows/keeper-native-diagnostic.yml' if origin['diagnostic_only'] else '.github/workflows/keeper-release-acceptance.yml'))
        require(not origin['diagnostic_only'] or private)
    require(origin['worker_path'] == '.github/workflows/keeper-' + ('canonical-' if canonical else '') + 'native-platform.yml')
    require(origin['producer_job_name'] == 'android / ' + ('Canonical' if canonical else 'Native') + ' ANDROID compile producer')
    return origin


def metadata(value, origin, built):
    require(type(value) is dict and type(value.get('schema')) is int and value.get('schema') == 1 and value.get('platform') == 'ANDROID' and
        value.get('app_id') == 'io.hexawallet.keeper.development' and value.get('diagnostic_only') is origin['diagnostic_only'] and value.get('build') == built)
    for k in ('source_sha','workflow_sha','workflow_ref'): require(value.get(k) == origin[k])
    for k in ('run_id','run_attempt'): require(value.get(k) == str(origin[k]))
    require(all(value.get(k,'NOT RUN') == 'NOT RUN' for k in ('smoke','native_keychain','native_probe','r5_features','hardware','signing')))
    if built == 'PASS':
        rows = [r for r in value.get('commands',[]) if r.get('label') == 'Build debug-key-only development APK']
        require(len(rows)==1 and type(rows[0].get('exit_code')) is int and rows[0]['exit_code']==0 and rows[0].get('timeout_seconds')==3000)
        expected=['./gradlew',':app:assembleDevelopmentDebug','--no-daemon','--max-workers=2','-PreactNativeArchitectures=x86_64','-Pandroid.buildOnlyTargetAbi=true','-Pandroid.injected.build.abi=x86_64','-Pandroid.injected.testOnly=false']
        argv=rows[0].get('command');require(type(argv) is list and len(argv)==11 and argv[:8]==expected and argv[9:]==['--info','--console=plain'] and
            type(argv[8]) is str and argv[8].startswith('-Pandroid.injected.apk.location=/') and argv[8].endswith('/android/app/build/outputs/apk'))
        require(value.get('built_artifact',{}).get('path') == APK and re.fullmatch('[a-f0-9]{64}',value['built_artifact'].get('sha256','')))
        return rows[0]


def source(root, value):
    base = raw.directory(root)
    try: raw.committed_bytes(root,base,value)
    finally: os.close(base)
    # Ignored platform variants and local environment overrides are source too.
    paths = ('.env*','src','patches','.github/native','App.*','AndroidFontFix.*','index.*','shim.*','metro.config.*','babel.config.*','react-native.config.*')
    for ignored in ((),('--ignored',)):
        for entry in raw.git(root,'ls-files','--others','--exclude-standard',*ignored,'-z','--',*paths,*(('android','ios') if not ignored else ())).split(b'\0'):
            if entry: require(entry.decode() in raw.OVERLAYS or re.fullmatch(rb'\.github/native/__pycache__/[A-Za-z0-9_]+\.cpython-[0-9]+\.pyc',entry) is not None)


def prepare(env):
    origin = context(env,'producer'); value = document(ROOT/META); metadata(value,origin,'PASS'); source(ROOT,value)
    base = raw.directory(ROOT); output = ROOT/OUTPUT
    parent = raw.directory(output.parent); created = False
    try:
        os.mkdir(output.name,0o700,dir_fd=parent); created=True
        descriptor = raw.directory(output)
        try:
            files={}
            for name,relative in FILES.items():
                with os.fdopen(os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=descriptor),'wb') as target:
                    observed=raw.read_file(base,relative,MAX_APK if name.endswith('.apk') else MAX_META,target)
                files[name]={'source_path':relative,'sha256':observed['sha256'],'size_bytes':observed['size_bytes']}
            require(files['app-development-debug.apk']['sha256'] == value['built_artifact']['sha256'])
            save(output/'manifest.json',{'schema':1,'scope':SCOPE,'native_acceptance':False,'release_artifact':False,'origin':origin,'files':files})
            source(ROOT,value); require(document(ROOT/META)==value)
        finally: os.close(descriptor)
    except BaseException:
        if created:
            for name in (*FILES,'manifest.json'):
                try:(output/name).unlink()
                except FileNotFoundError:pass
            output.rmdir()
        raise
    finally: os.close(parent);os.close(base)


def manifest(value, origin):
    require(type(value) is dict and set(value)=={'schema','scope','native_acceptance','release_artifact','origin','files'} and
        type(value['schema']) is int and value['schema']==1 and value['scope']==SCOPE and value['native_acceptance'] is False and value['release_artifact'] is False)
    expected={k:v for k,v in origin.items() if k not in ('producer_check_run_id','artifact')}
    require(value['origin']==expected and set(value['files'])==set(FILES))
    for name,row in value['files'].items():
        require(set(row)=={'source_path','sha256','size_bytes'} and row['source_path']==FILES[name] and
            type(row['size_bytes']) is int and 0<row['size_bytes']<=(MAX_APK if name.endswith('.apk') else MAX_META) and
            re.fullmatch('[a-f0-9]{64}',row['sha256']))
    return value


def _restore(env):
    origin=context(env,'runtime'); artifact=origin['artifact']
    require(set(artifact)=={'id','name','sha256','size_bytes'} and type(artifact['id']) is int and artifact['id']>0 and
        artifact['name']=='keeper-android-build-checkpoint-%s-%s-%s'%(origin['source_sha'],origin['run_id'],origin['run_attempt']) and
        artifact['sha256']==env.get('KEEPER_ANDROID_ARTIFACT_DIGEST') and str(artifact['id'])==env.get('KEEPER_ANDROID_ARTIFACT_ID'))
    value=document(ROOT/META);metadata(value,origin,'NOT RUN');source(ROOT,value)
    archive=Path(env['RUNNER_TEMP'])/'keeper-android-checkpoint.zip';base=raw.directory(archive.parent)
    state=Path(env['RUNNER_TEMP'])/'keeper-android-current-checkpoint';state.mkdir(mode=0o700)
    fd=os.open(archive.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=base);os.close(base)
    owner=None
    try:
        with os.fdopen(fd,'rb') as stream:
            info=os.fstat(stream.fileno());owner=(info.st_dev,info.st_ino)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==os.getuid() and info.st_size==artifact['size_bytes'] and 0<info.st_size<=514*1024**2)
            hashed=hashlib.sha256()
            for block in iter(lambda:stream.read(1024**2),b''):hashed.update(block)
            require(hashed.hexdigest()==artifact['sha256']);stream.seek(0)
            with zipfile.ZipFile(stream) as bundle:
                members=bundle.infolist();require(len(members)==3 and {m.filename for m in members}==set(FILES)|{'manifest.json'})
                for m in members:
                    require(m.filename==m.orig_filename and not m.flag_bits&1 and m.compress_type in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED) and
                        stat.S_IFMT(m.external_attr>>16) in (0,stat.S_IFREG) and 0<m.file_size<=(MAX_APK if m.filename.endswith('.apk') else MAX_META))
                manifest_bytes=bundle.read('manifest.json');declared=manifest(raw.json_document(manifest_bytes),origin)
                for name,row in declared['files'].items():
                    require(bundle.getinfo(name).file_size==row['size_bytes'])
                    digest=hashlib.sha256();total=0
                    with bundle.open(name) as source_stream, os.fdopen(os.open(state/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as target:
                        for block in iter(lambda:source_stream.read(1024**2),b''):
                            total+=len(block);require(total<=row['size_bytes']);digest.update(block);target.write(block)
                    require(total==row['size_bytes'] and digest.hexdigest()==row['sha256'])
                require(raw.fingerprint(info)==raw.fingerprint(os.fstat(stream.fileno())))
    finally:
        named=archive.lstat();require(owner==(named.st_dev,named.st_ino) and stat.S_ISREG(named.st_mode));archive.unlink()
    old=document(state/'build-metadata.json');build=metadata(old,origin,'PASS')
    require(old['configuration_overlays']==value['configuration_overlays'] and old['nodeify_overlay']==value['nodeify_overlay'])
    require(old['built_artifact']['sha256']==declared['files']['app-development-debug.apk']['sha256'])
    # Restore only the exact expected APK, with no ancestor links and no overwrite.
    parent=ROOT
    for part in Path(APK).parts[:-1]:
        parent/=part
        if not parent.exists():parent.mkdir(mode=0o700)
        descriptor=raw.directory(parent);os.close(descriptor)
    staged=raw.directory(state)
    try:
        with os.fdopen(os.open(ROOT/APK,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as target:
            actual=raw.read_file(staged,'app-development-debug.apk',MAX_APK,target)
    finally:os.close(staged)
    require(actual['sha256']==old['built_artifact']['sha256']);source(ROOT,value);require(document(ROOT/META)==value)
    value.update(build='PASS',built_artifact=old['built_artifact'],build_execution_scope=SCOPE,
        current_source_compilation='PASS_OFFICIAL_SAME_RUN_PRODUCER_JOB',runtime_host_compilation='NOT RUN',
        android_compile_custody={**origin,'status':'PASS','native_acceptance':False,'producer_build':build,
            'manifest_sha256':hashlib.sha256(manifest_bytes).hexdigest(),
            'producer_metadata_sha256':declared['files']['build-metadata.json']['sha256'],
            'apk_sha256':actual['sha256'],'apk_size_bytes':actual['size_bytes'],'raw_zip_purged':not archive.exists()})
    temporary=ROOT/(META+'.current-checkpoint');save(temporary,value);os.replace(temporary,ROOT/META)


def restore(env):
    archive=Path(env['RUNNER_TEMP'])/'keeper-android-checkpoint.zip'
    observed=archive.lstat()
    require(stat.S_ISREG(observed.st_mode) and observed.st_nlink==1 and observed.st_uid==os.getuid())
    owner=observed.st_dev,observed.st_ino
    try:
        return _restore(env)
    finally:
        try:remaining=archive.lstat()
        except FileNotFoundError:pass
        else:
            require(stat.S_ISREG(remaining.st_mode) and (remaining.st_dev,remaining.st_ino)==owner)
            archive.unlink()


def main():
    require(len(sys.argv)==2 and sys.argv[1] in ('prepare','restore'))
    globals()[sys.argv[1]](os.environ)

if __name__=='__main__':main()
