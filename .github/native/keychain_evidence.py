"""Bounded owned simulator Keychain receipt; never read a Keychain payload."""
import importlib.util
import json
from pathlib import Path
import re

SCOPE = 'ACTUAL_RN_KEYCHAIN_DISPOSABLE_SERVICE_ONLY'
OPTION_PROFILE = 'PRODUCTION_WHEN_UNLOCKED_SERVICE_ONLY_NO_EXPLICIT_ACCESS_GROUP_OR_STORAGE'
OPERATIONS = ('READ_EXISTING', 'WRITE_INITIAL', 'VERIFY_INITIAL', 'UPDATE_PERSISTED',
              'VERIFY_UPDATED', 'DELETE_PERSISTED', 'VERIFY_DELETED', 'DEVELOPMENT_GATE')
CODES = ('WRITE_RETURNED_FALSE', 'READBACK_MISMATCH', 'UNEXPECTED_SERVICE_ITEM',
         'DELETE_RETURNED_FALSE', 'DELETE_READBACK_MISMATCH', 'MISSING_ENTITLEMENT',
         'NATIVE_EXCEPTION', 'DEVELOPMENT_ONLY')

def project(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate receipt field.')
            result[key] = value
        return result
    if type(raw) is not str or len(raw.encode()) > 4096:
        raise ValueError('Keychain receipt absent or oversized.')
    value = json.loads(raw, object_pairs_hook=unique)
    if (type(value) is not dict or set(value) != {'schema', 'scope', 'option_profile', 'stage', 'operation',
            'failure_code', 'native_code', 'native_acceptance'} or type(value['schema']) is not int or
            value['schema'] != 1 or value['scope'] != SCOPE or value['option_profile'] != OPTION_PROFILE or
            value['native_acceptance'] is not False or
            value['stage'] not in ('seeded', 'updated', 'pass', 'failed') or
            value['operation'] not in OPERATIONS):
        raise ValueError('Invalid fixed Keychain receipt.')
    if value['stage'] == 'failed':
        if (value['failure_code'] not in CODES or
                (value['failure_code'] == 'MISSING_ENTITLEMENT' and
                 (type(value['native_code']) is not int or value['native_code'] != -34018)) or
                (value['failure_code'] != 'MISSING_ENTITLEMENT' and value['native_code'] is not None)):
            raise ValueError('Invalid fixed Keychain failure.')
    elif (value['failure_code'] is not None or value['native_code'] is not None or
            value['operation'] != {'seeded': 'VERIFY_INITIAL', 'updated': 'VERIFY_UPDATED',
                                  'pass': 'VERIFY_DELETED'}[value['stage']]):
        raise ValueError('Inconsistent Keychain completion.')
    return value

def collect(h, device):
    if h.PLATFORM != 'IOS' or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device):
        raise ValueError('Owned iOS simulator required.')
    container = Path(h.command(['xcrun', 'simctl', 'get_app_container', device, h.APP_IDS['IOS'], 'data'],
        'Locate bounded disposable Keychain receipt', timeout=15, capture=True, error_details=False))
    base = Path.home() / 'Library/Developer/CoreSimulator/Devices' / device / 'data/Containers/Data/Application'
    if (not container.is_absolute() or container.parent.resolve() != base.resolve() or
            not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', container.name) or
            container.is_symlink()):
        raise ValueError('Owned disposable container required.')
    spec = importlib.util.spec_from_file_location('keychain_private_reader', Path(__file__).with_name('r5_feature_failure.py'))
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    return project(reader.read_private(container / 'Documents', 'keeper-ci-keychain-evidence.json', 4096))
