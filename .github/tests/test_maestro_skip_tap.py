"""Source-derived pinned Maestro producer fixtures; no device or raw export.

The literal logger templates below were read from c8c361be1cc89b2e742f185466a302a22778be6b:
Maestro.kt gitblob1f850dce7dda23de26c7ea2a4108f29ce8a00462;
ScopedLogCapture.kt gitblob911e7584868a34bf65c5cdd8f1b9d66a6d19c66a;
UiElement.kt gitblob36b148d62b10777270f822836f248390ca71bf74;
Bounds.kt gitblob52df318be6acd31faeae872fbdfa1e0c1e336ccc.
The three compiled method names were additionally captured from released
cli-2.11.0 classes (archive SHA-256
5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a)
using its actual ScopedLogCapture, Maestro and Orchestra with a synthetic Driver.
That offline execution covers hierarchy/screenshot taps and nested runFlow/repeat;
it does not verify native driver transport or app press delivery.
"""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('skip_tap_fixture',
    Path(__file__).resolve().parents[1] / 'native/maestro_skip_tap.py')
reader = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reader)
FAILURE = {'state': 'ERROR_RECORDED', 'failure_kind': 'ASSERT_VISIBLE', 'failed_selector': 'start_new_tile'}
LOG_PATTERN = '%d{HH:mm:ss.SSS} [%5level] %logger.%method: %msg%n'
SELECTED_SOURCE = 'LOGGER.info("Tapping on element: ${tapRepeat ?: ""} $element")'
POINT_SOURCE = 'LOGGER.info("Tapping at ($x, $y) using hierarchy based logic for wait")'
SCREENSHOT_SOURCE = 'LOGGER.info("Try tapping at ($x, $y) using hierarchy based logic for wait")'
COMPILED_METHODS = {'tap': 'tap-HgV9Ck0', 'hierarchyBasedTap': 'hierarchyBasedTap-ogj28Uc',
                    'screenshotBasedTap': 'screenshotBasedTap-ogj28Uc'}


def message(source, **values):
    template = source[len('LOGGER.info("'):-len('")')]
    template = template.replace('${tapRepeat ?: ""}', '')
    for key, value in values.items():
        template = template.replace('$' + key, str(value))
    return template


def log(method, text, when='12:00:00.123'):
    return (LOG_PATTERN.replace('%d{HH:mm:ss.SSS}', when).replace('%5level', ' INFO')
            .replace('%logger', 'maestro.Maestro').replace('%method', COMPILED_METHODS[method])
            .replace('%msg', text).replace('%n', '\n'))


def element(label='Skip\u00a0\u00a0', resource='btn_skip', bounds=(0, 78, 1038, 56)):
    x, y, width, height = bounds
    # Pinned Kotlin data-class toString field order/format. No full UI is kept.
    return ('UiElement(treeNode=TreeNode(attributes={text=' + label + ', resource-id=' + resource +
        '}, children=[], clickable=true, enabled=true, focused=false, checked=null, selected=false), '
        'bounds=Bounds(x=%d, y=%d, width=%d, height=%d))' % (x, y, width, height))


def tap(sequence, skip=False):
    selector = {'textRegex': reader.SKIP_REGEX, 'childOf': {'idRegex': 'btn_skip', 'optional': False},
                'optional': False} if skip else {'idRegex': 'key_1', 'optional': False}
    command = {'tapOnElement': {'selector': selector, 'optional': False}}
    return {'command': command, 'metadata': {'status': 'COMPLETED', 'sequenceNumber': sequence,
        'timestamp': 1792710000000 + sequence * 1000, 'duration': 500, 'depth': 1,
        'evaluatedCommand': copy.deepcopy(command), 'artifacts': []}}


def failed(sequence=2):
    return {'command': {'assertConditionCommand': {'condition': {'visible': {
        'idRegex': 'view_startNewTile', 'optional': False}}, 'timeout': '30000', 'optional': False}},
        'metadata': {'status': 'FAILED', 'sequenceNumber': sequence, 'timestamp': 1792710005000,
            'duration': 30000, 'depth': 1, 'artifacts': [{'type': 'SCREEN_HIERARCHY',
                'path': 'screen-hierarchy/step-%03d-assertCondition-view_startNewTile.json' % (sequence + 1)}]}}


def produced_log(bounds=(0, 78, 1038, 56), resource='btn_skip', driver='hierarchyBasedTap', point=None):
    # An unrelated preceding PIN key/point must never enter the output.
    before = log('tap', message(SELECTED_SOURCE, element=element('1', 'key_1', (3, 4, 20, 30))))
    before += log('hierarchyBasedTap', message(POINT_SOURCE, x=13, y=19))
    chosen = log('tap', message(SELECTED_SOURCE, element=element(resource=resource, bounds=bounds)))
    x, y, width, height = bounds
    px, py = point or (x + width // 2, y + height // 2)
    chosen += log(driver, message(POINT_SOURCE if driver == 'hierarchyBasedTap' else SCREENSHOT_SOURCE,
                                 x=px, y=py))
    return before + chosen


class SkipTapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / 'Full app startup first wallet and cold persistence'
        (self.bundle / 'logs').mkdir(parents=True)
        self.commands = self.bundle / 'commands.json'
        self.log = self.bundle / 'logs/maestro.log'
        self.write()

    def write(self, rows=None, text=None):
        self.commands.write_text(json.dumps(rows if rows is not None else [tap(0), tap(1, True), failed()]))
        self.log.write_text(text if text is not None else produced_log())

    def collect(self, flow='product_first_wallet.yaml', failure=None):
        result = reader.collect(self.root, flow, FAILURE if failure is None else failure)
        payload = json.dumps(result)
        for token in ('PRIVATE_SENTINEL', str(self.root), 'key_1', 'maestro.log', 'textRegex'):
            self.assertNotIn(token, payload)
        self.assertEqual(result['app_delivery'], 'UNKNOWN')
        self.assertEqual(result['binding'], 'LOG_SEMANTIC_ORDER_NOT_EPOCH_CORRELATED')
        return result

    def test_pinned_templates_project_only_unique_skip_intent_not_preceding_key_coordinates(self):
        result = self.collect()
        self.assertEqual(result['state'], 'OBSERVED')
        self.assertEqual(result['command_sequence'], 1)
        self.assertEqual(result['target_identity'], 'SKIP_BUTTON_AND_LABEL')
        self.assertEqual(result['selected_bounds'], {'left': 0, 'top': 78, 'right': 1038, 'bottom': 134})
        self.assertEqual(result['driver_point'], {'x': 519, 'y': 106})
        self.assertEqual(result['point_relation'], 'INSIDE_INITIAL_SELECTED_BOUNDS')
        self.assertNotIn('timestamp', result)

    def test_label_geometry_and_screenshot_driver_path_are_source_bound(self):
        self.write(text=produced_log(bounds=(920, 78, 118, 56), resource='', driver='screenshotBasedTap'))
        result = self.collect()
        self.assertEqual(result['target_identity'], 'SKIP_LABEL')
        self.assertEqual(result['driver_point'], {'x': 979, 'y': 106})
        self.assertEqual(result['driver_path'], 'SCREENSHOT_BASED')

    def test_exact_released_compiled_names_bind_without_accepting_other_manglings(self):
        good = produced_log()
        self.assertEqual(self.collect()['state'], 'OBSERVED')
        for name in COMPILED_METHODS.values():
            source = good if name != COMPILED_METHODS['screenshotBasedTap'] else produced_log(driver='screenshotBasedTap')
            self.write(text=source.replace(name, name + 'Unknown'))
            self.assertEqual(self.collect()['state'], 'UNKNOWN')
        # Existing source-name fixtures remain bounded to the same operations.
        for source_name, compiled_name in COMPILED_METHODS.items():
            good = good.replace(compiled_name, source_name)
        self.write(text=good)
        self.assertEqual(self.collect()['state'], 'OBSERVED')

    def test_captured_released_jvm_records_project_only_the_synthetic_skip(self):
        captured = json.loads((Path(__file__).parent / 'fixtures' /
                               'maestro-2.11.0-compiled-taps.json').read_text())
        self.assertEqual(captured['archive_sha256'],
                         '5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a')
        for kind, expected_path in [('hierarchy', 'HIERARCHY_BASED'),
                                    ('screenshot', 'SCREENSHOT_BASED')]:
            self.write(text=''.join(captured[kind]))
            result = self.collect()
            self.assertEqual(result['state'], 'OBSERVED')
            self.assertEqual(result['driver_point'], {'x': 979, 'y': 106})
            self.assertEqual(result['selected_bounds'],
                             {'left': 920, 'top': 78, 'right': 1038, 'bottom': 134})
            self.assertEqual(result['driver_path'], expected_path)

    def test_refreshed_driver_point_outside_initial_bounds_is_an_observation_not_a_bad_tap_claim(self):
        self.write(text=produced_log(point=(1, 200)))
        self.assertEqual(self.collect()['point_relation'], 'OUTSIDE_INITIAL_SELECTED_BOUNDS')

    def test_raw_unselected_payload_is_not_exported(self):
        self.write(text='PRIVATE_SENTINEL token/path/account\n' + produced_log() + 'PRIVATE_SENTINEL\n')
        self.assertEqual(self.collect()['state'], 'OBSERVED')

    def test_wrong_failure_flow_or_missing_log_stays_unknown(self):
        for failure in [{}, {**FAILURE, 'state': 'PASS'}, {**FAILURE, 'failed_selector': 'PRIVATE_SENTINEL'}]:
            self.assertEqual(self.collect(failure=failure)['state'], 'UNKNOWN')
        self.assertEqual(self.collect(flow='PRIVATE_SENTINEL')['state'], 'UNKNOWN')
        self.log.unlink()
        self.assertEqual(self.collect()['state'], 'UNKNOWN')

    def test_selector_status_evaluated_source_duplicates_and_count_mismatch_cannot_bind(self):
        variants = []
        rows = [tap(0), tap(1, True), failed()]
        for edit in [lambda x: x[1]['metadata'].update(status='SKIPPED'),
                     lambda x: x[1]['metadata'].pop('evaluatedCommand'),
                     lambda x: x[1]['metadata'].update(evaluatedCommand=None),
                     lambda x: x[1]['metadata']['evaluatedCommand']['tapOnElement']['selector'].update(textRegex='PRIVATE_SENTINEL'),
                     lambda x: x[1]['command']['tapOnElement'].update(relativePoint='90%,50%'),
                     lambda x: x[1]['command']['tapOnElement'].update(waitUntilVisible=0),
                     lambda x: x[1]['command']['tapOnElement'].update(repeat={'repeat': 2}),
                     lambda x: x[1]['command']['tapOnElement']['selector'].update(index='1')]:
            variant = copy.deepcopy(rows); edit(variant); variants.append(variant)
        variants.append([tap(0, True), tap(1, True), failed()])
        variants.append([tap(1, True), failed()])
        variants.append([tap(0), tap(1, True), {'command': {'tapOnPointV2Command': {'point': '519,106'}},
            'metadata': {'status': 'COMPLETED', 'sequenceNumber': 2, 'depth': 1}}, failed(3)])
        for variant in variants:
            self.write(rows=variant)
            self.assertEqual(self.collect()['state'], 'UNKNOWN')

    def test_missing_duplicate_reordered_or_foreign_log_points_do_not_borrow_other_taps(self):
        good = produced_log()
        point = log('hierarchyBasedTap', message(POINT_SOURCE, x=519, y=106))
        for text in [good.replace(point, ''), good + point,
                     point + good.replace(point, ''), good.replace('maestro.Maestro.hierarchyBasedTap', 'private.Foreign.hierarchyBasedTap'),
                     good + log('tap', message(SELECTED_SOURCE, element=element())),
                     good.replace('text=Skip\u00a0\u00a0', 'text=Skip Backup')]:
            self.write(text=text)
            self.assertEqual(self.collect()['state'], 'UNKNOWN')

    def test_target_bounds_and_point_types_are_finite_and_unambiguous(self):
        for text in [produced_log(bounds=(0, 78, 0, 56)), produced_log(bounds=(0, 78, 1038, 0)),
                     produced_log(point=(100001, 2)), produced_log().replace('x=0, y=78', 'x=00, y=78'),
                     produced_log().replace('resource-id=btn_skip', 'resource-id=btn_skip, resource-id=foreign'),
                     produced_log(resource='foreign_private_id')]:
            self.write(text=text)
            self.assertEqual(self.collect()['state'], 'UNKNOWN')

    def test_only_lf_or_crlf_records_bind_and_payload_controls_never_create_source_records(self):
        good = produced_log()
        self.write(text=good.replace('\n', '\r\n'))
        self.assertEqual(self.collect()['state'], 'OBSERVED')
        for control in ('\u2028', '\u2029', '\ufffd', '\v', '\f', '\x1b', '\x85'):
            self.write(text=good.replace('\n', control) + '\n')
            self.assertEqual(self.collect()['state'], 'UNKNOWN')
        self.write(text=good + '\tat private.Exception(PRIVATE_SENTINEL)\n')
        self.assertEqual(self.collect()['state'], 'OBSERVED')

    def test_private_log_symlinks_oversize_invalid_utf8_partial_and_late_identity_changes_reject(self):
        original = self.log.read_bytes()
        target = self.bundle / 'private.log'; target.write_bytes(original)
        self.log.unlink(); self.log.symlink_to(target)
        self.assertEqual(self.collect()['state'], 'UNKNOWN')
        self.log.unlink()
        for content in [b'x' * (reader.LIMIT + 1), b'\xff', original[:-1]]:
            self.log.write_bytes(content)
            self.assertEqual(self.collect()['state'], 'UNKNOWN')
        self.log.write_bytes(original)
        actual = reader.os.fstat
        calls = 0
        def late(fd):
            nonlocal calls
            result = actual(fd)
            if result.st_ino != self.log.stat().st_ino:
                return result
            calls += 1
            if calls == 2:
                with self.log.open('ab') as stream:
                    stream.write(b'PRIVATE_SENTINEL\n')
                result = actual(fd)
            return result
        with mock.patch.object(reader.os, 'fstat', side_effect=late):
            self.assertEqual(self.collect()['state'], 'UNKNOWN')


if __name__ == '__main__':
    unittest.main()
