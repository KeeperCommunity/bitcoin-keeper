"""Source-only, non-destructive measurement; cannot grant runtime admission."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-private-android-capacity-measure.yml@refs/pull/73/merge'


def require(value):
    if not value:
        raise RuntimeError('CAPACITY_MEASUREMENT_CONTEXT_OR_SOURCE_REJECTED')


def pinned(name):
    path = ROOT / '.github/native' / (name + '.py')
    raw = path.read_bytes()
    require(not path.is_symlink() and raw == subprocess.check_output(
        ['git', 'show', 'HEAD:.github/native/' + name + '.py'], cwd=ROOT))
    spec = importlib.util.spec_from_file_location('capacity_measure_' + name, path)
    value = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    return value, hashlib.sha256(raw).hexdigest()


def measure(env):
    expected = {'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'pull_request',
        'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_WORKFLOW_REF': WORKFLOW,
        'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private',
        'GITHUB_REPOSITORY_ID': '839671816', 'RUNNER_ENVIRONMENT': 'github-hosted',
        'RUNNER_OS': 'Linux', 'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24',
        'ANDROID_HOME': '/usr/local/lib/android/sdk',
        'ANDROID_SDK_ROOT': '/usr/local/lib/android/sdk',
        'RUNNER_TOOL_CACHE': '/opt/hostedtoolcache',
        'KEEPER_NATIVE_PLATFORM': 'ANDROID', 'KEEPER_DIAGNOSTIC': 'true'}
    require(all(env.get(key) == value for key, value in expected.items()))
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip()
    require(source == env.get('KEEPER_CONTROLLER_SHA'))
    require(subprocess.run(['git', 'diff', '--exit-code', 'HEAD', '--', '.github/native',
        '.github/workflows'], cwd=ROOT, stdout=subprocess.DEVNULL).returncode == 0)
    event_path = Path(env['GITHUB_EVENT_PATH'])
    require(not event_path.is_symlink() and event_path.stat().st_size <= 1024 * 1024)
    event = json.loads(event_path.read_bytes())
    pr = event['pull_request']
    require(event['action'] == 'labeled' and event['label']['name'] == 'keeper/android-capacity-measurement' and
        event['repository']['id'] == 839671816 and event['repository']['private'] is True and
        pr['number'] == 73 and pr['head']['repo']['id'] == 839671816 and pr['head']['sha'] == source and
        'keeper/native-diagnostic' not in {row['name'] for row in pr['labels']})
    stock, helper_sha = pinned('android_runtime_stock_codeql')
    policy, policy_sha = pinned('android_runner_disk')
    require(policy_sha == stock.ORIGINAL_SHA and policy.TARGET == stock.TARGET and policy.RESERVE == stock.RESERVE)
    policy.context(env)
    stock.runtime_paths_clear(ROOT, env)
    # This shared function only validates and runs one bounded du command.
    # Deliberately never call stock.prepare or any removal command.
    inventory, extra, original = stock.capacity_inventory(policy, policy.free_bytes())
    require(all(stock.stock_identity(policy, path) == value for path, value in extra.items()))
    require(all(policy.stock_identity(path) == value for path, value in original.items()))
    stock.runtime_paths_clear(ROOT, env)
    return {'schema': 1, 'scope': 'SOURCE_ONLY_STOCK_CAPACITY_MEASUREMENT_NO_REMOVAL_OR_NATIVE_EXECUTION',
        'source_sha': source, 'run_id': env['GITHUB_RUN_ID'], 'run_attempt': env['GITHUB_RUN_ATTEMPT'],
        'workflow_sha': env['GITHUB_SHA'], 'image_version': env.get('ImageVersion'),
        'native_acceptance': False, 'removed': [], 'artifact_download': 'NOT RUN',
        'dependencies': 'NOT RUN', 'emulator': 'NOT RUN', 'app_runtime': 'NOT RUN',
        'target_bytes': policy.TARGET, 'reserve_bytes': policy.RESERVE,
        'helper_sha256': helper_sha, 'original_policy_sha256': policy_sha, **inventory,
        'capacity_arithmetic_closes': inventory['measured_extra_reclaim_bytes'] >= inventory['required_extra_reclaim_bytes'],
        'later_runtime_must_remeasure': True}


if __name__ == '__main__':
    require(len(sys.argv) == 1)
    result = measure(os.environ)
    destination = ROOT / 'artifacts/private-android-capacity/measurement.json'
    destination.parent.mkdir(parents=True, exist_ok=False)
    destination.write_text(json.dumps(result, indent=2) + '\n')
    print('KEEPER_STOCK_CAPACITY_MEASUREMENT ' + json.dumps(result, sort_keys=True), flush=True)
