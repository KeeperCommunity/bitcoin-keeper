# Bind committed ciphertext and deletion targets to native receipts

This private test-only slice ports the six remaining original body/target
mismatch cases. The existing FULL updateAppImage control is retained unchanged
and is not duplicated. `r5-body-binding-obligations.json` records the exact six
original IDs plus that existing control for the complete seven-operation family.

Every case first genuinely enrolls/verifies its complete original protected copy
and commits the actual native operation. It then changes only the submitted
encrypted signer/vault/label presentation, deletion target, or Delete app ID.
Actual tampered ciphertext must decrypt to the deliberate uncommitted value;
wrong retained targets must really exist. Native committed data is unchanged.

The real queue reads the original successful signed snapshot before projection
and refuses the mismatch without mutation. Wrong-account Delete is rejected
before any HTTP. Every original pending/completed assertion remains, along with
complete local/account/retained recovery and actual full remote preservation.
An explicit old receipt replay sends zero further HTTP and cannot obtain new
authority. No protocol, native Realm, receipt, cryptography or success is mocked.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedBodyBindingGrid.proof.cjs
```

Require exactly six actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks confer no runtime pass; the retained FULL wallet control receives
no new execution credit here. Historical public2 PASS /293 FAIL is unchanged;
production/KDF/protocol/dependencies, versions and counters are unchanged.
