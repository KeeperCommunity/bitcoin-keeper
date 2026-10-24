"""Fabricated pinned-Maestro format controls; no native execution or raw export."""
import copy
import contextlib
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import types
import unittest
from unittest import mock

NATIVE = Path(__file__).parents[1] / 'native'


def load(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


projection = load('maestro_failure_snapshot')
diagnosis = load('product_failure_diagnosis')
product = load('product_measurements')
FAILURE = {'state': 'ERROR_RECORDED', 'failed_selector': 'start_new_tile', 'failure_kind': 'ASSERT_VISIBLE'}


def assertion(sequence=2, path=None):
    return {'command': {'assertConditionCommand': {'condition': {'visible': {
        'idRegex': 'view_startNewTile', 'optional': False}}, 'timeout': '30000', 'optional': False}},
        'metadata': {'status': 'FAILED', 'sequenceNumber': sequence, 'depth': 1,
            'timestamp': 1792710000000, 'duration': 30000,
            'error': {'message': 'PRIVATE_SENTINEL', 'debugMessage': 'PRIVATE_SENTINEL'},
            'artifacts': [{'type': 'SCREEN_HIERARCHY', 'path': path or
                'screen-hierarchy/step-%03d-assertCondition-view_startNewTile.json' % (sequence + 1)}]}}


def skip(**changes):
    node = {'attributes': {'resource-id': 'btn_skip', 'bounds': '[4,8][104,58]',
                          'text': 'PRIVATE_SENTINEL', 'clickable': 'true', 'enabled': 'true'},
            'clickable': True, 'enabled': True, 'focused': False, 'selected': False}
    node.update(changes)
    return node


class FailedSnapshot(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # TestRunner creates a folder from the flow's public configured name.
        self.bundle = self.root / 'Full app startup first wallet and cold persistence'
        self.bundle.mkdir()
        self.commands = self.bundle / 'commands.json'

    def write(self, rows=None, tree=None):
        rows = [assertion()] if rows is None else rows
        self.commands.write_text(json.dumps(rows))
        path = self.bundle / 'screen-hierarchy/step-003-assertCondition-view_startNewTile.json'
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({'children': [skip()]} if tree is None else tree))
        return path

    def collect(self, flow='product_first_wallet.yaml', failure=None):
        value = projection.collect(self.root, flow, FAILURE if failure is None else failure)
        rendered = json.dumps(value)
        for private in ('PRIVATE_SENTINEL', str(self.root), 'screen-hierarchy', 'resource-id'):
            self.assertNotIn(private, rendered)
        return value

    def test_unique_failed_outcome_projects_fixed_count_bounds_flags_not_visibility_or_tap(self):
        self.write()
        result = self.collect()
        self.assertEqual(result['binding_state'], 'BOUND')
        self.assertEqual(result['scope'], 'POST_FAILED_ASSERT_OUTCOME_NOT_TAP_TIME')
        self.assertEqual(result['failed_assertion'], {'kind': 'ASSERT_VISIBLE',
            'selector': 'start_new_tile', 'sequence_number': 2})
        self.assertEqual(result['skip'], {'state': 'UNIQUE_VALID_BOUNDS',
            'exact_resource_id_count': 1, 'bounds': {'left': 4, 'top': 8, 'right': 104, 'bottom': 58},
            'clickable': True, 'enabled': True, 'focused': False, 'selected': False,
            'conflicts': dict.fromkeys(projection.FLAGS, False)})
        self.assertEqual(result['tap_coordinates'], 'NOT_RECORDED')
        self.assertEqual(result['visible_to_user'], 'NOT_RECORDED')

    def test_only_artifact_bound_to_exact_failed_assertion_is_used_not_other_snapshot(self):
        self.write(tree={})
        (self.bundle / 'screen-hierarchy/step-001.json').write_text(json.dumps(skip()))
        self.assertEqual(self.collect()['skip']['exact_resource_id_count'], 0)
        self.write(tree={'attributes': {'resource-id': 'foreign:id/btn_skip'}})
        self.assertEqual(self.collect()['skip']['exact_resource_id_count'], 0)
        node = skip(); node['attributes']['resource-id'] = 'io.hexawallet.keeper.development:id/btn_skip'
        self.write(tree=node)
        self.assertEqual(self.collect()['skip']['exact_resource_id_count'], 1)

    def test_no_snapshot_is_inferred_for_completed_skip_or_unrelated_junit_failure(self):
        row = {'command': {'tapOnElement': {'selector': {'idRegex': 'btn_skip'}}},
               'metadata': {'status': 'COMPLETED', 'sequenceNumber': 1}}
        self.write(rows=[row])
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        self.write()
        for changes in ({'state': 'UNKNOWN'}, {'failed_selector': 'onboarding_skip'},
                        {'failure_kind': 'ELEMENT_NOT_FOUND'}):
            self.assertEqual(self.collect(failure={**FAILURE, **changes})['binding_state'], 'UNKNOWN')
        self.assertEqual(self.collect(flow='private.yaml')['binding_state'], 'UNKNOWN')

    def test_failed_command_and_evaluated_selector_must_be_unique_exact_and_nonoptional(self):
        for mutation in ('completed', 'warned', 'other_id', 'text', 'index', 'optional',
                         'label', 'timeout', 'condition', 'other_command', 'evaluated', 'duplicate'):
            row = assertion()
            command = row['command']['assertConditionCommand']
            visible = command['condition']['visible']
            rows = [row]
            if mutation in ('completed', 'warned'): row['metadata']['status'] = mutation.upper()
            elif mutation == 'other_id': visible['idRegex'] = 'btn_skip'
            elif mutation == 'text': visible['textRegex'] = 'PRIVATE_SENTINEL'
            elif mutation == 'index': visible['index'] = '0'
            elif mutation == 'optional': command['optional'] = True
            elif mutation == 'label': command['label'] = 'PRIVATE_SENTINEL'
            elif mutation == 'timeout': command['timeout'] = []
            elif mutation == 'condition': command['condition']['notVisible'] = {'idRegex': 'btn_skip'}
            elif mutation == 'other_command': row['command']['tapOnElement'] = {}
            elif mutation == 'evaluated': row['metadata']['evaluatedCommand'] = {'tapOnElement': {}}
            else: rows.append(assertion(3))
            self.write(rows=rows)
            with self.subTest(mutation=mutation): self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')

    def test_sequence_metadata_shape_order_and_duplicates_fail_closed(self):
        for sequence in (None, True, -1, 1.0, '2', projection.STEP_LIMIT):
            row = assertion(); row['metadata']['sequenceNumber'] = sequence
            self.write(rows=[row])
            self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        for mutation in ('duplicate_sequence', 'wrong_status', 'duration', 'depth', 'error', 'wrapper'):
            row = assertion(); rows = [row]
            if mutation == 'duplicate_sequence': rows.insert(0, copy.deepcopy(row))
            elif mutation == 'wrong_status': row['metadata']['status'] = 'ERROR'
            elif mutation == 'duration': row['metadata']['duration'] = False
            elif mutation == 'depth': row['metadata']['depth'] = -1
            elif mutation == 'error': row['metadata']['error'] = 'PRIVATE_SENTINEL'
            else: row['extra'] = 'PRIVATE_SENTINEL'
            self.write(rows=rows)
            self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')

    def test_path_type_sequence_and_duplicate_artifact_ownership_are_required(self):
        for path in ('../outside.json', '/tmp/private.json', 'screen-hierarchy/../step-003.json',
                     'screen-hierarchy\\step-003.json', 'screen-hierarchy/step-004.json',
                     'https://private.example/step-003.json', 'screen-hierarchy/step-003.json\n'):
            self.write(rows=[assertion(path=path)])
            self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        for change in ('missing', 'wrong_type', 'duplicate', 'other_owner'):
            row = assertion(); rows = [row]
            artifact = row['metadata']['artifacts'][0]
            if change == 'missing': row['metadata'].pop('artifacts')
            elif change == 'wrong_type': artifact['type'] = 'SCREENSHOT'
            elif change == 'duplicate': row['metadata']['artifacts'].append(copy.deepcopy(artifact))
            else: rows.insert(0, {'command': {}, 'metadata': {'status': 'FAILED',
                'sequenceNumber': 1, 'artifacts': [copy.deepcopy(artifact)]}})
            self.write(rows=rows)
            self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')

    def test_commands_file_candidates_and_symlink_root_file_parent_or_fifo_are_unknown(self):
        snapshot = self.write()
        other = self.root / 'commands.json'; other.write_text(self.commands.read_text())
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN'); other.unlink()
        for path in (self.commands, snapshot):
            saved = path.read_bytes(); path.unlink()
            outside = self.root / 'outside.json'; outside.write_bytes(saved)
            path.symlink_to(outside)
            self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
            path.unlink(); path.write_bytes(saved)
        alias = self.root / 'alias'; alias.symlink_to(self.bundle, target_is_directory=True)
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN'); alias.unlink()
        root_alias = self.root.parent / (self.root.name + '-alias')
        root_alias.symlink_to(self.root, target_is_directory=True)
        try: self.assertEqual(projection.collect(root_alias, 'product_first_wallet.yaml', FAILURE)['binding_state'], 'UNKNOWN')
        finally: root_alias.unlink()
        snapshot.unlink(); projection.os.mkfifo(snapshot)
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')

    def test_bundle_must_match_the_source_defined_flow_name_without_other_flow_or_shard_adoption(self):
        for flow, name in projection.FLOWS.items():
            content = (NATIVE / flow).read_text()
            self.assertEqual(re.search(r'^name: (.+)$', content, re.MULTILINE)[1], name)
        self.write()
        other = self.root / 'Other flow'
        self.bundle.rename(other)
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        retry = self.root / projection.FLOWS['product_retry.yaml']
        other.rename(retry)
        self.assertEqual(self.collect(flow='product_retry.yaml')['binding_state'], 'BOUND')
        retry.rename(self.root / (retry.name + '-shard-1'))
        self.assertEqual(self.collect(flow='product_retry.yaml')['binding_state'], 'UNKNOWN')

    def test_malformed_duplicate_json_and_wrong_node_shapes_never_export_partial_nodes(self):
        snapshot = self.write()
        for raw in (b'{"attributes":{},"attributes":{}}', b'\xffPRIVATE_SENTINEL', b'NaN',
                    json.dumps(skip()).encode('utf-16')):
            snapshot.write_bytes(raw)
            self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        for tree in ({'children': [skip(), 42]}, {'attributes': []}, {'children': None},
                     {'clickable': 1}, {'attributes': {'bounds': 42}}, {'unexpected': 'PRIVATE_SENTINEL'}):
            self.write(tree=tree)
            self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        self.write(); self.commands.write_text('[{"command":{},"command":{},"metadata":{}}]')
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        self.write(); self.commands.write_text(self.commands.read_text().replace('30000,', '1e999,'))
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')

    def test_file_scan_step_and_node_bounds_fail_closed(self):
        snapshot = self.write()
        snapshot.write_bytes(b' ' * (projection.FILE_LIMIT + 1))
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        self.write(); self.commands.write_bytes(b' ' * (projection.FILE_LIMIT + 1))
        self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')
        self.write()
        for constant, value in (('ENTRY_LIMIT', 1), ('STEP_LIMIT', 2), ('NODE_LIMIT', 1)):
            with mock.patch.object(projection, constant, value):
                self.assertEqual(self.collect()['binding_state'], 'UNKNOWN')

    def test_multiple_or_invalid_bounds_never_select_one_skip_or_project_its_flags(self):
        self.write(tree={'children': [skip(), skip()]})
        result = self.collect()['skip']
        self.assertEqual((result['state'], result['exact_resource_id_count']), ('UNKNOWN', 2))
        self.assertIsNone(result['bounds']); self.assertIsNone(result['clickable'])
        for bounds in ('[4,8][4,58]', '[104,8][4,58]', '[4,8][104,8]', '[0,0][100001,1]',
                       '[01,0][2,2]', '[0,0][2,2]\n', 'PRIVATE_SENTINEL'):
            node = skip(); node['attributes']['bounds'] = bounds
            self.write(tree=node)
            result = self.collect()['skip']
            self.assertEqual(result['state'], 'UNKNOWN')
            self.assertIsNone(result['bounds']); self.assertIsNone(result['enabled'])

    def test_boolean_sources_are_nullable_and_disagreements_are_fixed_conflict_facts(self):
        node = skip(clickable=False); node.pop('focused'); node.pop('selected')
        self.write(tree=node)
        result = self.collect()['skip']
        self.assertIsNone(result['clickable']); self.assertIs(result['conflicts']['clickable'], True)
        self.assertIs(result['enabled'], True); self.assertIsNone(result['focused'])
        node['attributes']['enabled'] = 'PRIVATE_SENTINEL'
        self.write(tree=node)
        self.assertEqual(self.collect()['skip']['state'], 'UNKNOWN')

    def test_integration_reads_junit_once_and_optional_projection_failure_preserves_other_facts(self):
        self.write()
        fixed = {'state': 'COMPLETE'}
        with mock.patch.object(diagnosis, 'junit', return_value=FAILURE) as junit, \
                mock.patch.object(diagnosis, 'hierarchy', return_value=fixed), \
                mock.patch.object(diagnosis, 'metro_window', return_value=fixed):
            result = diagnosis.collect(self.root, 'product_first_wallet.yaml', None)
        junit.assert_called_once()
        self.assertEqual(set(result), {'scope', 'junit', 'hierarchy', 'product_metro'})
        original = copy.deepcopy(result)
        snapshot = product.sample_failed_assertion_snapshot(
            self.root, 'product_first_wallet.yaml', result, (diagnosis, None))
        self.assertEqual(snapshot['binding_state'], 'BOUND')
        self.assertEqual(result, original)
        with mock.patch.object(diagnosis.importlib.util, 'spec_from_file_location', side_effect=ValueError('PRIVATE_SENTINEL')):
            result = diagnosis.failed_assertion_snapshot(self.root, 'product_first_wallet.yaml', FAILURE)
        self.assertEqual(result['binding_state'], 'UNKNOWN')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_secondary_receipt_failure_preserves_old_observation_original_error_and_purge(self):
        root, order = self.root, []
        private = root / 'private'; private.mkdir()
        (root / 'release').mkdir()
        manifest = b'{"name":"owned"}'
        (root / 'package.json').write_bytes(manifest)
        (root / 'release/version.json').write_text(json.dumps(
            {'version': '2.6.4', 'androidVersionCode': 627, 'iosBuildNumber': 620}))
        (root / '.env.ci').write_text('\n'.join([
            'ENVIRONMENT=DEVELOPMENT', 'RELAY=http://127.0.0.1:8765/',
            'SIGNING_SERVER_TESTNET=https://127.0.0.1:9/', 'SIGNING_SERVER_MAINNET=https://127.0.0.1:9/',
            'CHANNEL_URL=https://127.0.0.1:9/', 'SENTRY_DNS=https://public@127.0.0.1:9/1',
            'ENC_KEY_STORAGE_IDENTIFIER=KEEPER-HOSTED-DISPOSABLE']))
        sha, artifact = 'a' * 40, {'sha256': 'b' * 64}
        digest = hashlib.sha256(manifest).hexdigest()
        state = {'build': 'PASS', 'source_sha': sha, 'built_artifact': artifact,
            'commands': [], 'maestro': {'binary': 'fake-maestro'}, 'nodeify_overlay': {
                'path': 'package.json', 'allowed_fields': ['browser', 'react-native', 'browserify'],
                'before_sha256': digest, 'after_sha256': digest}}
        original_error = RuntimeError('PRIVATE_SENTINEL original')
        old = {'scope': 'fixed', 'junit': dict(FAILURE), 'hierarchy': {'state': 'UNKNOWN'},
               'product_metro': {'state': 'UNKNOWN'}}

        def command(args, *_args, **_kwargs):
            state['commands'].append({})
            if args == ['adb', 'get-serialno']:
                return 'emulator-5554'
            if args[0] == 'fake-maestro':
                output = Path(args[args.index('--debug-output') + 1])
                (output / 'junit.xml').write_text('PRIVATE_SENTINEL')
                raise original_error
            return 'image'

        def collect(output, *_args):
            self.assertTrue((output / 'junit.xml').exists())
            order.append('old')
            return copy.deepcopy(old)

        def secondary(output, flow, parsed_junit):
            self.assertTrue((output / 'junit.xml').exists())
            self.assertEqual(flow, 'product_first_wallet.yaml')
            self.assertEqual(parsed_junit, old['junit'])
            order.append('secondary')
            raise ValueError('PRIVATE_SENTINEL secondary')

        observer = types.SimpleNamespace(bind_metro=lambda _: None, collect=collect,
                                         failed_assertion_snapshot=secondary)
        manager = types.SimpleNamespace(start=lambda *_a, **_k: None,
            close=lambda: order.append('close'), events=[])
        server = types.SimpleNamespace(serve_forever=lambda: None, shutdown=lambda: None, server_close=lambda: None)

        def installed(_device):
            proof = {'method': 'SINGLE_INSTALLED_BASE_APK_SHA256', 'sha256': 'c' * 64}
            state.update(installed_artifact_verified=True, installed_artifact=proof)
            return proof

        h = types.SimpleNamespace(ROOT=root, PRIVATE=private, PLATFORM='ANDROID', APP_IDS={'ANDROID': 'owned.app'},
            read=lambda: copy.deepcopy(state), save=lambda value: state.update(copy.deepcopy(value)),
            artifact_identity=lambda: artifact, command=command, verify_installed_artifact=installed)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(product.os.environ, {'GITHUB_ACTIONS': 'true',
                'RUNNER_ENVIRONMENT': 'github-hosted', 'KEEPER_SOURCE_SHA': sha}))
            stack.enter_context(mock.patch.object(product.subprocess, 'check_output', side_effect=[sha, manifest]))
            stack.enter_context(mock.patch.object(product.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)))
            stack.enter_context(mock.patch.object(product, 'native_module', side_effect=lambda name:
                observer if name == 'product_failure_diagnosis' else types.SimpleNamespace(OwnedMetro=lambda *_: manager)))
            stack.enter_context(mock.patch.object(product, 'make_server', return_value=server))
            stack.enter_context(mock.patch.object(product, 'android_failure_observation', return_value={'status': 'UNAVAILABLE'}))
            with self.assertRaises(RuntimeError) as failure:
                product.run(h)
        self.assertIs(failure.exception, original_error)
        outcome = state['product_ui']['samples'][0]
        self.assertEqual(outcome['failure_observation'], old)
        self.assertEqual(set(outcome['failure_observation']), {'scope', 'junit', 'hierarchy', 'product_metro'})
        self.assertEqual(outcome['failed_assertion_snapshot']['binding_state'], 'UNKNOWN')
        self.assertEqual(order, ['old', 'secondary', 'close'])
        self.assertEqual(list(private.iterdir()), [])
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(state['product_ui']))


if __name__ == '__main__':
    unittest.main()
