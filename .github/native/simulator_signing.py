"""Ad-hoc signing for the owned hosted simulator app, without release identities."""
import hashlib
import plistlib


APP_ID = 'io.hexawallet.hexakeeper.dev'
SIMULATOR_ID = 'KEEPERCI00.' + APP_ID
ENTITLEMENTS = {
    'application-identifier': SIMULATOR_ID,
    'com.apple.developer.team-identifier': 'KEEPERCI00',
    'get-task-allow': True,
    'keychain-access-groups': [SIMULATOR_ID],
}


def sign(native):
    """Sign only simulator output and verify the effective Keychain entitlement."""
    if native.PLATFORM != 'IOS':
        raise ValueError('Simulator signing is iOS-only.')
    state = native.read()
    state.setdefault('toolchain', {})['ios_simulator_signature'] = {
        'verified': False, 'scope': 'ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING'}
    native.save(state)
    app = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
    if app.is_symlink() or not app.is_dir():
        raise ValueError('Expected the owned simulator application.')
    with (app / 'Info.plist').open('rb') as source:
        info = plistlib.load(source)
    if (info.get('CFBundleIdentifier') != APP_ID or
            info.get('CFBundleSupportedPlatforms') != ['iPhoneSimulator']):
        raise ValueError('Only the development simulator application may be ad-hoc signed.')
    # Do not apply application entitlements to embedded frameworks. Sign inner
    # code first, then the app; neither operation uses a keychain identity.
    if (app / 'PlugIns').exists() and any((app / 'PlugIns').iterdir()):
        raise ValueError('Embedded application extensions require a separate reviewed signing plan.')
    embedded = []
    frameworks = app / 'Frameworks'
    if frameworks.is_symlink():
        raise ValueError('Embedded simulator code must remain in the owned bundle.')
    if frameworks.exists():
        for path in frameworks.rglob('*'):
            if path.suffix not in ['.framework', '.dylib']:
                continue
            if (path.is_symlink() or not path.resolve().is_relative_to(app.resolve()) or
                    (path.suffix == '.framework' and not path.is_dir()) or
                    (path.suffix == '.dylib' and not path.is_file())):
                raise ValueError('Unexpected embedded simulator code.')
            embedded.append(path)
    entitlements = native.PRIVATE / 'simulator-debug.entitlements'
    payload = plistlib.dumps(ENTITLEMENTS, sort_keys=True)
    # An exclusive file prevents following an existing private-path alias.
    with entitlements.open('xb') as target:
        target.write(payload)
    entitlements.chmod(0o600)
    try:
        for path in sorted(embedded, key=lambda item: (-len(item.parts), str(item))):
            native.command(['codesign', '--force', '--sign', '-', '--timestamp=none', str(path)],
                           'Ad-hoc sign embedded simulator code', error_details=False)
        native.command(['codesign', '--force', '--sign', '-', '--timestamp=none',
                        '--entitlements', str(entitlements), '--generate-entitlement-der', str(app)],
                       'Ad-hoc sign development simulator app', error_details=False)
        native.command(['codesign', '--verify', '--deep', '--strict', str(app)],
                       'Verify owned simulator code signature', error_details=False)
        observed = native.command(['codesign', '--display', '--entitlements', ':-', str(app)],
                                  'Read effective simulator entitlements', capture=True, error_details=False)
        start, end = observed.find('<?xml'), observed.find('</plist>')
        if start < 0 or end < start:
            raise ValueError('Simulator entitlements were not returned.')
        effective = plistlib.loads(observed[start:end + len('</plist>')].encode())
        if effective != ENTITLEMENTS:
            raise ValueError('Effective simulator entitlements differ from the isolated CI policy.')
        signature = native.command(['codesign', '--display', '--verbose=4', str(app)],
                                   'Verify ad-hoc simulator signing identity', capture=True, error_details=False)
        if 'Signature=adhoc' not in signature.splitlines() or any(
                line.startswith('Authority=') for line in signature.splitlines()):
            raise ValueError('Expected ad-hoc signing without a release identity.')
        state = native.read()
        state.setdefault('toolchain', {})['ios_simulator_signature'] = {
            'verified': True, 'scope': 'ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING',
            'bundle_id': APP_ID, 'entitlements_sha256': hashlib.sha256(payload).hexdigest(),
            'embedded_code_count': len(embedded),
        }
        native.save(state)
    finally:
        entitlements.unlink()
