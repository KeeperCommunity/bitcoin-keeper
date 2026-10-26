"""Fresh exact-source, normal Xcode ad-hoc simulator builds. No release signing.

The private retained/fresh controllers keep their own selectors and historical
receipts. This controller admits any current source SHA and reads its version;
it never borrows a retained build's compilation or runtime result.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess

PROFILE = 'normal-xcode'
SCOPE = 'FRESH_CURRENT_SOURCE_NORMAL_XCODE_SIMULATOR'


def module(name):
    spec = importlib.util.spec_from_file_location('normal_xcode_' + name, Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def require(value):
    if not value:
        raise RuntimeError('NORMAL_XCODE_SIMULATOR_PROOF_REJECTED')


def selected(native):
    return native.read().get('build_execution_scope') == SCOPE


def require_source(native, prepared=True):
    """Raw tracked bytes, not Git status/index flags; only reviewed overlays."""
    reader = module('android_apk_checkpoint')
    data = native.read()
    source = os.environ.get('KEEPER_SOURCE_SHA', '')
    require(native.PLATFORM == 'IOS' and re.fullmatch('[a-f0-9]{40}', source) and
            data.get('source_sha') == source and
            reader.git(native.ROOT, 'rev-parse', 'HEAD').decode().strip() == source)
    overlays = data.get('configuration_overlays', []) if prepared else []
    if prepared:
        require(len(overlays) == 4 and {row['path'] for row in overlays} == module('ios_fresh_runtime').OVERLAYS)
    hashes = {row['path']: row['sha256'] for row in overlays}
    tracked = set()
    base = reader.directory(native.ROOT)
    try:
        for path, digest in hashes.items():
            require(reader.read_file(base, path, 1024 * 1024)['sha256'] == digest)
        for entry in reader.git(native.ROOT, 'ls-tree', '-rz', 'HEAD').split(b'\0'):
            if not entry:
                continue
            header, raw_path = entry.split(b'\t', 1)
            mode, kind, blob = header.split()
            path = raw_path.decode()
            tracked.add(path)
            require(kind == b'blob' and mode in (b'100644', b'100755'))
            if path in hashes:
                continue
            observed = reader.read_file(base, path, 64 * 1024 * 1024, minimum=0)
            require(observed['executable'] == (mode == b'100755'))
            if prepared and path == 'package.json':
                original = reader.git(native.ROOT, 'cat-file', 'blob', blob.decode())
                overlay = data.get('nodeify_overlay', {})
                require(overlay.get('path') == path and
                    overlay.get('allowed_fields') == ['browser', 'react-native', 'browserify'] and
                    overlay.get('before_sha256') == hashlib.sha256(original).hexdigest() and
                    overlay.get('after_sha256') == observed['sha256'])
                before, after = reader.json_document(original), reader.json_document(observed['bytes'])
                for name in overlay['allowed_fields']:
                    before.pop(name, None); after.pop(name, None)
                require(before == after)
            else:
                require(observed['git_blob'] == blob.decode())
    finally:
        os.close(base)
    # Metro/Python can load overrides hidden by either ignore mechanism. Query
    # both classes with NUL delimiters, including every generated harness input.
    # Ignored native dependency/build outputs stay outside the lookup scan.
    lookup = ('src', 'patches', '.github/native', 'App.*', 'AndroidFontFix.*',
              'index.*', 'shim.*', 'metro.config.*', 'babel.config.*',
              '.babelrc*', 'react-native.config.*')
    names = set()
    for ignored, paths in (((), (*lookup, 'ios', 'android')), (('--ignored',), lookup)):
        extra = reader.git(native.ROOT, 'ls-files', '--others', '--exclude-standard', *ignored, '-z', '--', *paths)
        names.update(raw.decode('utf-8') for raw in extra.split(b'\0') if raw)
    # Force-adding an override removes it from --others without making it part
    # of the requested HEAD. Index-only paths therefore remain unknown inputs.
    indexed = reader.git(native.ROOT, 'ls-files', '--cached', '-z', '--', *lookup, 'ios', 'android')
    names.update(raw.decode('utf-8') for raw in indexed.split(b'\0') if raw and raw.decode('utf-8') not in tracked)
    generated = module('ios_generated_source').allowed(native, names)
    # Bytecode is executable input, even when its filename/timestamp/size look
    # ordinary. No native cache is part of the requested source manifest.
    require(names <= generated)
    return source


def verify_signature(native, app=None):
    """Inspect actual signed XML, linker XML/DER, platform and strict chain."""
    app = app or native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
    require(app.resolve(strict=True) == app.absolute() and not app.is_symlink())
    # Normal simulator frameworks can contain internal links; critical identity
    # files cannot be aliases, and no provisioning profile is accepted anywhere.
    before = native._bundle_inventory(app)
    for path in (app / 'Info.plist', app / 'hexa_keeper_dev'):
        require(stat.S_ISREG(path.lstat().st_mode) and not path.is_symlink())
    require(not any(path.name == 'embedded.mobileprovision' for path in app.rglob('*')))
    result = module('ios_fresh_runtime').verify_xcode_signature(native, app)
    for image in result['process_macho']:
        for part in image['slices']:
            identifier = part['application_identifier']
            require(identifier is None or identifier == native.APP_IDS['IOS'] or
                    identifier.endswith('.' + native.APP_IDS['IOS']))
            require(all(row['sdk'] == '18.5.0' for row in part['build_versions']))
    require(native._bundle_inventory(app) == before)
    return result


def build(native):
    require(native.PLATFORM == 'IOS' and native.platform.system() == 'Darwin' and native.platform.machine() == 'arm64')
    require(native.read().get('build') == 'NOT RUN')
    require(not os.path.lexists(native.PRIVATE / 'DerivedData'))
    source = require_source(native)
    native.disk_preflight('before_native_build')
    data = native.read()
    data.update(build_execution_scope=SCOPE, current_source_compilation='NOT RUN',
                compiled_app_source_sha=source)
    data.setdefault('toolchain', {}).update(ios_simulator_architecture='arm64',
                                          ios_simulator_build_profile=PROFILE)
    native.save(data)
    compiled = False
    try:
        native.command(module('ios_launch_debug').xcode_simulator_build_command(native),
            'Build Xcode-signed development simulator app', timeout=2400)
        compiled = True
        data = native.read(); data['current_source_compilation'] = 'PASS'; native.save(data)
        require_source(native)
        signature = verify_signature(native)
        identity = native.artifact_identity()
        data = native.read()
        data['toolchain']['ios_simulator_signature'] = signature
        data.update(build='PASS', built_artifact=identity,
            compiled_source_tree=subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'],
                cwd=native.ROOT, text=True).strip(),
            compiled_app_version=json.loads((native.ROOT / 'package.json').read_text())['version'])
        native.save(data)
    except Exception:
        data = native.read()
        data.update(build='FAIL', current_source_compilation='PASS' if compiled else 'FAIL')
        try:
            index = len(data['commands'])
            if index and data['commands'][-1].get('label') == 'Build Xcode-signed development simulator app':
                data['ios_build_progress'] = native.ios_build_progress(native.PRIVATE / ('command-%03d.log' % index))
        except Exception:
            pass
        native.save(data)
        raise


def require_runtime(native):
    data = native.read()
    require(native.PLATFORM == 'IOS' and native.platform.system() == 'Darwin' and native.platform.machine() == 'arm64' and
        selected(native) and data.get('build') == 'PASS' and
        data.get('current_source_compilation') == 'PASS' and
        data.get('compiled_app_source_sha') == data.get('source_sha') and
        data.get('toolchain', {}).get('ios_simulator_build_profile') == PROFILE)
    require_source(native)
    require(native.artifact_identity() == data.get('built_artifact') and
            verify_signature(native) == data['toolchain']['ios_simulator_signature'])


def keychain_binding(native):
    data = native.read()
    require(data.get('installed_artifact_verified') is True and
            data.get('installed_normal_signature_verified') is True)
    return {'scope': 'CURRENT_SOURCE_NATIVE_PHASE', **{key: data[key] for key in
        ('source_sha', 'workflow_sha', 'workflow_ref', 'run_id', 'run_attempt',
         'platform', 'built_artifact', 'installed_artifact')}}


def verify_installed(native, device):
    """Called after the harness's full installed-tree/executable comparison."""
    require_source(native)
    data = native.read()
    require(data.get('installed_artifact_verified') is True)
    built = native.PRIVATE / 'DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app'
    installed = native.owned_ios_bundle_path(native.command(
        ['xcrun', 'simctl', 'get_app_container', device, native.APP_IDS['IOS'], 'app'],
        'Locate normal-Xcode installed signature', capture=True, error_details=False), device, built)
    require(verify_signature(native, installed) == data['toolchain']['ios_simulator_signature'] and
            native._bundle_inventory(installed) == native._bundle_inventory(built) and
            native.artifact_identity() == data['built_artifact'])
    data = native.read(); data['installed_normal_signature_verified'] = True; native.save(data)
