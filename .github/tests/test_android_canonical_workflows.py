"""Workflow graph and fixed-disk authority contracts; never removes stock tools."""
import copy,importlib.util,json,os,py_compile,subprocess,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
import yaml
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('canonical_disk',ROOT/'.github/native/android_canonical_disk.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Workflows(unittest.TestCase):
 def workflows(self):
  for canonical in (False,True):
   name='keeper-'+('canonical-' if canonical else '')+'native-platform.yml'
   yield canonical,yaml.safe_load((ROOT/'.github/workflows'/name).read_text())
 def test_job_start_prevents_execution_of_valid_forged_helper_bytecode(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary);source=root/'cache_probe.py'
   cache=root/'__pycache__'/('cache_probe.'+sys.implementation.cache_tag+'.pyc');cache.parent.mkdir()
   source.write_text("marker='cached'\n");os.utime(source,(1000000000,1000000000))
   py_compile.compile(str(source),cfile=str(cache),doraise=True,invalidation_mode=py_compile.PycInvalidationMode.TIMESTAMP)
   source.write_text("marker='source'\n");os.utime(source,(1000000000,1000000000))
   probe="import importlib.util,sys;s=importlib.util.spec_from_file_location('cache_probe',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.marker)"
   def execute(env):
    return subprocess.check_output([sys.executable,'-B','-c',probe,str(source)],env=env,text=True,timeout=10).strip()
   clean={'PATH':os.environ.get('PATH','')}
   self.assertEqual(execute(clean),'cached','-B alone must reproduce the real cached-code bypass')
   for canonical,workflow in self.workflows():
    for name,job in workflow['jobs'].items():
     with self.subTest(canonical=canonical,job=name):
      env=job['env'];self.assertEqual(env['PYTHONPYCACHEPREFIX'],'/dev/null');self.assertEqual(env['PYTHONDONTWRITEBYTECODE'],'1')
      self.assertEqual(execute({**clean,**{key:env[key] for key in ['PYTHONPYCACHEPREFIX','PYTHONDONTWRITEBYTECODE']}}),'source')
 def test_android_compiler_cannot_start_emulator_and_runtime_requires_producer(self):
  for canonical,d in self.workflows():
   producer=d['jobs']['android-build'];runtime=d['jobs']['native']
   self.assertEqual(producer['runs-on'],'ubuntu-24.04');self.assertEqual(producer['timeout-minutes'],120)
   self.assertFalse(any('emulator-runner@' in s.get('uses','') for s in producer['steps']))
   self.assertEqual(runtime['needs'],['android-build']);self.assertIn("needs.android-build.result == 'success'",runtime['if'])
   self.assertIn('always()',runtime['if']);self.assertIn('macos-15',runtime['runs-on']);self.assertNotIn('intel',runtime['runs-on'])
   builds=[s for s in runtime['steps'] if s.get('name')=='Build development app'];self.assertEqual(len(builds),1);self.assertIn("inputs.platform == 'IOS'",builds[0]['if'])
 def test_exact_artifact_job_outputs_and_mandatory_custody_steps(self):
  for canonical,d in self.workflows():
   producer=d['jobs']['android-build'];runtime=d['jobs']['native'];names=[s.get('name') for s in producer['steps']]
   self.assertLess(names.index('Build development app'),names.index('Record official Android compile producer'))
   self.assertLess(names.index('Prepare exact Android build checkpoint'),names.index('Upload exact Android build checkpoint'))
   upload=next(s for s in producer['steps'] if s.get('id')=='checkpoint')
   self.assertIn('inputs.source_sha',upload['with']['name']);self.assertIn('github.run_attempt',upload['with']['name'])
   self.assertEqual(producer['outputs']['artifact_id'],'${{ steps.checkpoint.outputs.artifact-id }}')
   self.assertEqual(runtime['env']['KEEPER_ANDROID_ARTIFACT_ID'],'${{ needs.android-build.outputs.artifact_id }}')
   rnames=[s.get('name') for s in runtime['steps']]
   self.assertLess(rnames.index('Verify exact Android compile artifact before download'),rnames.index('Restore exact Android compile artifact'))
   self.assertEqual(d['permissions']['actions'],'read');self.assertEqual(d['permissions']['checks'],'read')
 def test_ios_and_android_required_phases_and_no_normal_driver_sentinel(self):
  for canonical,d in self.workflows():
   steps=d['jobs']['native']['steps'];names=[s.get('name') for s in steps]
   self.assertNotIn('Check disposable iOS driver readiness',names)
   expected=['Run disposable startup smoke','Run disposable native Keychain across three processes','Run disposable native persistence probe',
    'Run R5 production worker native scenarios','Run strict native TLS and production Electrum RPC matrix','Run historical Realm109 migration matrix']
   indices=[names.index(x) for x in expected];self.assertEqual(indices,sorted(indices))
   native=next(s for s in steps if s.get('name')=='Run Android startup persistence worker TLS Realm trust and product flows')
   script=native['with']['script'];self.assertNotIn('hosted_native.py build',script)
   for x in ['smoke','probe','features','tls']:self.assertIn('hosted_native.py '+x,script)
   self.assertIn('r52_realm109_native.py',script);self.assertIn('product_measurements.py run',script)
 def test_ordinary_diagnostic_only_guard_stays_conditional(self):
  d=dict(self.workflows())[False]
  for job in d['jobs'].values():
   s=next(s for s in job['steps'] if s.get('name')=='Verify current diagnostic source')
   self.assertEqual(s['if'],'inputs.diagnostic')
   self.assertIn('Verify Android hosted source admission',[s.get('name') for s in job['steps']])
 def test_all_reusable_callers_grant_required_token_permissions(self):
  workers={'.github/workflows/keeper-native-platform.yml','.github/workflows/keeper-canonical-native-platform.yml'}
  callers=set();rank={'none':0,'read':1,'write':2}
  for path in (ROOT/'.github/workflows').glob('*.yml'):
   caller=yaml.safe_load(path.read_text())
   for name,job in caller.get('jobs',{}).items():
    worker=job.get('uses','').removeprefix('./')
    if worker not in workers:continue
    callers.add(path.name)
    requested=yaml.safe_load((ROOT/worker).read_text())['permissions']
    granted=job.get('permissions',caller.get('permissions',{}))
    self.assertIsInstance(granted,dict,(path.name,name))
    for scope,level in requested.items():
     self.assertGreaterEqual(rank.get(granted.get(scope,'none'),0),rank[level],(path.name,name,scope))
  self.assertEqual(callers,{'keeper-native-diagnostic.yml','keeper-release-acceptance.yml','keeper-canonical-native.yml'})

class Disk(unittest.TestCase):
 def test_admission_failure_happens_before_any_stock_probe_or_delete(self):
  with patch.object(m,'context',side_effect=ValueError('denied')),patch.object(m,'load') as load,patch.object(m.subprocess,'run') as run:
   with self.assertRaises(ValueError):m.prepare({})
   load.assert_not_called();run.assert_not_called()
 def policies(self,free,capacity=30*1024**3):
  tools=(('DOTNET',Path('/usr/share/dotnet')),('LINUX_SWIFT',Path('/usr/share/swift')),('GHCUP',Path('/usr/local/.ghcup')))
  extras=(('CODEQL',Path('/opt/hostedtoolcache/CodeQL')),('NDK29',Path('/usr/local/lib/android/sdk/ndk/29.0.14206865')))
  policy=SimpleNamespace(TARGET=m.TARGET,RESERVE=m.RESERVE,TOOLS=tools,REMOVE={n:['literal',str(p)] for n,p in tools},
   stock_identity=Mock(return_value=((1,2),(1,3))),free_bytes=Mock(return_value=free))
  extra=SimpleNamespace(TARGET=m.TARGET,RESERVE=m.RESERVE,EXTRA=extras,SDK=Path('/usr/local/lib/android/sdk'),NDK=extras[1][1],
   REMOVE={n:['literal',str(p)] for n,p in extras},runtime_paths_clear=Mock(),stock_identity=Mock(return_value=((1,2),(1,3))),
   allocated_bytes=Mock(side_effect=lambda paths:{p:capacity//len(paths) for p in paths}))
  return policy,extra
 def test_already_available_budget_keeps_all_five_tools(self):
  policy,extra=self.policies(m.TARGET)
  with patch.object(m,'context'),patch.object(m,'load',side_effect=[policy,extra]),patch.object(m.subprocess,'run') as run:
   result=m.prepare({});self.assertEqual(result['result'],'PASS');self.assertEqual(result['removed'],[]);run.assert_not_called()
 def test_insufficient_measured_combined_stock_never_deletes_or_relaxes_budget(self):
  policy,extra=self.policies(0,capacity=m.TARGET-1)
  with patch.object(m,'context'),patch.object(m,'load',side_effect=[policy,extra]),patch.object(m.subprocess,'run') as run:
   with self.assertRaises(ValueError):m.prepare({})
   run.assert_not_called();self.assertEqual(m.TARGET,24*1024**3);self.assertEqual(m.RESERVE,12*1024**3)
 def test_active_path_or_nested_mount_rejection_precedes_deletion(self):
  for failure in ('ACTIVE_TOOL','MOUNT'):
   policy,extra=self.policies(0)
   if failure=='ACTIVE_TOOL':extra.runtime_paths_clear.side_effect=ValueError(failure)
   else:extra.stock_identity.side_effect=ValueError(failure)
   with self.subTest(failure=failure),patch.object(m,'context'),patch.object(m,'load',side_effect=[policy,extra]),patch.object(m.subprocess,'run') as run:
    with self.assertRaises(ValueError):m.prepare({})
    run.assert_not_called()
 def test_selected_ndk_required_default_and_latest_never_selected_for_deletion(self):
  policy,extra=self.policies(m.TARGET)
  self.assertEqual([str(p) for _,p in extra.EXTRA],['/opt/hostedtoolcache/CodeQL','/usr/local/lib/android/sdk/ndk/29.0.14206865'])
  self.assertFalse(any('27.1' in str(p) or '/latest' in str(p) or '/default' in str(p) for _,p in (*policy.TOOLS,*extra.EXTRA)))

if __name__=='__main__':unittest.main()
