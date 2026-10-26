# Peer changes before automatic operation admission

This private test-only slice ports both original remote-only and key-conflict
triggers across all seven operations: 14 legacy rows, one PARTIAL and13
UNCOVERED. Existing peer-after-snapshot409 cases exercise a different schedule:
the original pre-admission cases require zero own mutation attempts.

An actual original receipt first commits its local operation. A separate real
signed peer CAS then updates the existing remote copy BEFORE that old receipt
is admitted: either a new server-only wallet or a changed xpub at the retained
wallet ID. The peer must genuinely commit and return its valid next tuple.
The unchanged production queue reads the actual advanced signed snapshot and
rejects its old authority without sending any own mutation, enrollment or repair.
No fake snapshot, conflict response or backend seed is used.

All original pending/completed assertions and exact surviving peer xpub remain.
The complete committed local image, account, consent and independent recovery
records survive. Actual signed readback must match the whole original remote
baseline plus precisely the peer change. Even an old Delete cannot erase that
newer copy. Replaying the old receipt sends zero further HTTP and cannot borrow
the peer tuple. Original real helper declarations are reused without importing
or registering unrelated tests; no product behavior or protocol is changed.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedPeerAdmissionGrid.proof.cjs
```

Require exactly14 actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks confer no genuine runtime pass. Historical public2 PASS /
293 FAIL remains unchanged. Other operation/fault obligations remain separate.
