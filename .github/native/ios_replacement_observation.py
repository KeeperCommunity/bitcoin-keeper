"""Read-only post-failure bundle observations; never repair or acceptance.

Maestro clearState replaces the first installed instance. Inspect the remaining
owned instance after failure without a launch, retry or metadata promotion.
"""
import importlib.util
from pathlib import Path
import plistlib
import re
import subprocess
import tempfile

APP = 'io.hexawallet.hexakeeper.dev'
LIMIT = 1024 * 1024
UUID = r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}'


def query(private, args):
    """Keep output in an unnamed private file; retain no command or raw text."""
    try:
        with tempfile.TemporaryFile(dir=private) as output:
            process = subprocess.run(args, stdout=output, stderr=subprocess.STDOUT,
                                     timeout=20, check=False)
            output.seek(0)
            payload = output.read(LIMIT + 1)
            if len(payload) > LIMIT:
                return 'OVERSIZED', None
            if process.returncode != 0:
                return 'NONZERO_EXIT', None
            return 'EXIT_ZERO', payload
    except subprocess.TimeoutExpired:
        return 'TIMEOUT', None
    except OSError:
        return 'UNAVAILABLE', None


def entitlement_state(payload):
    """Compare types and complete effective values to the fixed signing policy."""
    try:
        if type(payload) is not bytes or len(payload) > LIMIT:
            return 'UNKNOWN'
        begin, end = payload.find(b'<?xml'), payload.find(b'</plist>')
        if (begin < 0 or end < begin or payload.count(b'<?xml') != 1 or
                payload.count(b'</plist>') != 1):
            return 'UNKNOWN'
        effective = plistlib.loads(payload[begin:end + len(b'</plist>')])
        spec = importlib.util.spec_from_file_location('observed_simulator_policy',
            Path(__file__).with_name('simulator_signing.py'))
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        if type(effective) is not dict:
            return 'UNKNOWN'
        return ('MATCH' if plistlib.dumps(effective, sort_keys=True) ==
                plistlib.dumps(policy.ENTITLEMENTS, sort_keys=True) else 'MISMATCH')
    except Exception:
        return 'UNKNOWN'


def unknown(stage='NOT_RUN'):
    return {'schema': 1, 'state': 'UNKNOWN', 'stage': stage,
            'bytes': 'UNKNOWN', 'signature': 'UNKNOWN', 'identity': 'UNKNOWN',
            'entitlements': 'UNKNOWN', 'built_internal_links': None,
            'installed_internal_links': None, 'queries': {},
            'scope': 'POST_FAILURE_CURRENT_INSTANCE_NOT_LAUNCH_CAUSE_OR_ACCEPTANCE'}


def collect(native, device):
    result = unknown()
    stage = 'DEVICE_POLICY'
    try:
        if (native.PLATFORM != 'IOS' or type(device) is not str or
                not re.fullmatch(UUID, device)):
            return unknown(stage)
        stage = 'BUILT_ARTIFACT_STABILITY'
        expected = native.read()['built_artifact']
        if native.artifact_identity() != expected:
            return unknown(stage)
        built = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        stage = 'BUILT_INVENTORY'
        original, executable = native._bundle_inventory(built)
        get_container = ['xcrun', 'simctl', 'get_app_container', device, APP, 'app']
        stage = 'INSTALLED_CONTAINER_QUERY'
        status, payload = query(native.PRIVATE, get_container)
        result['queries']['container'] = status
        if status != 'EXIT_ZERO':
            return {**result, 'stage': stage}
        stage = 'INSTALLED_CONTAINER_POLICY'
        installed = native.owned_ios_bundle_path(payload.decode('utf-8').strip(), device, built)
        stage = 'INSTALLED_INVENTORY'
        actual, actual_executable = native._bundle_inventory(installed)
        result['bytes'] = 'MATCH' if (original, executable) == (actual, actual_executable) else 'MISMATCH'
        result['built_internal_links'] = sum(value[0] == 'link' for value in original.values())
        result['installed_internal_links'] = sum(value[0] == 'link' for value in actual.values())
        stage = 'SIGNATURE_QUERIES'
        status, _ = query(native.PRIVATE, ['codesign', '--verify', '--deep', '--strict', str(installed)])
        result['queries']['signature'] = status
        result['signature'] = ('VERIFIED' if status == 'EXIT_ZERO' else
                               'NOT_VERIFIED' if status == 'NONZERO_EXIT' else 'UNKNOWN')
        status, payload = query(native.PRIVATE, ['codesign', '--display', '--verbose=4', str(installed)])
        result['queries']['identity'] = status
        if status == 'EXIT_ZERO':
            lines = payload.decode('utf-8').splitlines()
            result['identity'] = ('ADHOC' if 'Signature=adhoc' in lines and
                not any(line.startswith('Authority=') for line in lines) else 'OTHER')
        status, payload = query(native.PRIVATE, ['codesign', '--display', '--entitlements', ':-', str(installed)])
        result['queries']['entitlements'] = status
        if status == 'EXIT_ZERO':
            result['entitlements'] = entitlement_state(payload)
        # All conclusions refer to one unchanged current instance and built input.
        stage = 'FINAL_CONTAINER_QUERY'
        status, payload = query(native.PRIVATE, get_container)
        result['queries']['final_container'] = status
        if status != 'EXIT_ZERO':
            return unknown(stage)
        final = native.owned_ios_bundle_path(payload.decode('utf-8').strip(), device, built)
        stage = 'INSTALLED_STABILITY'
        if final != installed or native._bundle_inventory(final) != (actual, actual_executable):
            return unknown(stage)
        stage = 'BUILT_ARTIFACT_STABILITY'
        if (native._bundle_inventory(built) != (original, executable) or
                native.artifact_identity() != expected):
            return unknown(stage)
        result.update(state='OBSERVED', stage='COMPLETE')
        return result
    except Exception:
        # Unsupported/missing bundles and failed collectors supply no pass and
        # never replace the original startup exception or export its message.
        return unknown(stage)
