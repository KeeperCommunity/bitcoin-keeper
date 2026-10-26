# Actual native notification after each committed local operation

This private test-only slice closes the specific missing native event assertion
in the six non-Delete happy-path cases, all PARTIAL in the original map. The
Delete case is already FULL and is not duplicated. Exact IDs and original
obligations are in `r5-native-event-obligations.json`.

Every case completes genuine initial enrollment/readback, then captures the
actual Realm listener's event boundary. The real originating local receipt must
commit and emit a later native notification. The original real signed CAS must
commit once with its original full tuple, and complete signed readback must
match the whole committed image. Updated success, current verification, native
records/account and all original verified/nonpending assertions remain.

A host notification is actual encrypted Realm N-API evidence; it is separate
from Android/iOS application UI or full platform acceptance. Production code,
protocol, crypto, dependencies, app versions and counters are unchanged. The
separate parent fixes two inherited completed-state assertions; its affected
11+43 regression and six body-binding additions receive separate evidence.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedNativeEventGrid.proof.cjs
```

Require exactly six actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks confer no runtime pass. Historical public2 PASS /293 FAIL remains
unchanged; other remaining source obligations are separate.
