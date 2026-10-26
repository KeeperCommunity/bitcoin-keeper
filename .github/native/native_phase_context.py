"""Finite fresh-source phase context. Artifact/API authority stays in readers."""
import copy
import os
import re

PROFILES = {'KeeperCommunity/bitcoin-keeper': '470904030',
            'KeeperCommunity/bitcoin-keeper-private': '839671816'}


def hosted_context(h, data):
    env = os.environ
    if env.get('GITHUB_ACTIONS') != 'true' or env.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        return False
    repository = env.get('GITHUB_REPOSITORY')
    if repository == 'KeeperCommunity/bitcoin-keeper-private' and env.get('KEEPER_DIAGNOSTIC') != 'false':
        return True  # Diagnostic metadata never supplies canonical reader credit.
    if repository not in PROFILES:
        return False
    source = data.get('source_sha')
    fresh = (type(source) is str and re.fullmatch('[a-f0-9]{40}', source) and
        env.get('GITHUB_REPOSITORY_ID') == PROFILES[repository] and
        env.get('KEEPER_DIAGNOSTIC') == 'false' and data.get('diagnostic_only') is False and
        source == env.get('KEEPER_SOURCE_SHA') and data.get('workflow_sha') == env.get('GITHUB_WORKFLOW_SHA') and
        data.get('workflow_ref') == env.get('GITHUB_WORKFLOW_REF') and
        data.get('run_id') == env.get('GITHUB_RUN_ID') and data.get('run_attempt') == env.get('GITHUB_RUN_ATTEMPT') and
        not any(name in data for name in ['original_build', 'diagnostic_controller_sha', 'reused_original_build']) and
        ('compiled_app_source_sha' not in data or data['compiled_app_source_sha'] == source) and
        not any(word in data.get('build_execution_scope', '').upper() for word in ['RETAINED', 'REUSED']))
    canonical = (env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and env.get('GITHUB_REF') == 'refs/heads/sprint' and
        source == env.get('GITHUB_SHA') == env.get('GITHUB_WORKFLOW_SHA') and
        env.get('GITHUB_WORKFLOW_REF') == repository + '/.github/workflows/keeper-canonical-native.yml@refs/heads/sprint')
    merge = env.get('GITHUB_REF', '')
    reusable = (env.get('GITHUB_EVENT_NAME') == 'pull_request' and re.fullmatch(r'refs/pull/[1-9][0-9]*/merge', merge) and
        env.get('GITHUB_WORKFLOW_REF') == repository + '/.github/workflows/keeper-release-acceptance.yml@' + merge)
    return bool(fresh and (canonical or reusable))


def result_binding(h):
    data = h.read()
    return dict(scope='CURRENT_SOURCE_NATIVE_PHASE', source_sha=data.get('source_sha'),
        workflow_sha=data.get('workflow_sha'), workflow_ref=data.get('workflow_ref'),
        run_id=data.get('run_id'), run_attempt=data.get('run_attempt'), platform=h.PLATFORM,
        built_artifact=copy.deepcopy(data.get('built_artifact')),
        installed_artifact=copy.deepcopy(data.get('installed_artifact')))


def register_generated(h, kind, sha256):
    paths = {'tls': '.github/native/.generated/r52_tls_fixture.json',
             'trust': '.github/native/.generated/r52_trust_ui.json',
             'realm109': '.github/native/.generated/r52_realm109/config.json'}
    if kind not in paths or not re.fullmatch('[a-f0-9]{64}', sha256):
        raise RuntimeError('FIXED_NATIVE_GENERATED_INPUT_REQUIRED')
    data = h.read()
    data.setdefault('native_generated_inputs', {})[kind] = dict(source_sha=data['source_sha'], path=paths[kind], sha256=sha256)
    h.save(data)
