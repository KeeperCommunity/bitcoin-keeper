"""Pinned Maestro Skip intent only; never app delivery or arbitrary coordinates.

Producer: Maestro c8c361be1cc89b2e742f185466a302a22778be6b,
Maestro.kt:227/408/448, ScopedLogCapture.kt FILE_LOG_PATTERN, and
ArtifactsGenerator.kt:74. The existing per-flow log stays private.
"""
import importlib.util
import os
from pathlib import Path
import re
import stat

SCOPE = 'HOST_DRIVER_TAP_INTENT_NOT_APP_DELIVERY'
BINDING = 'LOG_SEMANTIC_ORDER_NOT_EPOCH_CORRELATED'
LIMIT = 1024 * 1024
SKIP_REGEX = r'^Skip[ \u00A0]*$'
NUMBER = r'(0|-?[1-9][0-9]{0,4})'
HEADER = re.compile(r'^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3} '
                    r'\[ *INFO\] maestro\.Maestro\.(tap|hierarchyBasedTap|screenshotBasedTap): (.*)$')
START = 'Tapping on element:  '
ELEMENT = 'UiElement(treeNode=TreeNode(attributes={'
SELECTOR_FIELDS = frozenset(('textRegex', 'idRegex', 'size', 'below', 'above', 'leftOf', 'rightOf',
    'containsChild', 'containsDescendants', 'traits', 'index', 'enabled', 'optional', 'selected',
    'checked', 'focused', 'childOf', 'css'))
TAP_FIELDS = frozenset(('selector', 'retryIfNoChange', 'waitUntilVisible', 'longPress', 'repeat',
    'waitToSettleTimeoutMs', 'relativePoint', 'label', 'optional'))


def unknown(reason='UNBOUND_FAILED_ASSERTION'):
    return {'schema': 1, 'state': 'UNKNOWN', 'reason': reason, 'scope': SCOPE,
            'binding': BINDING, 'command_sequence': None, 'target_identity': None,
            'selected_bounds': None, 'driver_point': None, 'point_relation': None,
            'driver_path': None, 'app_delivery': 'UNKNOWN'}


def reject():
    raise ValueError()


def source_helper():
    spec = importlib.util.spec_from_file_location('skip_snapshot_policy',
        Path(__file__).with_name('maestro_failure_snapshot.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def selector(value, field, expected, parent=False):
    if type(value) is not dict or not set(value) <= SELECTOR_FIELDS or value.get(field) != expected:
        return False
    active = {key: item for key, item in value.items() if item is not None and
              not (key == 'optional' and item is False)}
    return active == ({field: expected, 'childOf': value['childOf']} if parent else {field: expected})


def skip_command(command):
    if type(command) is not dict or set(command) != {'tapOnElement'}:
        return False
    tap = command['tapOnElement']
    if type(tap) is not dict or not set(tap) <= TAP_FIELDS:
        return False
    for key, value in tap.items():
        if key != 'selector' and value is not None and not (
                key in ('retryIfNoChange', 'waitUntilVisible', 'longPress', 'optional') and value is False):
            return False
    target = tap.get('selector')
    if type(target) is not dict or not selector(target, 'textRegex', SKIP_REGEX, parent=True):
        return False
    return selector(target.get('childOf'), 'idRegex', 'btn_skip')


def command_binding(rows, failed_sequence):
    taps, chosen = [], []
    for row in rows:
        command, metadata = row['command'], row['metadata']
        if (metadata['status'] not in ('SKIPPED', 'PENDING') and
                any(key in command for key in ('tapOnPoint', 'tapOnPointV2Command'))):
            reject()
        if 'tapOnElement' not in command:
            continue
        status = metadata['status']
        if status in ('SKIPPED', 'PENDING'):
            continue
        if status != 'COMPLETED' or metadata['sequenceNumber'] >= failed_sequence:
            reject()
        tap = command['tapOnElement']
        # The selected-element logger runs once for these ordinary element taps.
        # Relative/repeated/visibility-reentry forms cannot be ordinal-bound here.
        if type(tap) is not dict or any(tap.get(key) is not None and not (
                key in ('longPress', 'waitUntilVisible', 'retryIfNoChange') and tap[key] is False)
                for key in ('relativePoint', 'repeat', 'longPress', 'waitUntilVisible', 'retryIfNoChange')):
            reject()
        evaluated = metadata.get('evaluatedCommand')
        if skip_command(command):
            if not skip_command(evaluated):
                reject()
            chosen.append((len(taps), metadata['sequenceNumber']))
        taps.append(row)
    if len(chosen) != 1:
        reject()
    return len(taps), chosen[0]


def read_log(path, root):
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        reject()
    for item in (path, *path.parents):
        if item.is_symlink():
            reject()
        if item == root:
            break
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > LIMIT:
        reject()
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        opened = os.fstat(stream.fileno())
        if identity(opened) != identity(before):
            reject()
        payload = stream.read(LIMIT + 1)
        if identity(os.fstat(stream.fileno())) != identity(opened):
            reject()
    if (len(payload) > LIMIT or identity(path.stat()) != identity(before) or path.is_symlink()):
        reject()
    text = payload.decode('utf-8')
    if text and not text.endswith('\n'):
        reject()
    # The producer terminates records with %n (LF on the hosted Unix runner).
    # Unicode separators inside a UI string must never become log records.
    if any(value in text for value in ('\u2028', '\u2029', '\ufffd')):
        reject()
    lines = [line[:-1] if line.endswith('\r') else line for line in text.split('\n')[:-1]]
    if len(lines) > 20000 or any(len(line) > 65536 for line in lines):
        reject()
    return lines


def selected(message):
    if not message.startswith(START + ELEMENT):
        reject()
    body = message[len(START + ELEMENT):]
    if '}, children=' not in body:
        reject()
    attributes = {}
    for part in body.split('}, children=', 1)[0].split(', '):
        key, separator, value = part.partition('=')
        if not separator or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.:-]{0,63}', key) or key in attributes:
            reject()
        attributes[key] = value
    label = any(re.fullmatch(r'Skip[ \u00a0]*', attributes.get(key, '')) for key in
                ('text', 'hintText', 'accessibilityText'))
    if not label:
        reject()
    if attributes.get('resource-id') not in (None, '', 'btn_skip', 'io.hexawallet.keeper.development:id/btn_skip'):
        reject()
    identity = ('SKIP_BUTTON_AND_LABEL' if attributes.get('resource-id') in
                ('btn_skip', 'io.hexawallet.keeper.development:id/btn_skip') else 'SKIP_LABEL')
    match = re.search(r', bounds=Bounds\(x=' + NUMBER + r', y=' + NUMBER +
                      r', width=([1-9][0-9]{0,4}), height=([1-9][0-9]{0,4})\)\) *$', message)
    if not match:
        reject()
    left, top, width, height = map(int, match.groups())
    if any(abs(value) > 100000 for value in (left, top, left + width, top + height)):
        reject()
    return identity, {'left': left, 'top': top, 'right': left + width, 'bottom': top + height}


def project(lines, count, ordinal):
    starts, point_records = [], []
    for index, line in enumerate(lines):
        parsed = HEADER.fullmatch(line)
        if not parsed:
            continue
        method, message = parsed.groups()
        if any(ord(value) < 32 or 127 <= ord(value) <= 159 for value in line):
            reject()
        if method == 'tap' and message.startswith('Tapping on element:'):
            starts.append((index, message))
        pattern = ('Tapping at ' if method == 'hierarchyBasedTap' else
                   'Try tapping at ' if method == 'screenshotBasedTap' else None)
        if pattern:
            point = re.fullmatch(re.escape(pattern) + r'\(' + NUMBER + ', ' + NUMBER +
                                 r'\) using hierarchy based logic for wait *', message)
            if point:
                point_records.append((index, method, tuple(map(int, point.groups()))))
    if len(starts) != count or not 0 <= ordinal < len(starts):
        reject()
    index, message = starts[ordinal]
    identity, bounds = selected(message)
    end = starts[ordinal + 1][0] if ordinal + 1 < len(starts) else len(lines)
    points = [item for item in point_records if index < item[0] < end]
    if len(points) != 1:
        reject()
    _, method, (x, y) = points[0]
    if any(abs(value) > 100000 for value in (x, y)):
        reject()
    relation = ('INSIDE_INITIAL_SELECTED_BOUNDS' if bounds['left'] <= x < bounds['right'] and
                bounds['top'] <= y < bounds['bottom'] else 'OUTSIDE_INITIAL_SELECTED_BOUNDS')
    return identity, bounds, {'x': x, 'y': y}, relation, (
        'HIERARCHY_BASED' if method == 'hierarchyBasedTap' else 'SCREENSHOT_BASED')


def collect(directory, flow, failure):
    result = unknown()
    if (type(failure) is not dict or failure.get('state') != 'ERROR_RECORDED' or
            failure.get('failure_kind') != 'ASSERT_VISIBLE' or failure.get('failed_selector') != 'start_new_tile'):
        return result
    stage = 'SOURCE_POLICY'
    try:
        policy = source_helper()
        if flow not in policy.FLOWS:
            return result
        root = Path(directory).absolute()
        stage = 'COMMAND_BINDING'
        commands = policy.commands_file(root)
        if commands.parent != root / policy.FLOWS[flow]:
            reject()
        rows = policy.read_json(commands, root)
        failed_sequence, _ = policy.failed_step(rows)
        count, (ordinal, sequence) = command_binding(rows, failed_sequence)
        stage = 'PRIVATE_LOG'
        lines = read_log(commands.parent / 'logs/maestro.log', root)
        stage = 'TAP_INTENT_BINDING'
        identity, bounds, point, relation, driver = project(lines, count, ordinal)
        result.update(state='OBSERVED', reason='UNIQUE_BOUND_SKIP_DRIVER_INTENT', command_sequence=sequence,
                      target_identity=identity, selected_bounds=bounds, driver_point=point,
                      point_relation=relation, driver_path=driver)
    except Exception:
        return unknown(stage)
    return result
