"""Observe the existing Maestro command while its owned XCTest process lives."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
import importlib.util
from pathlib import Path
import re
import sys
from types import SimpleNamespace

POLL_SECONDS = 60
LABEL = 'Assert startup and disposable passcode transition'


def load(native):
    spec = importlib.util.spec_from_file_location('retained_driver_diagnosis',
        Path(__file__).with_name('driver_diagnosis.py'))
    value = importlib.util.module_from_spec(spec)
    previous = sys.modules.get('hosted_native')
    sys.modules['hosted_native'] = native
    try:
        spec.loader.exec_module(value)
    finally:
        if previous is None:
            sys.modules.pop('hosted_native', None)
        else:
            sys.modules['hosted_native'] = previous
    value.native = SimpleNamespace(PRIVATE=native.PRIVATE)
    return value


def observe(native, original, args, label, **kwargs):
    if label != LABEL:
        return original(args, label, **kwargs)
    device = args[args.index('--device') + 1]
    if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', device):
        raise ValueError('Expected owned driver UUID.')
    helper = load(native)
    metadata = native.read()
    metadata['commands'].append({'label': label})
    facts = {'schema': 1, 'native_acceptance': False,
             'scope': 'LIVE_OWNED_DRIVER_DIAGNOSTIC_NOT_APP_OR_UI_ACCEPTANCE'}
    primary_failed = False
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(original, args, label, **kwargs)
            try:
                return future.result(timeout=POLL_SECONDS)
            except FutureTimeoutError:
                before = not future.done()
                try:
                    facts['observation'] = helper.collect(device, metadata, command_label=label,
                        log_directory=native.PRIVATE / 'maestro-output')
                except Exception as error:
                    facts['observation'] = {'collection_errors': [
                        {'stage': 'live_driver', 'error_type': helper.safe_error(error)}]}
                facts.update(command_running_before_collection=before,
                             command_running_after_collection=not future.done())
                return future.result()
    except Exception:
        primary_failed = True
        raise
    finally:
        # Read only after command() finishes its own metadata writes.
        try:
            data = native.read()
            data['retained_live_driver_observation'] = facts
            native.save(data)
        except Exception:
            if not primary_failed:
                raise RuntimeError('Live driver receipt unavailable.') from None
