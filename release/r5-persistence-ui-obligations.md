# Retain original persistence and stale-display assertions

This private test-only slice restores four original assertion obligations:
legacy209,210,212,213. It adds six assertions to the existing seven-case genuine
protectedPersistence suite; it adds no new test registrations or product code.

Both canonical opt-out reconciliation orders must independently retain
seedConfirmed true and backupMethod SEED. The confirmed-absence legacy fallback
must retain backupMethod SEED both in the live reconciled state and in bytes
written by actual nested Redux Persist after the later opt-out.

The actual AssistedBackupStatus phase expression must be tested while Redux's
recorded phase still says verified at both stale checkpoints: after a real
A-to-B-to-A session change and immediately after a later actual native mutation.
Each independent recorded-phase assertion precedes the existing current-proof
false and displayed-phase unverified assertions. Cleared Redux cannot mask a
missing session/native-fingerprint predicate. No fake verification, altered
predicate, observer removal or UI-state substitution is introduced.

Every previous assertion, caller, encrypted Realm operation, actual Redux Persist
boot/read ordering, storage write/readback and signed backend operation remains.
Removing only the six new assertion lines restores the entire original suite
byte-for-byte. Other existing cases and every registration name are retained.

On the existing fixed private genuine host, Node22.23.4/frozen dependencies,
actual Realm N-API/backend29597/owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedPersistence.proof.cjs
```

Require exactly seven actual PASS and no FAIL/SKIP/CANCEL/TODO with exact source,
tree, bundle, controller, backend and raw-source fences. These are seven existing
affected suite regressions covering four original gaps, not seven new legacy
obligations or seven new tests. Current source/provenance hashes must bind this
reviewed successor; old persistence results cannot transfer as fresh execution.

The host Promise storage adapter exercises actual Redux Persist, not a claimed
native MMKV process relaunch. No product, persistence schema, fixture behavior,
protocol, KDF, dependency, version or counter changes are included. Offline/source
checks grant no runtime/native/store acceptance. Historical public2 PASS /293
FAIL remains unchanged; unrelated obligations stay separate.
