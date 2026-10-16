Run these focused checks from the repository root with Node 22.23.3 (or a later
22.x version) after installing the frozen dependencies. The scripts enforce
that Node version; subprocesses use the same executable.

```sh
node --test tests/recovery/protected-authority.test.mjs
node tests/recovery/protected-authority.metro.cjs
node node_modules/eslint/bin/eslint.js src/services/backup/authority.ts src/services/backup/encoding.ts
```

The first command transpiles the actual production authority and encoding
modules to temporary ES modules and loads the installed crypto packages without
algorithm substitutes. Its 13 tests cover standard BIP39/BIP32/HKDF vectors,
the fixed recoverable namespace, original account/seed binding (including
rejection of uppercase stored seed hex), low-S compact JWS interoperability
with native OpenSSL, raw-body binding, disposal and invalid inputs. One child
starts without TextEncoder or TextDecoder and selects the encoder package's
mobile/default exports with a test-only Node resolver hook.

The second command uses the real Metro/Babel configuration and Android module
resolution. It validates the actual index import order and bundles the actual
shim, encoding and authority modules. Three shim native edges are replaced by
throwing traps; native InitializeCore and the full App are not loaded. The
bundle executes in an isolated Node V8 context without either text global,
checks encoder boundaries and the fixed namespace/signature, then compiles
with the repository's Linux or macOS Hermes compiler. The printed output
directory contains the receipt, bundle and bytecode. An optional first argument
sets that directory. Paths affect bundle hashes. Hermes execution, native
startup and native performance are not proved by compilation.

The source-bound Cloud results and dated primary dependency/support/advisory
observations are in [protected-authority-evidence.json](protected-authority-evidence.json).
An empty advisory response is not a security certification. Installed dependency
sizes and this focused debug bundle are not an APK/AAB size estimate.

IOS, ANDROID native and HARDWARE acceptance remain NOT RUN by these commands.
Local must rebuild/install/launch the actual new app on both platforms, verify
Hermes runtime initialization and recoverable signing, then run the scoped
backup/native acceptance handoff. This proof makes no provider or production
request and does not activate hosted backup.
