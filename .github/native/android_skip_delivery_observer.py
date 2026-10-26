"""Read-only ADB snapshots at the original synchronous first-sample PIN hooks."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import socket
import stat
import subprocess
import sys
import threading
import time

SOURCE = 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa'
TREE = 'ee0c587945901788b4ad62ad28ed660ab656cb6a'
APP = 'io.hexawallet.keeper.development'
HELPER = '.github/native/android_skip_delivery_observer.py'
STAGED = ('android_skip_delivery_observer.py', 'r52_realm109_history.py', 'r52_realm109_objects.json')
HISTORY_SHA = '5c4e2d9442aee1be67625fe0b1e6795e88a8c2f64464ab1ccd733f897accc409'
HISTORY_BUNDLE_SHA = '07aaa45bb0158b78ee9af7dd0d9efceda9941a2214c5a318a7a4a0193b0c18a9'
CHECKPOINT_SHA = '3134dab1ed51e38f4fce10fad3314fedd5db9e45c4698a2fb74fc8533cfaa181'
PRODUCT_SHA = '1151ae24618f1c3b0200d298bfa79b71d398069d15ca5f8e7e97537fc4e84c5c'
HOSTED_SHA = 'bfaad2396681be811768b53df85189509830236a61d30d40fb8a4eae7bd2db1c'
LIMIT = 256 * 1024
SNAPSHOT_SECONDS = 8
COMMAND_SECONDS = 1
METRO_WAIT_SECONDS = 65
SCOPE = 'SYNCHRONOUS_FIRST_SAMPLE_SKIP_READ_ONLY_ADB_OBSERVATION_NOT_INPUT_DELIVERY_OR_RELEASE_ACCEPTANCE'
RECT = r'\[(-?\d{1,6}),(-?\d{1,6})\]\[(-?\d{1,6}),(-?\d{1,6})\]'
TYPES = ('BASE_APPLICATION', 'APPLICATION', 'APPLICATION_STARTING', 'APPLICATION_PANEL',
         'APPLICATION_ATTACHED_DIALOG', 'STATUS_BAR', 'NAVIGATION_BAR', 'INPUT_METHOD',
         'APPLICATION_OVERLAY', 'NOTIFICATION_SHADE', 'STATUS_BAR_SUB_PANEL')
MARKERS = ('ONBOARDING_EFFECT', 'SKIP_PRESS_IN', 'SKIP_PRESS_OUT', 'SKIP_PRESS',
           'SKIP_RESET_RETURNED', 'SKIP_RESET_THROWN', 'NEW_KEEPER_EFFECT')
COMMANDS = {
    'pid_before': ('shell', 'pidof', '-s', APP),
    'guest_before': ('shell', 'date', '+%s'),
    'windows': ('shell', 'dumpsys', 'window', '-a', 'windows'),
    'displays': ('shell', 'dumpsys', 'window', '-a', 'displays'),
    'input': ('shell', 'dumpsys', 'input'),
    'size': ('shell', 'wm', 'size'),
    'density': ('shell', 'wm', 'density'),
    'markers': ('logcat', '-d', '-b', 'main', '-v', 'epoch', 'ReactNativeJS:E', '*:S'),
    'pid_after': ('shell', 'pidof', '-s', APP),
    'guest_after': ('shell', 'date', '+%s'),
}


def require(value):
    if not value:
        raise RuntimeError('SKIP_OBSERVER_ADMISSION_REJECTED')


def regular(path, limit=1024 * 1024):
    directory(path.parent)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1 and
            0 < info.st_size <= limit)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        opened = os.fstat(stream.fileno())
        require((info.st_dev, info.st_ino, info.st_size) == (opened.st_dev, opened.st_ino, opened.st_size))
        raw = stream.read(limit + 1)
    require(len(raw) == info.st_size)
    return raw


def directory(path):
    require(path.is_absolute() and path.resolve(strict=True) == path and
            stat.S_ISDIR(path.lstat().st_mode) and path.lstat().st_uid == os.getuid())


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def new_file(path, raw):
    directory(path.parent)
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as out:
        out.write(raw)


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL, timeout=30)


def context(env):
    for key, expected in {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
        'GITHUB_REPOSITORY': 'KeeperCommunity/bitcoin-keeper-private', 'GITHUB_REPOSITORY_ID': '839671816',
        'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_RUN_ATTEMPT': '1', 'RUNNER_OS': 'Linux',
        'RUNNER_ARCH': 'X64', 'ImageOS': 'ubuntu24', 'KEEPER_NATIVE_PLATFORM': 'ANDROID',
        'KEEPER_DIAGNOSTIC': 'true',
        'GITHUB_WORKFLOW_REF': 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-private-android-runtime-reuse.yml@refs/pull/73/merge'}.items():
        require(env.get(key) == expected)
    require(re.fullmatch('[a-f0-9]{40}', env.get('KEEPER_CONTROLLER_SHA', '')) is not None)
    root, temporary = Path(env['GITHUB_WORKSPACE']), Path(env['RUNNER_TEMP'])
    directory(root); directory(temporary)
    event = json.loads(regular(Path(env['GITHUB_EVENT_PATH'])))
    pr = event['pull_request']
    require(event['action'] == 'labeled' and event['label']['name'] == 'keeper/android-runtime-reuse' and
        event['repository']['id'] == 839671816 and event['repository']['private'] is True and
        pr['number'] == 73 and pr['head']['repo']['id'] == 839671816 and
        pr['head']['sha'] == env['KEEPER_CONTROLLER_SHA'] and
        'keeper/native-diagnostic' not in {row['name'] for row in pr['labels']})
    return root, temporary / 'keeper-skip-delivery-controller'


def stage(env):
    root, state = context(env)
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == env['KEEPER_CONTROLLER_SHA'])
    files = {name: regular(root / '.github/native' / name) for name in STAGED}
    require(all(raw == git(root, 'show', 'HEAD:.github/native/' + name) for name, raw in files.items()))
    require(digest(files[STAGED[1]]) == HISTORY_SHA and digest(files[STAGED[2]]) == HISTORY_BUNDLE_SHA)
    state.mkdir(mode=0o700)
    for name, raw in files.items():
        new_file(state / name, raw)
    identity = {'schema': 1, 'controller_sha': env['KEEPER_CONTROLLER_SHA'],
        'controller_tree': git(root, 'rev-parse', 'HEAD^{tree}').decode().strip(),
        'hashes': {name: digest(raw) for name, raw in files.items()}}
    encoded = (json.dumps(identity, sort_keys=True) + '\n').encode()
    new_file(state / 'identity.json', encoded)
    with os.fdopen(os.open(env['GITHUB_ENV'], os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW), 'w') as out:
        out.write('KEEPER_SKIP_HELPER_SHA256=' + identity['hashes'][STAGED[0]] + '\n')
        out.write('KEEPER_SKIP_IDENTITY_SHA256=' + digest(encoded) + '\n')


def pinned(root, name, expected):
    path = root / '.github/native' / (name + '.py')
    raw = regular(path)
    require(digest(raw) == expected and raw == git(root, 'show', 'HEAD:.github/native/' + name + '.py'))
    spec = importlib.util.spec_from_file_location('skip_original_' + name, path)
    value = importlib.util.module_from_spec(spec)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    return value


def admitted(env):
    root, state = context(env); directory(state)
    raw = regular(state / 'identity.json')
    require(digest(raw) == env.get('KEEPER_SKIP_IDENTITY_SHA256'))
    identity = json.loads(raw)
    require(identity.get('controller_sha') == env['KEEPER_CONTROLLER_SHA'] and
            set(identity.get('hashes', {})) == set(STAGED) and
            identity['hashes'][STAGED[0]] == env.get('KEEPER_SKIP_HELPER_SHA256') and
            identity['hashes'][STAGED[1]] == HISTORY_SHA and identity['hashes'][STAGED[2]] == HISTORY_BUNDLE_SHA)
    require(Path(__file__).resolve() == state / 'android_skip_delivery_observer.py' and
            all(digest(regular(state / name)) == identity['hashes'][name] for name in STAGED))
    require(git(root, 'rev-parse', 'HEAD').decode().strip() == SOURCE and
            git(root, 'rev-parse', 'HEAD^{tree}').decode().strip() == TREE and env.get('KEEPER_SOURCE_SHA') == SOURCE)
    checkpoint = Path(env['RUNNER_TEMP']) / 'keeper-android-reuse-controller/android_runtime_checkpoint.py'
    require(digest(regular(checkpoint)) == CHECKPOINT_SHA == env.get('KEEPER_HELPER_SHA256'))
    spec = importlib.util.spec_from_file_location('skip_original_checkpoint', checkpoint)
    runtime = importlib.util.module_from_spec(spec)
    exec(compile(regular(checkpoint), str(checkpoint), 'exec'), runtime.__dict__)
    admitted_root, _, original_state, _ = runtime.guarded(env)
    require(admitted_root == root and digest(regular(original_state / 'admitted.json')) == env.get('KEEPER_ADMISSION_SHA256'))
    return root, state, identity


def provision_history(env):
    root, state, _ = admitted(env)
    path = state / 'r52_realm109_history.py'
    spec = importlib.util.spec_from_file_location('skip_selected_history', path)
    history = importlib.util.module_from_spec(spec)
    exec(compile(regular(path), str(path), 'exec'), history.__dict__)
    receipt = history.provision(root, state / 'r52_realm109_objects.json',
        Path(env['RUNNER_TEMP']) / 'keeper-realm109-history-admission.json')
    print('REALM109_SELECTED_HISTORY_PROVISIONED=' + json.dumps(receipt, sort_keys=True), flush=True)


def number(raw):
    return int(raw) if re.fullmatch(r'[0-9]{1,12}\n?', raw) else None


def text(raw):
    require(type(raw) is bytes and len(raw) <= LIMIT)
    value = raw.decode('utf-8', errors='strict')
    require(value.endswith('\n') and '\x00' not in value and '\ufffd' not in value and
            len(value.splitlines()) <= 8192 and all(len(line) <= 16384 for line in value.splitlines()))
    return value


def rectangle(groups):
    values = list(map(int, groups))
    if all(abs(value) <= 100000 for value in values) and values[0] <= values[2] and values[1] <= values[3]:
        return dict(zip(('left', 'top', 'right', 'bottom'), values))
    return None


def rect_field(line, name):
    matches = re.findall(r'(?<![A-Za-z])' + re.escape(name) + '=' + RECT, line)
    return rectangle(matches[0]) if len(matches) == 1 else None


def relation(value):
    if re.search(r'(?<![A-Za-z0-9_.])' + re.escape(APP) + r'(?![A-Za-z0-9_.])', value):
        return 'OWN_APP_LABEL'
    for literal, result in (('StatusBar', 'STATUS_BAR'), ('NavigationBar', 'NAVIGATION_BAR'),
                            ('NotificationShade', 'NOTIFICATION_SHADE'), ('InputMethod', 'INPUT_METHOD')):
        if literal in value:
            return result
    return 'OTHER'


def regions(line):
    # android.graphics.Region native toString uses SkRegion((l,t,r,b)...).
    match = re.fullmatch(r'\s*touchable region=SkRegion\((.*)\)\s*', line)
    if not match:
        return None
    chunks = re.findall(r'\((-?\d{1,6}),(-?\d{1,6}),(-?\d{1,6}),(-?\d{1,6})\)', match[1])
    if not 1 <= len(chunks) <= 64 or ''.join('(' + ','.join(chunk) + ')' for chunk in chunks) != match[1]:
        return None
    result = [rectangle(chunk) for chunk in chunks]
    return result if all(item is not None for item in result) else None


def window_facts(payload, pid):
    lines = text(payload).splitlines()
    result = {'scope': 'NATIVE_WINDOW_FRAMES_NOT_RN_CONTENT_ROOT_OR_HIT_TEST', 'focus_relation': 'UNKNOWN',
              'focus_window_index': None, 'windows': [], 'unclassified_window_count': 0}
    starts = [(i, re.fullmatch(r'\s*Window #(\d{1,3}) Window\{([a-f0-9]{1,16}) .*\}:', line))
              for i, line in enumerate(lines)]
    starts = [(i, match) for i, match in starts if match]
    require(len(starts) <= 128)
    focus = [re.search(r'\bmCurrentFocus=Window\{([a-f0-9]{1,16}) ', line) for line in lines]
    focus = [match[1] for match in focus if match]
    require(len(set(focus)) <= 1)
    for position, (index, header) in enumerate(starts):
        block = lines[index:(starts[position + 1][0] if position + 1 < len(starts) else len(lines))]
        body = '\n'.join(block)
        own = re.search(r'\bpackage=' + re.escape(APP) + r'(?:\s|$)', body) is not None
        kind = re.findall(r'\bty=([A-Z_]+)\b', body)
        kind = kind[0] if len(set(kind)) == 1 and kind[0] in TYPES else 'UNKNOWN'
        category = 'OWN_APP_LABEL' if own else kind if kind in ('STATUS_BAR', 'NAVIGATION_BAR',
            'INPUT_METHOD', 'APPLICATION_OVERLAY', 'NOTIFICATION_SHADE', 'STATUS_BAR_SUB_PANEL') else 'OTHER'
        if category == 'OTHER':
            result['unclassified_window_count'] += 1
            continue
        row = {'index': int(header[1]), 'category': category, 'type': kind,
               'pid_binding': 'UNKNOWN', 'frame': None, 'parent_frame': None,
               'display_frame': None, 'touchable_regions': None, 'obscured': None,
               'view_visibility': None, 'touchable_insets_mode': None}
        session = re.findall(r'\bmSession=Session\{[a-f0-9]+ ([1-9]\d{0,9}):', body)
        if own and len(set(session)) == 1:
            row['pid_binding'] = 'CURRENT_OWN_PID' if int(session[0]) == pid else 'FOREIGN_PID'
        for line in block:
            if 'Frames: parent=' in line:
                row.update(frame=rect_field(line, 'frame'), parent_frame=rect_field(line, 'parent'),
                           display_frame=rect_field(line, 'display'))
            region = regions(line)
            if region is not None:
                row['touchable_regions'] = region
            match = re.search(r'\bmObscured=(true|false)\b', line)
            if match:
                row['obscured'] = match[1] == 'true'
            match = re.search(r'\bmViewVisibility=0x([0-9a-f]{1,2})\b', line)
            if match:
                row['view_visibility'] = {'0': 'VISIBLE', '4': 'INVISIBLE', '8': 'GONE'}.get(match[1], 'OTHER')
            match = re.search(r'\bmTouchableInsets=([0-3])\b', line)
            if match:
                row['touchable_insets_mode'] = int(match[1])
        result['windows'].append(row)
        if focus and focus[0] == header[2]:
            result.update(focus_relation=category, focus_window_index=row['index'])
    return result


def display_facts(payload):
    lines = text(payload).splitlines()
    result = {'display_frames': [], 'inset_sources': [], 'cutout_safe_insets': [],
              'scope': 'NATIVE_DISPLAY_INSETS_NOT_ACTUAL_RN_CONTENT_PADDING'}
    for line in lines:
        match = re.search(r'\bmDisplayFrame=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)', line)
        if match and (row := rectangle(match.groups())) is not None and row not in result['display_frames']:
            result['display_frames'].append(row)
        match = re.search(r'InsetsSource id=[a-f0-9]+ type=(statusBars|navigationBars|displayCutout|ime) frame=' + RECT +
                          r'(?: visibleFrame=' + RECT + r')? visible=(true|false)\b', line)
        if match:
            row = {'type': match[1], 'frame': rectangle(match.groups()[1:5]), 'visible': match.groups()[-1] == 'true'}
            if row['frame'] is not None and row not in result['inset_sources']:
                result['inset_sources'].append(row)
        if 'mDisplayCutout=DisplayCutout{' in line:
            match = re.search(r'insets=Rect\((\d+), (\d+) - (\d+), (\d+)\)', line)
            if match:
                row = dict(zip(('left', 'top', 'right', 'bottom'), map(int, match.groups())))
                if all(value <= 100000 for value in row.values()) and row not in result['cutout_safe_insets']:
                    result['cutout_safe_insets'].append(row)
    require(len(result['display_frames']) <= 16 and len(result['inset_sources']) <= 64 and len(result['cutout_safe_insets']) <= 16)
    return result


def input_facts(payload, pid):
    lines = text(payload).splitlines()
    result = {'dispatch_enabled': None, 'dispatch_frozen': None, 'focused_window_relation': 'UNKNOWN',
              'scope': 'INPUT_DISPATCHER_SNAPSHOT_NOT_EVENT_INJECTION_ACKNOWLEDGEMENT', 'window_records': [],
              'recent_dispatched_or_dropped_event_count': None}
    in_focus = False
    for line in lines:
        for key, label in (('dispatch_enabled', 'DispatchEnabled'), ('dispatch_frozen', 'DispatchFrozen')):
            match = re.fullmatch(r'\s*' + label + r': (true|false|0|1)\s*', line)
            if match:
                result[key] = match[1] in ('true', '1')
        if re.fullmatch(r'\s*FocusedWindows:\s*', line):
            in_focus = True
        elif in_focus and re.fullmatch(r"\s*displayId=0, name='[^\n]+'\s*", line):
            result['focused_window_relation'] = relation(line)
        elif in_focus and line.strip() and not re.match(r'\s*displayId=', line):
            in_focus = False
        count = re.fullmatch(r'\s*RecentQueue: length=(\d{1,3})\s*', line)
        if count and int(count[1]) <= 256:
            result['recent_dispatched_or_dropped_event_count'] = int(count[1])
        elif re.fullmatch(r'\s*RecentQueue: <empty>\s*', line):
            result['recent_dispatched_or_dropped_event_count'] = 0
        if 'touchableRegion=' in line:
            # Only fixed enums/numbers escape; unknown producer formats stay UNKNOWN.
            kind = re.search(r'\btype=([A-Z_]+)\b', line)
            frame = re.search(r'\bframe=' + RECT, line)
            owner = re.search(r'\bownerPid=([1-9]\d{0,9})\b', line)
            row = {'category': relation(line), 'type': kind[1] if kind and kind[1] in TYPES else 'UNKNOWN',
                   'frame': rectangle(frame.groups()) if frame else None,
                   'pid_binding': 'CURRENT_OWN_PID' if owner and int(owner[1]) == pid else 'UNKNOWN',
                   'touchable_regions': None, 'input_flags_present': []}
            region = re.search(r'touchableRegion=(.*?), ownerPid=', line)
            if region and region[1] == '<empty>':
                row['touchable_regions'] = []
            elif region:
                parts = region[1].split('|')
                if 1 <= len(parts) <= 64:
                    parsed = [re.fullmatch(RECT, part) for part in parts]
                    if all(parsed):
                        rectangles = [rectangle(match.groups()) for match in parsed]
                        if all(item is not None for item in rectangles):
                            row['touchable_regions'] = rectangles
            flags = re.search(r'\binputConfig=(.*?), alpha=', line)
            if flags:
                row['input_flags_present'] = [flag for flag in ('NOT_VISIBLE', 'NOT_FOCUSABLE', 'NOT_TOUCHABLE',
                    'SPY', 'DROP_INPUT', 'DROP_INPUT_IF_OBSCURED', 'PREVENT_SPLITTING') if
                    re.search(r'(?<![A-Z_])' + flag + r'(?![A-Z_])', flags[1])]
            if row['category'] != 'OTHER' or row['type'] == 'APPLICATION_OVERLAY':
                result['window_records'].append(row)
    require(len(result['window_records']) <= 128)
    return result


def marker_facts(payload, pid, lower, upper):
    result = {'scope': 'POSITIVE_OWN_PID_EPOCH_MARKERS_ONLY_MISSING_STAGES_UNKNOWN',
              'ordered_stages': [], 'outside_window_records': 0, 'foreign_pid_records': 0}
    for line in text(payload).splitlines():
        match = re.fullmatch(r'([0-9]{9,12})\.([0-9]{3}) +([1-9]\d{0,9}) +[1-9]\d{0,9} +E +ReactNativeJS: '
                             r'KEEPER_ONBOARDING_BOUNDARY\|v1\|([A-Z_]+)', line)
        if not match or match[4] not in MARKERS:
            continue
        if int(match[3]) != pid:
            result['foreign_pid_records'] += 1
        elif not lower <= int(match[1]) <= upper:
            result['outside_window_records'] += 1
        else:
            result['ordered_stages'].append(match[4])
        require(len(result['ordered_stages']) <= 64)
    return result


def bounded_command(device, label, deadline):
    require(re.fullmatch(r'emulator-[0-9]{4,5}', device) is not None and label in COMMANDS)
    budget = min(COMMAND_SECONDS, deadline - time.monotonic())
    if budget <= 0:
        return None, {'status': 'UNAVAILABLE', 'reason': 'SNAPSHOT_BUDGET_EXHAUSTED'}
    started = time.monotonic(); data = bytearray(); process = None
    status, reason = 'UNAVAILABLE', 'COMMAND_UNAVAILABLE'
    try:
        process = subprocess.Popen(['adb', '-s', device, *COMMANDS[label]], stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = budget - (time.monotonic() - started)
                if remaining <= 0:
                    reason = 'COMMAND_TIMEOUT'; break
                if not selector.select(remaining):
                    reason = 'COMMAND_TIMEOUT'; break
                chunk = os.read(process.stdout.fileno(), min(16384, LIMIT + 1 - len(data)))
                if not chunk:
                    selector.unregister(process.stdout); continue
                data.extend(chunk)
                if len(data) > LIMIT:
                    reason = 'COMMAND_OUTPUT_LIMIT'; break
            else:
                code = process.wait(timeout=max(0.01, budget - (time.monotonic() - started)))
                if code == 0:
                    status, reason = 'COLLECTED', None
    except Exception:
        pass
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=2)
            process.stdout.close()
    meta = {'status': status, 'reason': reason, 'bytes_read': len(data),
            'duration_ms': round((time.monotonic() - started) * 1000, 3)}
    return (bytes(data) if status == 'COLLECTED' else None), meta


class Observer:
    def __init__(self, device):
        self.device, self.lock, self.records, self.receipt = device, threading.Lock(), [], None
        self.first_guest_second, self.first_host_monotonic, self.pid = None, None, None

    def capture(self, receipt, marker):
        with self.lock:
            if self.receipt is None:
                self.receipt = receipt
            if receipt is not self.receipt or len(self.records) >= 2 or marker != ('skip_visible', 'skip_tapped')[len(self.records)]:
                return
            start = time.monotonic()
            record = {'marker': marker, 'position': 'BEFORE_ORIGINAL_SKIP' if marker == 'skip_visible' else 'AFTER_DRIVER_RETURN',
                      'status': 'UNAVAILABLE', 'commands': {}, 'facts': {}, 'cause': 'UNDETERMINED'}
            self.records.append(record)
            try:
                payloads = {}
                for label in COMMANDS:
                    payloads[label], record['commands'][label] = bounded_command(self.device, label, start + SNAPSHOT_SECONDS)
                pid0, pid1 = (number(text(payloads[key])) if payloads[key] is not None else None for key in ('pid_before', 'pid_after'))
                guest0, guest1 = (number(text(payloads[key])) if payloads[key] is not None else None for key in ('guest_before', 'guest_after'))
                bound = bool(pid0 and 0 < pid0 <= 2147483647 and pid0 == pid1 and guest0 and guest1 and
                             0 <= guest1 - guest0 <= SNAPSHOT_SECONDS + 1)
                record['binding'] = {'pid_before': pid0, 'pid_after': pid1, 'guest_epoch_second_before': guest0,
                    'guest_epoch_second_after': guest1, 'snapshot_pid_clock_bound': bound}
                if not bound:
                    return
                if self.pid is None:
                    self.pid, self.first_guest_second, self.first_host_monotonic = pid0, guest0, start
                record['binding']['same_pid_across_skip'] = self.pid == pid0
                consistent = abs((guest0 - self.first_guest_second) - (start - self.first_host_monotonic)) <= 3
                record['binding']['guest_vs_host_elapsed_consistent'] = consistent
                if self.pid != pid0 or not consistent:
                    return
                parsers = {'windows': lambda raw: window_facts(raw, pid0), 'displays': display_facts,
                    'input': lambda raw: input_facts(raw, pid0),
                    'markers': lambda raw: marker_facts(raw, pid0, self.first_guest_second, guest1)}
                for label, parser in parsers.items():
                    if payloads[label] is not None:
                        try:
                            record['facts'][label] = parser(payloads[label])
                        except Exception:
                            record['facts'][label] = {'status': 'UNAVAILABLE', 'reason': 'FORMAT_OR_LIMIT_REJECTED'}
                for label, pattern, keys in [('size', r'(?:Physical|Override) size: ([0-9]{1,5})x([0-9]{1,5})', ('width', 'height')),
                    ('density', r'(?:Physical|Override) density: ([0-9]{1,4})', ('dpi',))]:
                    if payloads[label] is not None:
                        rows = re.findall(pattern, text(payloads[label]))
                        if 1 <= len(rows) <= 2:
                            value = rows[-1] if type(rows[-1]) is tuple else (rows[-1],)
                            record['facts'][label] = dict(zip(keys, map(int, value)))
                record['status'] = 'COLLECTED_WITH_FIELD_AVAILABILITY'
            except Exception:
                record['status'] = 'UNAVAILABLE'
            finally:
                record['overhead_ms'] = round((time.monotonic() - start) * 1000, 3)


def observe_product(product, harness, observer):
    original = product.Receipt.mark_pin
    def mark_pin(receipt, marker):
        accepted = original(receipt, marker)
        if accepted and marker in ('skip_visible', 'skip_tapped'):
            with receipt.lock:
                selected = receipt.sample == 1 and receipt.retry is False
            if selected:
                try:
                    observer.capture(receipt, marker)
                except Exception:
                    pass
        return accepted
    product.Receipt.mark_pin = mark_pin
    try:
        return product.run(harness)
    finally:
        product.Receipt.mark_pin = original


def post_failure_geometry(data):
    result = {'scope': 'POST_FAILURE_NOT_TAP_TIME', 'status': 'NOT_RECORDED', 'target': None,
        'ancestor_limit': 16, 'ancestors': [], 'ancestors_status': 'NOT_RECORDED',
        'reason': 'UNCHANGED_SUITE_DELETES_RAW_BOUND_DEBUG_FILES_BEFORE_WRAPPER_RETURN'}
    product = data.get('product_ui')
    if type(product) is not dict:
        return result
    samples = product.get('samples', [])
    if (type(samples) is not list or not samples or type(samples[0]) is not dict or
            type(samples[0].get('sample')) is not int or samples[0]['sample'] != 1):
        return result
    snapshot = samples[0].get('failed_assertion_snapshot', {})
    if type(snapshot) is not dict or snapshot.get('binding_state') != 'BOUND':
        return result
    target = snapshot.get('skip', {})
    if type(target) is not dict or target.get('state') != 'UNIQUE_VALID_BOUNDS':
        return result
    bounds = target.get('bounds')
    if type(bounds) is not dict or set(bounds) != {'left', 'top', 'right', 'bottom'} or any(type(value) is not int for value in bounds.values()):
        return result
    frame = rectangle([bounds[key] for key in ('left', 'top', 'right', 'bottom')])
    if frame is not None:
        result.update(status='TARGET_RECORDED_ANCESTORS_NOT_RECORDED', target={'identity': 'BTN_SKIP', 'bounds': frame,
            **{key: target.get(key) if type(target.get(key)) is bool else None for key in ('enabled', 'clickable')}})
    return result


def run(env):
    root, state, identity = admitted(env)
    harness = pinned(root, 'hosted_native', HOSTED_SHA)
    product = pinned(root, 'product_measurements', PRODUCT_SHA)
    before = harness.read()
    gates = ('source_sha', 'run_id', 'build', 'built_artifact', 'smoke', 'native_probe', 'r5_features', 'hardware', 'signing')
    require(before.get('source_sha') == SOURCE and before.get('build') == 'PASS' and before.get('smoke') == 'PASS' and
            before.get('build_execution_scope') == 'REUSED_EXACT_ORIGINAL_PRIVATE_DEBUG_APK_NO_CURRENT_RUN_COMPILATION_OR_RELEASE' and
            harness.artifact_identity() == before['built_artifact'])
    device = subprocess.check_output(['adb', 'get-serialno'], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
    require(re.fullmatch(r'emulator-[0-9]{4,5}', device) is not None)
    observer = Observer(device)
    report = {'schema': 1, 'scope': SCOPE, 'native_acceptance': False, 'release_acceptance': False,
        'controller_sha': identity['controller_sha'], 'app_source': SOURCE, 'run_id': env['GITHUB_RUN_ID'],
        'original_product_result': 'NOT RUN', 'sampler_budget_seconds_per_hook': SNAPSHOT_SECONDS,
        'observer_overhead_may_change_timing': True, 'additional_input_actions': 0,
        'additional_http_endpoints': 0, 'additional_uiautomation_connections': 0, 'input_trace': 'NOT SELECTED',
        'records': observer.records}
    try:
        observe_product(product, harness, observer)
        report['original_product_result'] = 'PASS'
    except Exception:
        report['original_product_result'] = 'FAIL'
        raise
    finally:
        after = harness.read()
        report['post_failure_skip_geometry'] = post_failure_geometry(after)
        collected = sum(row.get('status') == 'COLLECTED_WITH_FIELD_AVAILABILITY' for row in observer.records)
        report['sampler_status'] = ('OBSERVED_WITH_FIELD_AVAILABILITY' if collected == len(observer.records) == 2
            else 'PARTIAL' if collected else 'UNAVAILABLE')
        report['protected_baseline_unchanged'] = all(after.get(key) == before.get(key) for key in gates)
        try:
            destination = root / 'artifacts/private-android-skip-delivery'
            destination.mkdir(mode=0o700, exist_ok=False)
            new_file(destination / 'observation.json', (json.dumps(report, sort_keys=True, indent=2) + '\n').encode())
            report['artifact_retention'] = 'WRITTEN'
        except Exception:
            report['artifact_retention'] = 'UNAVAILABLE'
        print('KEEPER_ANDROID_SKIP_DELIVERY ' + json.dumps(report, sort_keys=True), flush=True)
        require(report['protected_baseline_unchanged'])


def staged_r52(env):
    path = Path(env['RUNNER_TEMP']) / 'keeper-r52-retained-controller/files/r52_retained_admission.py'
    require(digest(regular(path)) == env.get('KEEPER_R52_ADAPTER_SHA256'))
    spec = importlib.util.spec_from_file_location('skip_combined_r52_admission', path)
    adapter = importlib.util.module_from_spec(spec)
    exec(compile(regular(path), str(path), 'exec'), adapter.__dict__)
    root, state, manifest, _ = adapter.staged(env)
    return adapter, root, state, manifest


def originals(root, manifest):
    """Read the fixed manifest set from ff Git, including explicit absence."""
    names = [row['path'] for row in manifest['files']] + ['.github/native/r52_retained_manifest.json']
    require(len(names) <= 33 and len(set(names)) == len(names) and all(
        re.fullmatch(r'\.github/native/r52_[A-Za-z0-9_]+\.(?:py|js|cjs|yaml|json)', name) for name in names))
    result = {}
    for name in names:
        try:
            raw = git(root, 'show', 'HEAD:' + name)
            require(len(raw) <= 2 * 1024 * 1024 and regular(root / name, 2 * 1024 * 1024) == raw)
        except subprocess.CalledProcessError:
            require(not (root / name).exists() and not (root / name).is_symlink())
            raw = None
        result[name] = raw
    return result


def restore_r52(root, state, manifest, baseline):
    """Only replace original or exact staged overlay bytes; never broad checkout."""
    expected = {row['path']: regular(state / 'files' / Path(row['path']).name, 2 * 1024 * 1024)
                for row in manifest['files']}
    expected['.github/native/r52_retained_manifest.json'] = regular(state / 'manifest.json', 2 * 1024 * 1024)
    require(set(expected) == set(baseline))
    # Validate the entire bounded set before restoring any member.
    for name, original in baseline.items():
        path = root / name
        if not path.exists():
            require(original is None and not path.is_symlink())
        else:
            current = regular(path, 2 * 1024 * 1024)
            require(current == original or current == expected[name])
    for name, original in baseline.items():
        path = root / name
        if original is None:
            if path.exists():
                path.unlink()
        elif regular(path, 2 * 1024 * 1024) != original:
            temporary = path.with_name(path.name + '.skip-restore')
            new_file(temporary, original)
            os.replace(temporary, path)
    require(git(root, 'diff', '--exit-code', 'HEAD', '--', '.github/native') == b'')


def r52_phases(adapter, harness, env, report):
    """Independent results, with cleanup proof required before another phase."""
    root, state, manifest, _ = adapter.staged(env)
    baseline = originals(root, manifest)
    installed = False
    safe = False
    try:
        adapter.install(harness, env)
        installed = True
        safe = True
        report['r52_install'] = 'PASS'
        for phase, filename, field in [('tls', 'r52_tls_native.py', 'r52_tls_native'),
            ('realm109', 'r52_realm109_native.py', 'r52_realm109_native')]:
            if not safe:
                report[phase] = {'status': 'NOT RUN', 'reason': 'PREVIOUS_HOST_CLEANUP_UNVERIFIED'}
                continue
            outcome = {'status': 'FAIL', 'entrypoint_returned': False, 'cleanup': 'UNKNOWN'}
            report[phase] = outcome
            outcome['metro_port_preflight'] = wait_for_metro()
            if outcome['metro_port_preflight']['status'] != 'AVAILABLE':
                outcome.update(status='NOT RUN', reason='METRO_BIND_UNAVAILABLE_AFTER_BOUNDED_WAIT')
                safe = False
                continue
            try:
                adapter.Admission(harness, dict(env))
                driver = adapter.load_module(root / '.github/native' / filename, 'skip_retained_' + phase)
                driver.run_retained(harness)
                outcome['entrypoint_returned'] = True
            except Exception:
                # Raw driver exception text may include private runtime output.
                pass
            data = harness.read().get(field)
            if type(data) is dict:
                outcome['metadata_status'] = data.get('status') if data.get('status') in ('PASS', 'FAIL', 'NOT RUN') else 'UNKNOWN'
                outcome['cleanup'] = data.get('cleanup') if data.get('cleanup') in ('PASS', 'FAIL') else 'UNKNOWN'
                cases = data.get('cases')
                if type(cases) is list and len(cases) <= 64:
                    outcome['reported_case_count'] = len(cases)
                    outcome['all_reported_cases_passed'] = bool(cases) and all(
                        type(row) is dict and row.get('status') == 'PASS' for row in cases)
                rpc = data.get('rpc')
                if type(rpc) is dict and type(rpc.get('cases')) is list and len(rpc['cases']) <= 64:
                    outcome['rpc_status'] = rpc.get('status') if rpc.get('status') in ('PASS', 'FAIL', 'NOT RUN') else 'UNKNOWN'
                    outcome['reported_rpc_case_count'] = len(rpc['cases'])
            outcome['status'] = 'PASS' if outcome['entrypoint_returned'] and outcome.get('metadata_status') == 'PASS' else 'FAIL'
            safe = outcome['cleanup'] == 'PASS'
    except Exception:
        report['r52_install'] = 'FAIL' if not installed else report.get('r52_install', 'FAIL')
        safe = False
    finally:
        try:
            restore_r52(root, state, manifest, baseline)
            report['r52_overlay_restoration'] = 'PASS'
        except Exception:
            report['r52_overlay_restoration'] = 'FAIL'
            safe = False
    report['host_cleanup_verified_before_product'] = safe
    return safe


def wait_for_metro():
    """Keep the frozen drivers' exact plain-bind criterion, outside UI budgets."""
    started = time.monotonic()
    while time.monotonic() - started <= METRO_WAIT_SECONDS:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            try:
                listener.bind(('127.0.0.1', 8081))
            except OSError:
                pass
            else:
                return {'status': 'AVAILABLE', 'wait_ms': round((time.monotonic() - started) * 1000, 3),
                        'frozen_plain_bind_criterion_preserved': True}
        time.sleep(0.25)
    return {'status': 'UNAVAILABLE', 'wait_ms': round((time.monotonic() - started) * 1000, 3),
            'frozen_plain_bind_criterion_preserved': True}


def suite(env):
    root, _, identity = admitted(env)
    harness = pinned(root, 'hosted_native', HOSTED_SHA)
    adapter, admitted_root, _, _ = staged_r52(env)
    require(root == admitted_root and harness.read().get('smoke') == 'PASS')
    protected = adapter.protected(harness.read())
    report = {'schema': 1, 'scope': 'ONE_RETAINED_FF_ANDROID_R52_AND_OBSERVED_PRODUCT_DIAGNOSTIC_NOT_ACCEPTANCE',
        'controller_sha': identity['controller_sha'], 'app_source': SOURCE, 'run_id': env['GITHUB_RUN_ID'],
        'native_acceptance': False, 'release_acceptance': False,
        'tls': {'status': 'NOT RUN'}, 'realm109': {'status': 'NOT RUN'}, 'product': {'status': 'NOT RUN'}}
    try:
        if r52_phases(adapter, harness, env, report):
            try:
                run(env)
                report['product'] = {'status': 'PASS'}
            except Exception:
                report['product'] = {'status': 'FAIL'}
        else:
            report['product'] = {'status': 'NOT RUN', 'reason': 'R52_HOST_OR_SOURCE_CLEANUP_UNVERIFIED'}
    except Exception:
        report['pipeline_admission_or_observation'] = 'FAIL'
        report['product'] = {'status': 'NOT RUN', 'reason': 'R52_ADMISSION_OR_RESTORATION_UNVERIFIED'}
    finally:
        report['protected_baseline_unchanged'] = adapter.protected(harness.read()) == protected
        destination = root / 'artifacts/private-android-skip-delivery'
        if not destination.exists():
            destination.mkdir(mode=0o700)
        directory(destination)
        new_file(destination / 'suite.json', (json.dumps(report, sort_keys=True, indent=2) + '\n').encode())
        print('KEEPER_ANDROID_RETAINED_DIAGNOSTIC_SUITE ' + json.dumps(report, sort_keys=True), flush=True)
    require(report['protected_baseline_unchanged'] and report.get('r52_install') == 'PASS' and
        report.get('r52_overlay_restoration') == 'PASS' and
        all(report[phase]['status'] == 'PASS' for phase in ('tls', 'realm109', 'product')))


if __name__ == '__main__':
    require(len(sys.argv) == 2 and sys.argv[1] in ('stage', 'run', 'suite', 'provision-history'))
    {'stage': stage, 'run': run, 'suite': suite, 'provision-history': provision_history}[sys.argv[1]](os.environ)
