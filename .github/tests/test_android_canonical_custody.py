"""Real tiny ZIP/Git controls; no APK, emulator, dependency install or download."""
import copy,hashlib,importlib.util,json,os
from pathlib import Path
import stat,subprocess,tempfile,unittest,zipfile
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('current_android',ROOT/'.github/native/android_canonical_custody.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Custody(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name)/'repo';self.root.mkdir();self.temp=Path(self.tmp.name)/'temp';self.temp.mkdir()
  self.p=patch.object(m,'ROOT',self.root);self.p.start();self.addCleanup(self.p.stop)
  self.write('.github/native/android_apk_checkpoint.py',(ROOT/'.github/native/android_apk_checkpoint.py').read_bytes())
  self.write('package.json',b'{"name":"fixture","version":"0.0.0"}\n')
  self.write('src/input.ts',b'export const value = 1;\n')
  self.write('.gitignore',b'android/app/build/\n')
  for name in m.raw.OVERLAYS:self.write(name,b'original\n')
  self.git('init','-q');self.git('add','.');self.git('-c','user.name=Fixture','-c','user.email=fixture@invalid','commit','-qm','fixture')
  sha=self.git('rev-parse','HEAD').strip();tree=self.git('rev-parse','HEAD^{tree}').strip()
  self.origin={'schema':1,'repository':'KeeperCommunity/bitcoin-keeper-private','repository_id':839671816,'repository_private':True,
   'source_sha':sha,'source_tree':tree,'run_id':11,'run_attempt':2,'workflow_id':12,'workflow_sha':sha,
   'workflow_ref':'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-canonical-native.yml@refs/heads/sprint',
   'caller_path':'.github/workflows/keeper-canonical-native.yml','worker_path':'.github/workflows/keeper-canonical-native-platform.yml',
   'diagnostic_only':False,'producer_job_id':13,'producer_job_name':'android / Canonical ANDROID compile producer'}
  self.env={'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','RUNNER_OS':'Linux','RUNNER_ARCH':'X64','ImageOS':'ubuntu24','KEEPER_NATIVE_PLATFORM':'ANDROID',
   'GITHUB_WORKSPACE':str(self.root),'RUNNER_TEMP':str(self.temp),'GITHUB_REPOSITORY':self.origin['repository'],'GITHUB_REPOSITORY_ID':'839671816','KEEPER_SOURCE_SHA':sha,
   'GITHUB_RUN_ID':'11','GITHUB_RUN_ATTEMPT':'2','GITHUB_WORKFLOW_SHA':sha,'GITHUB_WORKFLOW_REF':self.origin['workflow_ref'],'KEEPER_DIAGNOSTIC':'false','GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/sprint','KEEPER_ANDROID_CUSTODY_ROLE':'producer'}
  overlays=[]
  for name in sorted(m.raw.OVERLAYS):self.write(name,b'synthetic\n');overlays.append({'path':name,'sha256':hashlib.sha256(b'synthetic\n').hexdigest()})
  original=(self.root/'package.json').read_bytes();pkg=json.loads(original);pkg['browser']={};pkg['react-native']={};pkg['browserify']={}
  self.write('package.json',json.dumps(pkg).encode())
  self.apk=b'NOT_AN_APK_CUSTODY_BYTES_ONLY'
  self.metadata={'schema':1,'platform':'ANDROID','app_id':'io.hexawallet.keeper.development','diagnostic_only':False,'build':'PASS',
   **{k:self.origin[k] for k in ('source_sha','workflow_sha','workflow_ref')},'run_id':'11','run_attempt':'2',
   **{k:'NOT RUN' for k in ('smoke','native_keychain','native_probe','r5_features','hardware','signing')},
   'configuration_overlays':overlays,'nodeify_overlay':{'path':'package.json','allowed_fields':['browser','react-native','browserify'],
    'before_sha256':hashlib.sha256(original).hexdigest(),'after_sha256':hashlib.sha256((self.root/'package.json').read_bytes()).hexdigest()},
   'commands':[{'label':'Build debug-key-only development APK','command':['./gradlew',':app:assembleDevelopmentDebug','--no-daemon','--max-workers=2','-PreactNativeArchitectures=x86_64','-Pandroid.buildOnlyTargetAbi=true','-Pandroid.injected.build.abi=x86_64','-Pandroid.injected.testOnly=false','-Pandroid.injected.apk.location='+str(self.root/'android/app/build/outputs/apk'),'--info','--console=plain'],'exit_code':0,'timeout_seconds':3000,'duration_seconds':1}],
   'built_artifact':{'path':m.APK,'sha256':hashlib.sha256(self.apk).hexdigest()}}
  self.write(m.APK,self.apk);self.write_json(m.META,self.metadata)
  (self.temp/'keeper-android-compile-origin.json').write_text(json.dumps(self.origin))
 def write(self,name,data):
  p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 def write_json(self,name,value):self.write(name,json.dumps(value).encode())
 def git(self,*args):return subprocess.check_output(['git',*args],cwd=self.root,text=True,stderr=subprocess.DEVNULL)
 def package(self):m.prepare(self.env)
 def archive(self,mutate=None):
  self.package();files={p.name:p.read_bytes() for p in (self.root/m.OUTPUT).iterdir()}
  if mutate:mutate(files)
  z=self.temp/'keeper-android-checkpoint.zip'
  with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as bundle:
   for name,value in files.items():bundle.writestr(name,value)
  artifact={'id':17,'name':'keeper-android-build-checkpoint-%s-11-2'%self.origin['source_sha'],'sha256':hashlib.sha256(z.read_bytes()).hexdigest(),'size_bytes':z.stat().st_size}
  admitted={**self.origin,'producer_check_run_id':19,'artifact':artifact}
  (self.temp/'keeper-android-compile-admission.json').write_text(json.dumps(admitted))
  self.env.update(KEEPER_ANDROID_CUSTODY_ROLE='runtime',KEEPER_ANDROID_ARTIFACT_ID='17',KEEPER_ANDROID_ARTIFACT_DIGEST=artifact['sha256'])
  current=copy.deepcopy(self.metadata);current['build']='NOT RUN';current['commands']=[];current.pop('built_artifact')
  self.write_json(m.META,current);(self.root/m.APK).unlink()
  return z
 def test_real_roundtrip_preserves_exact_bytes_and_attributes_compile_to_same_run_producer(self):
  z=self.archive();m.restore(self.env);state=m.document(self.root/m.META)
  self.assertFalse(z.exists());self.assertEqual((self.root/m.APK).read_bytes(),self.apk)
  self.assertEqual(state['build'],'PASS');self.assertEqual(state['runtime_host_compilation'],'NOT RUN')
  self.assertEqual(state['android_compile_custody']['producer_job_id'],13)
  self.assertTrue(state['android_compile_custody']['raw_zip_purged'])
  self.assertTrue(all(state[k]=='NOT RUN' for k in ('smoke','native_keychain','native_probe','r5_features')))
 def test_actual_builder_record_is_accepted_by_checkpoint_and_runtime_custody(self):
  spec=importlib.util.spec_from_file_location('actual_cold_builder',ROOT/'.github/native/hosted_native.py')
  native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
  pending=copy.deepcopy(self.metadata);pending['build']='NOT RUN';pending['commands']=[];pending['toolchain']={}
  self.write_json(m.META,pending)
  def command(args,label,timeout=120,capture=False,**options):
   value=native.read();value['commands'].append({'command':args,'label':label,'timeout_seconds':timeout,'exit_code':0,'duration_seconds':1});native.save(value)
   return 'SYNTHETIC_GRADLE_VERSION' if capture else None
  with patch.multiple(native,ROOT=self.root,EVIDENCE=self.root/m.META,PLATFORM='ANDROID'), \
    patch.object(native,'disk_preflight'),patch.object(native,'command',side_effect=command), \
    patch.object(native,'artifact_identity',return_value=self.metadata['built_artifact']):
   native.build()
  actual=m.document(self.root/m.META)
  produced=m.metadata(actual,self.origin,'PASS')
  self.assertEqual(produced['timeout_seconds'],3000)
  self.metadata=actual
  self.archive();m.restore(self.env)
  restored=m.document(self.root/m.META)
  self.assertEqual(restored['android_compile_custody']['producer_build'],produced)
  self.assertEqual((self.root/m.APK).read_bytes(),self.apk)
 def test_old_or_unbounded_compile_budget_is_not_accepted_as_current_profile(self):
  for budget in (2100,3001,999999,True):
   value=copy.deepcopy(self.metadata);value['commands'][0]['timeout_seconds']=budget
   with self.subTest(budget=budget),self.assertRaises(ValueError):m.metadata(value,self.origin,'PASS')
 def test_hidden_assume_unchanged_raw_source_edit_is_rejected_before_packaging(self):
  self.git('update-index','--assume-unchanged','src/input.ts');self.write('src/input.ts',b'mutated\n')
  with self.assertRaises(ValueError):self.package()
 def test_ignored_env_override_is_rejected(self):
  self.write('.git/info/exclude',b'.env.local\n');self.write('.env.local',b'OVERRIDE=yes\n')
  with self.assertRaises(ValueError):self.package()
 def test_source_alias_is_rejected(self):
  p=self.root/'src/input.ts';data=p.read_bytes();p.unlink();outside=Path(self.tmp.name)/'alias';outside.write_bytes(data);p.symlink_to(outside)
  with self.assertRaises((ValueError,OSError)):self.package()
 def test_wrong_current_source_or_attempt_context_rejected(self):
  for key,value in [('KEEPER_SOURCE_SHA','f'*40),('GITHUB_RUN_ATTEMPT','3'),('GITHUB_REF','refs/heads/other'),('GITHUB_REPOSITORY_ID','1')]:
   with self.subTest(key=key),self.assertRaises(ValueError):m.context({**self.env,key:value},'producer')
 def test_native_pass_cannot_be_borrowed_into_checkpoint(self):
  self.metadata['smoke']='PASS';self.write_json(m.META,self.metadata)
  with self.assertRaises(ValueError):self.package()
 def test_noninteger_or_failed_build_status_rejected(self):
  for code in [True,1,124]:
   self.metadata['commands'][0]['exit_code']=code;self.write_json(m.META,self.metadata)
   with self.assertRaises(ValueError):self.package()
 def test_inner_apk_hash_mismatch_is_rejected_and_zip_purged(self):
  z=self.archive(lambda f:f.update({'app-development-debug.apk':b'foreign bytes'}))
  with self.assertRaises(ValueError):m.restore(self.env)
  self.assertFalse(z.exists());self.assertEqual(m.document(self.root/m.META)['build'],'NOT RUN')
 def test_traversal_member_rejected_without_extraction(self):
  z=self.archive(lambda f:f.update({'../escape':f.pop('app-development-debug.apk')}))
  with self.assertRaises(ValueError):m.restore(self.env)
  self.assertFalse((self.temp/'escape').exists());self.assertFalse(z.exists())
 def test_manifest_foreign_producer_or_run_rejected(self):
  def mutate(f):
   d=json.loads(f['manifest.json']);d['origin']['producer_job_id']=99;f['manifest.json']=json.dumps(d).encode()
  self.archive(mutate)
  with self.assertRaises(ValueError):m.restore(self.env)
 def test_configuration_overlay_mismatch_rejected_before_restore(self):
  self.archive();state=m.document(self.root/m.META);state['configuration_overlays'][0]['sha256']='f'*64;self.write_json(m.META,state)
  with self.assertRaises(ValueError):m.restore(self.env)
  self.assertFalse((self.temp/'keeper-android-checkpoint.zip').exists())
 def test_symlink_archive_is_rejected(self):
  z=self.archive();other=self.temp/'real.zip';z.rename(other);z.symlink_to(other)
  with self.assertRaises((ValueError,OSError)):m.restore(self.env)
 def test_existing_apk_is_never_overwritten(self):
  self.archive();self.write(m.APK,b'preexisting')
  with self.assertRaises(FileExistsError):m.restore(self.env)
  self.assertEqual((self.root/m.APK).read_bytes(),b'preexisting')

 def refresh_archive(self,z):
  admission=m.document(self.temp/'keeper-android-compile-admission.json')
  admission['artifact'].update(sha256=hashlib.sha256(z.read_bytes()).hexdigest(),size_bytes=z.stat().st_size)
  self.env['KEEPER_ANDROID_ARTIFACT_DIGEST']=admission['artifact']['sha256']
  (self.temp/'keeper-android-compile-admission.json').write_text(json.dumps(admission))
 def test_symlink_zip_member_rejected_even_with_matching_official_archive_digest(self):
  z=self.archive()
  with zipfile.ZipFile(z) as bundle:files={r.filename:bundle.read(r) for r in bundle.infolist()}
  z.unlink()
  with zipfile.ZipFile(z,'w') as bundle:
   for name,data in files.items():
    row=zipfile.ZipInfo(name);row.external_attr=((stat.S_IFLNK if name.endswith('.apk') else stat.S_IFREG)|0o600)<<16
    bundle.writestr(row,data)
  self.refresh_archive(z)
  with self.assertRaises(ValueError):m.restore(self.env)
  self.assertFalse(z.exists())
 def test_duplicate_zip_member_rejected(self):
  z=self.archive()
  with zipfile.ZipFile(z,'a') as bundle:bundle.writestr('manifest.json',b'{}')
  self.refresh_archive(z)
  with self.assertRaises(ValueError):m.restore(self.env)
 def test_boolean_metadata_schema_rejected(self):
  self.metadata['schema']=True;self.write_json(m.META,self.metadata)
  with self.assertRaises(ValueError):self.package()
 def test_raw_zip_purge_failure_never_records_positive_compilation_restore(self):
  z=self.archive();unlink=Path.unlink
  def denied(path,*args,**kwargs):
   if path==z:raise PermissionError('synthetic purge failure')
   return unlink(path,*args,**kwargs)
  with patch.object(Path,'unlink',denied),self.assertRaises(PermissionError):m.restore(self.env)
  self.assertEqual(m.document(self.root/m.META)['build'],'NOT RUN')

if __name__=='__main__':unittest.main()
