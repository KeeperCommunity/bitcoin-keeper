"""Private normal-retained path: prove the actual required install, not listapps.

No install, launch, retry or timeout change is performed here. The existing
harness performs its single bounded install and its normal verifier performs
the full installed-byte/signature checks before this receipt can become PASS.
"""
import hashlib
import re

UUID = r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}'
FIELD = 'normal_retained_install_readiness'
SCOPE = 'FIRST_REQUIRED_INSTALL_ON_OWNED_BOOT_NOT_APP_LAUNCH_OR_UI_ACCEPTANCE'


def require(value):
    if not value: raise RuntimeError('NORMAL_RETAINED_ACTUAL_INSTALL_PROOF_REJECTED')


def receipt(index, row):
    return {'command_index': index, **{key: row[key] for key in
        ('label', 'exit_code', 'duration_seconds', 'timeout_seconds') if key in row}}


class ActualInstallReadiness:
    def __init__(self, native, verify, suite):
        require(suite in ('startup', 'keychain', 'probe', 'features', 'product'))
        self.native, self.original_verify, self.suite = native, verify, suite
        self.index = self.device = self.boot_index = None

    def wait(self, device):
        require(self.index is None and type(device) is str and re.fullmatch(UUID, device))
        data = self.native.read(); rows = data.get('commands', [])
        require(len(rows) >= 3)
        name = 'Keeper-product-ui-disposable' if self.suite == 'product' else 'Keeper-disposable-ci'
        expected = [
            ['xcrun', 'simctl', 'create', name, 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
             'com.apple.CoreSimulator.SimRuntime.iOS-18-5'],
            ['xcrun', 'simctl', 'boot', device], ['xcrun', 'simctl', 'bootstatus', device, '-b']]
        labels = (('Create task-owned product UI simulator', 'Boot product UI simulator', 'Wait for product UI simulator')
                  if self.suite == 'product' else
                  ('Create fresh iPhone 16 iOS 18.5 simulator', 'Boot disposable simulator', 'Wait for simulator boot'))
        for row, command, label in zip(rows[-3:], expected, labels):
            require(row.get('command') == command and row.get('label') == label and
                    type(row.get('exit_code')) is int and row['exit_code'] == 0)
        require(rows[-1].get('timeout_seconds') == 240)
        self.device, self.boot_index = device, len(rows)
        record = {'suite': self.suite, 'scope': SCOPE, 'criterion': 'ACTUAL_BOUNDED_INSTALL_AND_VERIFIED_IDENTITY',
            'result': 'PENDING_ACTUAL_INSTALL', 'app_service_readiness': 'NOT_ESTABLISHED',
            'listapps': 'NOT_RUN_PRIVATE_ACTUAL_INSTALL_PATH', 'native_acceptance': False,
            'device_sha256': hashlib.sha256(device.encode()).hexdigest(), 'install_timeout_seconds': 120,
            'boot_proof': [receipt(index, row) for index, row in enumerate(rows[-3:], len(rows) - 2)]}
        records = data.setdefault(FIELD, []); self.index = len(records); records.append(record)
        self.native.save(data)
        return record

    def entry(self, data):
        require(self.index is not None)
        row = data[FIELD][self.index]
        require(row.get('scope') == SCOPE and row.get('suite') == self.suite and
            row.get('device_sha256') == hashlib.sha256(self.device.encode()).hexdigest())
        return row

    def install(self, data):
        rows = [(index, row) for index, row in enumerate(data.get('commands', []), 1)
                if index > self.boot_index and row.get('command', [])[:3] == ['xcrun', 'simctl', 'install']]
        require(len(rows) == 1)
        index, row = rows[0]
        app = self.native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
        require(row.get('command') == ['xcrun', 'simctl', 'install', self.device, str(app)] and
                row.get('timeout_seconds') == 120 and row.get('label') ==
                ('Install exact product UI app' if self.suite == 'product' else 'Install unsigned development app'))
        return receipt(index, row)

    def verify(self, device):
        require(device == self.device)
        data = self.native.read(); entry = self.entry(data)
        pending = entry['result'] == 'PENDING_ACTUAL_INSTALL'
        if pending:
            installed = self.install(data)
            require(type(installed.get('exit_code')) is int and installed['exit_code'] == 0)
        else:
            # Existing product samples intentionally reinstall between samples;
            # this receipt proves only the first required install on this boot.
            require(entry['result'] == 'PASS')
        result = self.original_verify(device)
        data = self.native.read(); entry = self.entry(data)
        require(data.get('installed_artifact_verified') is True and data.get('installed_normal_signature_verified') is True)
        if pending:
            entry.update(result='PASS', app_service_readiness='ACTUAL_INSTALL_AND_FULL_IDENTITY_VERIFIED',
                         install_command=installed, installed_bytes='PASS', normal_signature='PASS')
            self.native.save(data)
        return result

    def finish(self):
        if self.index is None: return
        data = self.native.read(); entry = self.entry(data)
        if entry['result'] == 'PENDING_ACTUAL_INSTALL':
            entry.update(result='FAIL', app_service_readiness='NOT_ESTABLISHED',
                         failure_stage='ACTUAL_INSTALL_OR_INSTALLED_IDENTITY_NOT_VERIFIED')
            try: entry['install_command'] = self.install(data)
            except RuntimeError: entry['install_command'] = None
            self.native.save(data)
