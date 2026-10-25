"""Owned process/bundle switching; setup and host contracts supply no native PASS."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
import urllib.request

PHASE_CONFIGS = {'product': None, 'arm': 'credential_metro.cjs', 'restore': 'credential_metro.cjs',
    **{name: name + '_metro.cjs' for name in (
        'history_seed_stale', 'history_verify_stale_first', 'history_verify_stale_repeat',
        'history_seed_empty', 'history_verify_empty_first', 'history_verify_empty_repeat',
        'history_restore', 'history_verify_restored')}}
FLOW_PHASES = {
    'product_key_acceptance.yaml': ('product',),
    'credential_fixture.yaml': ('arm', 'restore'),
    'product_credential_blocked.yaml': ('product',),
    'product_credential_recovered.yaml': ('product',),
    'history_fixture.yaml': tuple(p for p in PHASE_CONFIGS if p.startswith('history_')),
    'history_product.yaml': ('product',),
    'product_vault_acceptance.yaml': ('product',),
}


class OwnedMetro:
    def __init__(self, h, private):
        self.h, self.private = h, Path(private)
        self.process, self.phase = None, None
        self.owned, self.reaped, self.events = [], set(), []
        self.app_stopped = False

    @staticmethod
    def port_occupied():
        try:
            with socket.create_connection(('127.0.0.1', 8081), timeout=0.2):
                return True
        except OSError:
            return False

    def stop(self, process):
        if process not in self.owned:
            raise RuntimeError('PRODUCT_METRO_UNOWNED_PROCESS')
        if process in self.reaped:
            return
        # Every handle originates below with start_new_session=True. No PID or
        # process handle can be supplied by a device selector or external caller.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=10)
        # The leader can exit before an inherited worker closes its listener.
        # This is the same task-owned session, never a discovered foreign PID.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.reaped.add(process)

    def close(self):
        failed = False
        for process in reversed(self.owned):
            try:
                self.stop(process)
            except Exception:
                failed = True
        if failed:
            raise RuntimeError('PRODUCT_METRO_OWNED_CLEANUP_FAILED')

    def start(self, phase, initial=False):
        if phase not in PHASE_CONFIGS:
            raise RuntimeError('PRODUCT_METRO_PHASE_REJECTED')
        if initial:
            if self.owned or phase != 'product':
                raise RuntimeError('PRODUCT_METRO_INITIAL_PRODUCT_REQUIRED')
        elif not self.app_stopped:
            raise RuntimeError('PRODUCT_METRO_STOPPED_JUNIT_REQUIRED')
        config = PHASE_CONFIGS[phase]
        if config:
            path = self.h.ROOT / '.github/native' / config
            if path.is_symlink() or not path.is_file():
                raise RuntimeError('PRODUCT_METRO_FIXED_CONFIG_REQUIRED')
        if self.process:
            self.stop(self.process)
        # Wait briefly for the just-terminated owned listener to close. Never
        # adopt or kill a foreign listener or delete a cache to free this port.
        for _ in range(20 if self.process else 1):
            if not self.port_occupied():
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('PRODUCT_METRO_PORT_OCCUPIED')
        environment = os.environ.copy()
        environment.pop('KEEPER_CREDENTIAL_FIXTURE_PHASE', None)
        if phase in ('arm', 'restore'):
            environment['KEEPER_CREDENTIAL_FIXTURE_PHASE'] = phase
        args = ['node', 'node_modules/react-native/cli.js', 'start', '--port', '8081']
        if config:
            args += ['--config', str(path)]
        event = {'phase': phase, 'status': 'FAIL', 'scope': 'BUNDLE_SETUP_ONLY'}
        self.events.append(event)
        with (self.private / ('metro-%02d.log' % len(self.events))).open('wb') as log:
            process = subprocess.Popen(args, cwd=self.h.ROOT, env=environment, stdout=log,
                stderr=subprocess.STDOUT, start_new_session=True)
            # Retain the latest handle before any readiness/warmup can fail.
            self.process = process
            self.owned.append(process)
        self.phase, self.app_stopped = phase, False
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError('PRODUCT_METRO_CHILD_EXITED')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8081/status', timeout=2) as reply:
                    if reply.status == 200 and reply.read(128).strip() == b'packager-status:running':
                        break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('PRODUCT_METRO_NOT_READY')
        self.h.warm_metro_bundle('startup' if initial else 'product_ui_' + phase)
        if process.poll() is not None:
            raise RuntimeError('PRODUCT_METRO_CHILD_EXITED_AFTER_WARMUP')
        event['status'] = 'PASS'

    def switch(self, phase):
        self.start(phase)

    def ensure_product(self):
        if self.phase != 'product':
            self.switch('product')
        if self.process is None or self.process.poll() is not None:
            raise RuntimeError('PRODUCT_METRO_ORDINARY_APP_REQUIRED')


class StoppedFlowHarness:
    """Only reviewed stopApp flows with matching successful JUnit grant a switch.

    The coordinator creates this after discovering its disposable device. This
    is not a standalone device/account entrypoint or an OS process inspection.
    """
    def __init__(self, h, data, device, private, metro, reverse_ports):
        self.h, self.data, self.device, self.private = h, data, device, Path(private).resolve()
        self.metro, self.reverse_ports, self.pending = metro, reverse_ports, None

    def __getattr__(self, name):
        return getattr(self.h, name)

    def command(self, args, label, **kwargs):
        reverse = ['adb', '-s', self.device, 'reverse', 'tcp:8767', 'tcp:8767']
        if args == reverse and self.h.PLATFORM == 'ANDROID':
            value = self.h.command(args, label, **kwargs)
            self.reverse_ports.add('8767')
            return value
        self.metro.app_stopped, self.pending = False, None
        name = Path(args[-1]).name
        if (args[:4] != [self.data['maestro']['binary'], '--device', self.device, 'test'] or
                args[-1] != '.github/native/' + name or name not in FLOW_PHASES or
                self.metro.phase not in FLOW_PHASES[name] or kwargs.get('error_details') is not False or
                'APP_ID=' + self.h.APP_IDS[self.h.PLATFORM] not in args):
            raise RuntimeError('PRODUCT_METRO_REVIEWED_FLOW_REQUIRED')
        flow = self.h.ROOT / args[-1]
        if flow.is_symlink() or not flow.read_text().rstrip().endswith('- stopApp'):
            raise RuntimeError('PRODUCT_METRO_FINAL_STOP_APP_REQUIRED')
        paths = []
        for flag in ('--output', '--debug-output', '--test-output-dir'):
            if args.count(flag) != 1:
                raise RuntimeError('PRODUCT_METRO_PRIVATE_OUTPUT_REQUIRED')
            path = Path(args[args.index(flag) + 1])
            if path.is_symlink() or not path.resolve().is_relative_to(self.private):
                raise RuntimeError('PRODUCT_METRO_PRIVATE_OUTPUT_REQUIRED')
            paths.append(path)
        if args.count('--format') != 1 or args[args.index('--format') + 1] != 'junit':
            raise RuntimeError('PRODUCT_METRO_JUNIT_FORMAT_REQUIRED')
        report = paths[0]
        report.unlink(missing_ok=True)
        value = self.h.command(args, label, **kwargs)
        if report.is_symlink() or not report.resolve().is_relative_to(self.private):
            raise RuntimeError('PRODUCT_METRO_PRIVATE_JUNIT_REQUIRED')
        self.pending = report.resolve()
        return value

    def successful_junit(self, report):
        if (Path(report).is_symlink() or not Path(report).resolve().is_relative_to(self.private) or
                self.pending != Path(report).resolve()):
            raise RuntimeError('PRODUCT_METRO_MATCHING_JUNIT_REQUIRED')
        self.pending = None
        value = self.h.successful_junit(report)
        self.metro.app_stopped = True
        return value
