"""Strict fixed native receipt boundaries; no native execution in these tests."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest import mock

NATIVE = Path(__file__).resolve().parents[1] / 'native'
def module(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
evidence, harness = module('keychain_evidence'), module('hosted_native')

class KeychainEvidence(unittest.TestCase):
    def test_only_complete_fixed_final_stage_and_option_profile_can_pass(self):
        value = {'schema': 1, 'scope': evidence.SCOPE, 'option_profile': evidence.OPTION_PROFILE,
                 'stage': 'pass', 'operation': 'VERIFY_DELETED', 'failure_code': None,
                 'native_code': None, 'native_acceptance': False}
        self.assertEqual(evidence.project(json.dumps(value)), value)
        for update in ({'password': 'PRIVATE'}, {'option_profile': 'DEFAULT_SERVICE'},
                       {'operation': 'WRITE_INITIAL'}, {'native_acceptance': True},
                       {'failure_code': 'PRIVATE_NATIVE_ERROR'}):
            with self.assertRaises(ValueError): evidence.project(json.dumps({**value, **update}))
        with self.assertRaises(ValueError):
            evidence.project(json.dumps(value)[:-1] + ',"schema":1}')

    def test_fixed_missing_entitlement_retains_operation_without_native_payload(self):
        value = {'schema': 1, 'scope': evidence.SCOPE, 'option_profile': evidence.OPTION_PROFILE,
                 'stage': 'failed', 'operation': 'WRITE_INITIAL', 'failure_code': 'MISSING_ENTITLEMENT',
                 'native_code': -34018, 'native_acceptance': False}
        self.assertEqual(evidence.project(json.dumps(value)), value)
        for update in ({'native_code': -34018.0}, {'native_code': None}, {'native_code': -1},
                       {'failure_code': 'PRIVATE_ERROR'}, {'operation': 'PRIVATE_PATH'}):
            with self.assertRaises(ValueError): evidence.project(json.dumps({**value, **update}))

    def test_actual_harness_requires_successful_startup_before_keychain_process(self):
        with mock.patch.object(harness, 'PLATFORM', 'IOS'), \
                mock.patch.object(harness, 'read', return_value={'smoke': 'FAIL', 'build': 'PASS'}), \
                mock.patch.object(harness.subprocess, 'Popen') as child:
            with self.assertRaisesRegex(RuntimeError, 'startup smoke must pass'):
                harness.smoke('keychain')
            child.assert_not_called()

if __name__ == '__main__': unittest.main()
