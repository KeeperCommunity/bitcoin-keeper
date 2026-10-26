# Original Delete caller and consent-completion boundaries

This private test-only slice ports original203–206, all PARTIAL in the baseline
map. The exact caller and completion checkpoints are preserved in
`r5-direct-delete-obligations.json`; related worker/subscriber cases remain intact.

The actual Delete worker now has a consent-ON case that explicitly asserts its
success flag, opt-out and retained native wallet together. A separate original
direct public Relay.deleteBackup wrapper begins a fresh explicit deletion after
saved consent is already OFF. Both must positively acknowledge one genuine CAS.

The third case holds the real direct wrapper's committed ACK while actual OFF
then ON choices advance the original consent epoch; old completion cannot opt
out or claim verification. The fourth reenters immediately BEFORE the actual
final setAutomaticCloudBackup(false) dispatch, rather than at the later worker
success subscriber. It positively witnesses the original enabled state and the
newer real choice epoch; their assertions are outside the callback error path.
The held writing is always released/drained before cleanup.

Every original pending/completed/consent assertion and complete committed native
image/account remains. Real signed read proves the exact selected deletion
tombstone with empty records and suppressed fallback; no enrollment/recreate or
old direct-receipt replay occurs. No product, protocol, KDF, fixture, dependency,
version or counter changes are included.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedDirectDeleteObligations.proof.cjs
```

Require exactly four actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller/raw-source fences and owned cleanup.
Source review and offline checks grant no runtime pass. Historical public
2 PASS /293 FAIL remains unchanged; remaining source obligations are separate.
