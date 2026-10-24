"""Project one Maestro 2.11 failed-assertion outcome; never tap-time evidence.

Format inspected at upstream c8c361be1cc89b2e742f185466a302a22778be6b:
TestOutputWriter, FlowDebugOutput, ArtifactsGenerator, ArtifactCollector,
TreeNode and AndroidDriver. commands.json carries per-execution sequenceNumber
and artifacts-folder-relative SCREEN_HIERARCHY paths. Passing taps have no
hierarchy; neither commands nor the outcome hierarchy records resolved taps.
"""
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat

FILE_LIMIT = 1024 * 1024
ENTRY_LIMIT = 512
STEP_LIMIT = 2048
NODE_LIMIT = 10000
COORD_LIMIT = 100000
FLAGS = ('clickable', 'enabled', 'focused', 'selected')
SCOPE = 'POST_FAILED_ASSERT_OUTCOME_NOT_TAP_TIME'
# TestRunner/TestSuiteInteractor use the checked-in YAML config.name for the
# direct per-flow folder. These commands use no shard/retry CLI option.
FLOWS = {'product_first_wallet.yaml': 'Full app startup first wallet and cold persistence',
         'product_retry.yaml': 'Full app controlled setup disconnect Retry and cold persistence'}
STATUSES = ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'WARNED', 'SKIPPED')


def unknown(reason='UNAVAILABLE'):
    return {'schema': 1, 'binding_state': 'UNKNOWN', 'reason': reason,
            'scope': SCOPE, 'failed_assertion': None, 'node_count': None,
            'skip': {'state': 'UNKNOWN', 'exact_resource_id_count': None,
                     'bounds': None, **dict.fromkeys(FLAGS),
                     'conflicts': dict.fromkeys(FLAGS)},
            'tap_coordinates': 'NOT_RECORDED', 'visible_to_user': 'NOT_RECORDED'}


def reject():
    raise ValueError()


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            reject()
        result[key] = value
    return result


def read_json(path, root):
    if root.is_symlink() or not root.is_dir() or not path.resolve().is_relative_to(root.resolve()):
        reject()
    for item in (path, *path.parents):
        if item.is_symlink():
            reject()
        if item == root:
            break
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > FILE_LIMIT:
        reject()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        actual = os.fstat(stream.fileno())
        if (actual.st_dev, actual.st_ino, actual.st_size) != (before.st_dev, before.st_ino, before.st_size):
            reject()
        payload = stream.read(FILE_LIMIT + 1)
        after = os.fstat(stream.fileno())
        if (actual.st_size, actual.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            reject()
    if len(payload) > FILE_LIMIT:
        reject()
    data = json.loads(payload.decode('utf-8'), object_pairs_hook=pairs, parse_constant=lambda _: reject())
    # Bound even ignored command payloads, including embedded scripts/errors.
    pending, count = [(data, 0)], 0
    while pending:
        item, depth = pending.pop()
        count += 1
        if depth > 128 or count > 50000:
            reject()
        if type(item) is dict:
            if len(item) > 256 or any(type(key) is not str for key in item):
                reject()
            pending.extend((value, depth + 1) for value in item.values())
        elif type(item) is list:
            if len(item) > NODE_LIMIT:
                reject()
            pending.extend((value, depth + 1) for value in item)
        elif type(item) is str and len(item) > 65536:
            reject()
        elif type(item) in (int, float) and (not math.isfinite(item) or abs(item) > 2 ** 53 - 1):
            reject()
    return data


def commands_file(root):
    if root.is_symlink() or not root.is_dir():
        reject()
    pending, found, count = [(root, 0)], [], 0
    while pending:
        directory, depth = pending.pop()
        if depth > 6:
            reject()
        with os.scandir(directory) as entries:
            for entry in entries:
                count += 1
                if count > ENTRY_LIMIT or entry.is_symlink():
                    reject()
                if entry.is_dir(follow_symlinks=False):
                    pending.append((Path(entry.path), depth + 1))
                elif entry.name == 'commands.json':
                    found.append(Path(entry.path))
                    if len(found) > 1:
                        reject()
    if len(found) != 1:
        reject()
    return found[0]


def target(command):
    if type(command) is not dict or set(command) != {'assertConditionCommand'}:
        return False
    assertion = command['assertConditionCommand']
    if (type(assertion) is not dict or
            not set(assertion) <= {'condition', 'timeout', 'label', 'optional'} or
            assertion.get('optional', False) is not False or assertion.get('label') is not None):
        return False
    timeout = assertion.get('timeout')
    if timeout is not None and (type(timeout) is not str or not re.fullmatch(r'[0-9]{1,10}', timeout)):
        return False
    condition = assertion.get('condition')
    if type(condition) is not dict or set(condition) != {'visible'}:
        return False
    visible = condition['visible']
    return (type(visible) is dict and set(visible) <= {'idRegex', 'optional'} and
            visible.get('idRegex') == 'view_startNewTile' and visible.get('optional', False) is False)


def failed_step(rows):
    if type(rows) is not list or not 1 <= len(rows) <= STEP_LIMIT:
        reject()
    candidates, previous, artifact_paths = [], -1, set()
    metadata_fields = {'status', 'timestamp', 'duration', 'error', 'sequenceNumber',
                       'depth', 'evaluatedCommand', 'artifacts'}
    for row in rows:
        if type(row) is not dict or set(row) != {'command', 'metadata'}:
            reject()
        metadata, command = row['metadata'], row['command']
        if (type(command) is not dict or len(command) > 1 or type(metadata) is not dict or
                not set(metadata) <= metadata_fields or metadata.get('status') not in STATUSES):
            reject()
        sequence = metadata.get('sequenceNumber')
        if type(sequence) is not int or not previous < sequence < STEP_LIMIT:
            reject()
        previous = sequence
        if type(metadata.get('depth', 0)) is not int or not 0 <= metadata.get('depth', 0) <= 128:
            reject()
        for field in ('timestamp', 'duration'):
            if field in metadata and (type(metadata[field]) is not int or not 0 <= metadata[field] <= 10 ** 14):
                reject()
        if 'error' in metadata and (type(metadata['error']) is not dict or
                not set(metadata['error']) <= {'message', 'debugMessage'} or
                any(type(value) is not str for value in metadata['error'].values())):
            reject()
        if 'artifacts' in metadata and type(metadata['artifacts']) is not list:
            reject()
        artifacts = metadata.get('artifacts', [])
        if len(artifacts) > 32:
            reject()
        for artifact in artifacts:
            if (type(artifact) is not dict or set(artifact) != {'type', 'path'} or
                    type(artifact['type']) is not str or type(artifact['path']) is not str):
                reject()
            if artifact['path'] in artifact_paths:
                reject()
            artifact_paths.add(artifact['path'])
        if metadata['status'] == 'FAILED' and target(command):
            if 'evaluatedCommand' in metadata and not target(metadata['evaluatedCommand']):
                reject()
            candidates.append((sequence, artifacts))
    if len(candidates) != 1:
        reject()
    sequence, artifacts = candidates[0]
    snapshots = [item['path'] for item in artifacts if item['type'] == 'SCREEN_HIERARCHY']
    if len(snapshots) != 1:
        reject()
    path = snapshots[0]
    parts = PurePosixPath(path).parts
    match = re.fullmatch(r'screen-hierarchy/step-([0-9]{3,6})(?:-[A-Za-z0-9_.-]{1,40})?\.json', path)
    if (not match or len(parts) != 2 or any(part in ('.', '..') for part in parts) or
            int(match[1]) != sequence + 1):
        reject()
    return sequence, path


def snapshot(tree):
    pending, count, matches = [(tree, 0)], 0, []
    while pending:
        node, depth = pending.pop()
        count += 1
        if (count > NODE_LIMIT or depth > 128 or type(node) is not dict or
                not set(node) <= {'attributes', 'children', 'checked', *FLAGS}):
            reject()
        attrs, children = node.get('attributes', {}), node.get('children', [])
        if (type(attrs) is not dict or type(children) is not list or len(attrs) > 256 or
                any(type(key) is not str or type(value) is not str for key, value in attrs.items()) or
                any(node.get(flag) is not None and type(node[flag]) is not bool for flag in (*FLAGS, 'checked'))):
            reject()
        if attrs.get('resource-id') in ('btn_skip', 'io.hexawallet.keeper.development:id/btn_skip'):
            matches.append(node)
        pending.extend((child, depth + 1) for child in children)
    return count, matches


def project_skip(nodes):
    result = unknown()['skip']
    result['exact_resource_id_count'] = len(nodes)
    if not nodes:
        result['state'] = 'ABSENT'
        return result
    if len(nodes) != 1:
        return result
    node, attrs = nodes[0], nodes[0].get('attributes', {})
    number = r'(0|-?[1-9][0-9]{0,5})'
    bounds = re.fullmatch(r'\[' + number + ',' + number + r'\]\[' + number + ',' + number + r'\]', attrs.get('bounds', ''))
    if not bounds:
        return result
    left, top, right, bottom = map(int, bounds.groups())
    if (any(abs(value) > COORD_LIMIT for value in (left, top, right, bottom)) or
            right <= left or bottom <= top):
        return result
    for flag in FLAGS:
        if flag in attrs and attrs[flag] not in ('true', 'false'):
            return result
    result.update(state='UNIQUE_VALID_BOUNDS', bounds={'left': left, 'top': top, 'right': right, 'bottom': bottom})
    for flag in FLAGS:
        direct = node.get(flag)
        attribute = attrs.get(flag)
        attribute = attribute == 'true' if attribute is not None else None
        conflict = direct is not None and attribute is not None and direct != attribute
        result['conflicts'][flag] = conflict
        result[flag] = None if conflict else direct if direct is not None else attribute
    return result


def collect(directory, flow, failure):
    result = unknown('UNBOUND_FAILED_ASSERTION')
    if (flow not in FLOWS or type(failure) is not dict or
            failure.get('state') != 'ERROR_RECORDED' or
            failure.get('failure_kind') != 'ASSERT_VISIBLE' or
            failure.get('failed_selector') != 'start_new_tile'):
        return result
    try:
        root = Path(directory).absolute()
        commands = commands_file(root)
        if commands.parent != root / FLOWS[flow]:
            reject()
        sequence, relative = failed_step(read_json(commands, root))
        tree = read_json(commands.parent / relative, root)
        count, nodes = snapshot(tree)
        result.update(binding_state='BOUND', reason='FAILED_ASSERTION_OUTCOME', node_count=count,
                      failed_assertion={'kind': 'ASSERT_VISIBLE', 'selector': 'start_new_tile',
                                        'sequence_number': sequence}, skip=project_skip(nodes))
    except Exception:
        pass
    return result
