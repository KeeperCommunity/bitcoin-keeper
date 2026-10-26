# Actual raw-operation CAS409 across all seven operations

This private test-only slice ports the original409 case for all seven core
operations. Exact original IDs and prior dispositions are recorded in
`r5-conflict-obligations.json`; generic two-wallet or fanout conflicts do not
replace these raw operation/caller and read-only reconciliation obligations.

After actual original snapshot capture, but before its reply is delivered, an
independently signed real peer CAS updates the actual backend. The old operation
then sends only its original namespace/revision/generation/authEpoch and receives
a genuine409 from the unchanged router. A fabricated status cannot satisfy this:
actual valid committed peer ACK and distinct own committedfalse409 are required.

The two wire mutations are explicitly one independent peer and one own attempt;
only that own attempt counts toward the original one-attempt obligation. Full
committed local image/account survives. Real signed remote readback must match
the entire original baseline plus the exact peer recovery record. Every original
pending/completed, Delete consent, read-only reconciliation and non-regressing
local revision assertion remains. Old receipt replay sends zero HTTP before and
after fresh read-only inspection and cannot borrow the newer peer tuple.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedConflictGrid.proof.cjs
```

Require exactly seven actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks confer no runtime pass. No production/KDF/protocol/fixture or
dependency changes; historical public2 PASS /293 FAIL remains unchanged.
