import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('phase_context', Path(__file__).parents[1] / 'native/native_phase_context.py')
context = importlib.util.module_from_spec(spec); spec.loader.exec_module(context)


class CanonicalPhaseContext(unittest.TestCase):
    def fixture(self, repository):
        source = 'a' * 40
        env = dict(GITHUB_ACTIONS='true', RUNNER_ENVIRONMENT='github-hosted', GITHUB_REPOSITORY=repository,
            GITHUB_REPOSITORY_ID=context.PROFILES[repository], GITHUB_EVENT_NAME='workflow_dispatch',
            GITHUB_REF='refs/heads/sprint', KEEPER_DIAGNOSTIC='false', KEEPER_SOURCE_SHA=source,
            GITHUB_SHA=source, GITHUB_WORKFLOW_SHA=source, GITHUB_RUN_ID='12', GITHUB_RUN_ATTEMPT='2',
            GITHUB_WORKFLOW_REF=repository + '/.github/workflows/keeper-canonical-native.yml@refs/heads/sprint')
        data = dict(source_sha=source, workflow_sha=source, workflow_ref=env['GITHUB_WORKFLOW_REF'],
                    run_id='12', run_attempt='2', diagnostic_only=False)
        return env, data

    def test_finite_public_and_private_fresh_contexts(self):
        for repository in context.PROFILES:
            env, data = self.fixture(repository)
            with patch.dict('os.environ', env, clear=True): self.assertTrue(context.hosted_context(None, data))

    def test_wrong_repository_source_attempt_control_diagnostic_or_retained_cannot_admit(self):
        env, data = self.fixture('KeeperCommunity/bitcoin-keeper-private')
        for mutation in [dict(GITHUB_REPOSITORY_ID='470904030'), dict(GITHUB_SHA='f' * 40),
                         dict(GITHUB_WORKFLOW_SHA='f' * 40), dict(GITHUB_RUN_ATTEMPT='3'),
                         dict(GITHUB_REF='refs/heads/other'), dict(GITHUB_REPOSITORY='other/repo')]:
            with patch.dict('os.environ', {**env, **mutation}, clear=True): self.assertFalse(context.hosted_context(None, data))
        for mutation in [dict(diagnostic_only=True), dict(original_build={'build': 'PASS'}),
                         dict(compiled_app_source_sha='f' * 40), dict(build_execution_scope='REUSED_ORIGINAL_FF_APP')]:
            with patch.dict('os.environ', env, clear=True): self.assertFalse(context.hosted_context(None, {**data, **mutation}))

    def test_ordinary_reusable_route_has_explicit_finite_control_context(self):
        env, data = self.fixture('KeeperCommunity/bitcoin-keeper')
        env.update(GITHUB_EVENT_NAME='pull_request', GITHUB_REF='refs/pull/9000/merge', GITHUB_SHA='b' * 40,
            GITHUB_WORKFLOW_SHA='b' * 40, GITHUB_WORKFLOW_REF='KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-release-acceptance.yml@refs/pull/9000/merge')
        data.update(workflow_sha=env['GITHUB_WORKFLOW_SHA'], workflow_ref=env['GITHUB_WORKFLOW_REF'])
        with patch.dict('os.environ', env, clear=True): self.assertTrue(context.hosted_context(None, data))


if __name__ == '__main__':
    unittest.main()
