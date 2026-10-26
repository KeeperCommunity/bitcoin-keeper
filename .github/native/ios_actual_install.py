"""Readiness from the existing single bounded install and full identity checks.

Boot status is prerequisite only. This observer issues no command, retry,
launch or UI input and never assigns a UI/native acceptance result.
"""
import hashlib
import re

FIELD = 'ios_actual_install_readiness'
SCOPE = 'FIRST_REQUIRED_INSTALL_ON_OWNED_BOOT_NOT_APP_LAUNCH_OR_UI_ACCEPTANCE'
UUID = r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}'
BOOT = {
    'startup': ('Keeper-disposable-ci', 'Create fresh iPhone 16 iOS 18.5 simulator',
                'Boot disposable simulator', 'Wait for simulator boot', 'Install Xcode-signed development app'),
    'product': ('Keeper-product-ui-disposable', 'Create task-owned product UI simulator',
                'Boot product UI simulator', 'Wait for product UI simulator', 'Install exact product UI app'),
    'tls': ('Keeper-r52-tls-disposable', 'Create owned TLS simulator',
            'Boot owned TLS simulator', 'Wait for owned TLS simulator', 'Install exact app for native TLS bridge'),
    'realm109': ('Keeper-realm109-disposable', 'Create owned Realm109 simulator',
                'Boot owned Realm109 simulator', 'Wait for owned Realm109 simulator', 'Install exact app for native Realm migration'),
}
for _suite in ('keychain', 'probe', 'features'):
    BOOT[_suite] = BOOT['startup']


def require(value):
    if not value:
        raise RuntimeError('ACTUAL_INSTALL_READINESS_PROOF_REJECTED')


def receipt(index, row):
    return {'command_index': index, **{key: row[key] for key in
        ('label', 'exit_code', 'duration_seconds', 'timeout_seconds') if key in row}}


class ActualInstallReadiness:
    def __init__(self, native, suite=None):
        require(suite is None or suite in BOOT)
        self.native, self.suite = native, suite
        self.device = self.index = self.boot_index = None

    def wait(self, device):
        require(self.index is None and type(device) is str and re.fullmatch(UUID, device))
        data = self.native.read(); rows = data.get('commands', [])
        require(len(rows) >= 3)
        suite = self.suite or ('product' if rows[-3].get('label') == 'Create task-owned product UI simulator' else 'startup')
        name, *labels, self.install_label = BOOT[suite]
        expected = [
            ['xcrun', 'simctl', 'create', name, 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
             'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
            ['xcrun', 'simctl', 'boot', device], ['xcrun', 'simctl', 'bootstatus', device, '-b']]
        for row, command, label in zip(rows[-3:], expected, labels):
            require(row.get('command') == command and row.get('label') == label and
                    type(row.get('exit_code')) is int and row['exit_code'] == 0)
        require(rows[-1].get('timeout_seconds') == 240)
        self.device, self.boot_index = device, len(rows)
        entry = {'scope': SCOPE, 'suite': suite, 'result': 'PENDING_ACTUAL_INSTALL',
            'criterion': 'ACTUAL_BOUNDED_INSTALL_AND_VERIFIED_IDENTITY',
            'app_service_readiness': 'NOT_ESTABLISHED', 'listapps': 'NOT_RUN_ACTUAL_INSTALL_PATH',
            'native_acceptance': False, 'device_sha256': hashlib.sha256(device.encode()).hexdigest(),
            'install_timeout_seconds': 120,
            'boot_proof': [receipt(index, row) for index, row in enumerate(rows[-3:], len(rows) - 2)]}
        entries = data.setdefault(FIELD, []); self.index = len(entries); entries.append(entry)
        self.native.save(data)
        return entry

    def entry(self, data):
        require(self.index is not None)
        entry = data[FIELD][self.index]
        require(entry.get('scope') == SCOPE and
                entry.get('device_sha256') == hashlib.sha256(self.device.encode()).hexdigest())
        return entry

    def install(self, data):
        rows = [(index, row) for index, row in enumerate(data.get('commands', []), 1)
            if index > self.boot_index and row.get('command', [])[:3] == ['xcrun', 'simctl', 'install']]
        require(len(rows) == 1)
        index, row = rows[0]
        app = self.native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        require(row.get('command') == ['xcrun', 'simctl', 'install', self.device, str(app)] and
            row.get('timeout_seconds') == 120 and row.get('label') == self.install_label)
        require(type(row.get('exit_code')) is int and row['exit_code'] == 0)
        return receipt(index, row)

    def verified(self, device):
        require(device == self.device)
        data = self.native.read(); entry = self.entry(data)
        require(data.get('installed_artifact_verified') is True and
                data.get('installed_normal_signature_verified') is True)
        if entry['result'] == 'PASS':
            return  # Product samples verify every reinstall independently.
        require(entry['result'] == 'PENDING_ACTUAL_INSTALL')
        installed = self.install(data)
        entry.update(result='PASS', app_service_readiness='ACTUAL_INSTALL_AND_FULL_IDENTITY_VERIFIED',
            install_command=installed, installed_bytes='PASS', normal_signature='PASS')
        self.native.save(data)

    def finish(self):
        if self.index is None:
            return
        data = self.native.read(); entry = self.entry(data)
        if entry['result'] == 'PENDING_ACTUAL_INSTALL':
            entry.update(result='FAIL', app_service_readiness='NOT_ESTABLISHED',
                         failure_stage='ACTUAL_INSTALL_OR_INSTALLED_IDENTITY_NOT_VERIFIED')
            self.native.save(data)
