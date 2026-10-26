"""Private PR73 APK checkpoint completion; all runtime checks stay NOT RUN."""
import json
import os
from pathlib import Path
import re
import subprocess

LABEL = 'keeper/android-compile-checkpoint-only'
REPOSITORY = 'KeeperCommunity/bitcoin-keeper-private'
GATES = ('smoke', 'native_keychain', 'native_probe', 'r5_features', 'hardware', 'signing')


def require(value):
    if not value:
        raise RuntimeError('Private compile-checkpoint-only selection rejected.')


def finish(native, env):
    require(all(env.get(key) == value for key, value in {
        'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY_ID': '839671816',
        'RUNNER_ENVIRONMENT': 'github-hosted',
        'GITHUB_REPOSITORY': REPOSITORY, 'GITHUB_EVENT_NAME': 'pull_request',
        'GITHUB_RUN_ATTEMPT': '1', 'KEEPER_DIAGNOSTIC': 'true',
        'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_ANDROID_CHECKPOINT_ONLY': 'true',
    }.items()))
    event = json.loads(Path(env['GITHUB_EVENT_PATH']).read_text())
    pr = event['pull_request']
    labels = {row['name'] for row in pr['labels']}
    require(event['repository']['id'] == 839671816 and event['repository']['private'] is True and
        pr['number'] == 73 and pr['head']['repo']['id'] == 839671816 and
        pr['head']['sha'] == env['KEEPER_SOURCE_SHA'] and
        {LABEL, 'keeper/native-diagnostic', 'keeper/android-diagnostic-only'} <= labels and
        not labels & {'keeper/ios-diagnostic-only', 'keeper/ios-dependencies-only'})
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=native.ROOT, text=True).strip()
    require(source == env['KEEPER_SOURCE_SHA'] and re.fullmatch('[0-9a-f]{40}', source))
    artifact = env.get('KEEPER_CHECKPOINT_ARTIFACT_ID', '')
    digest = env.get('KEEPER_CHECKPOINT_ARTIFACT_DIGEST', '')
    require(re.fullmatch('[1-9][0-9]{0,15}', artifact) and int(artifact) < 2 ** 53 and
        re.fullmatch('[0-9a-f]{64}', digest))
    value = native.read()
    require(value['source_sha'] == source and value['run_id'] == env['GITHUB_RUN_ID'] and
        value['run_attempt'] == '1' and value['platform'] == 'ANDROID' and
        value['diagnostic_only'] is True and value['build'] == 'PASS' and
        all(value.get(key) == 'NOT RUN' for key in GATES) and
        value['built_artifact'] == native.artifact_identity())
    value['compile_checkpoint_only'] = {'scope': 'PRIVATE_DEBUG_APK_RETAINED_NO_RUNTIME_OR_RELEASE_ACCEPTANCE',
        'status': 'APK_RETAINED_RUNTIME_NOT_RUN', 'native_acceptance': False,
        'artifact_id': int(artifact), 'archive_sha256': digest}
    value['native_acceptance'] = False
    native.save(value)
    print('KEEPER_ANDROID_COMPILE_CHECKPOINT_ONLY ' + json.dumps(value['compile_checkpoint_only'], sort_keys=True), flush=True)


if __name__ == '__main__':
    import hosted_native
    finish(hosted_native, os.environ)
