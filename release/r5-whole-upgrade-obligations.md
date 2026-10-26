# Whole 1.0.5 upgrade obligation completion

This private, additive test slice fills all four missing whole-upgrade
combinations from `automaticUpgradeProducer.integration.cjs`: case3 (no original
authority), case5 (asynchronous pre-commit label read followed by A→B→A), case7
(whole migration plus lost ACK), and case9 (a second actual producer invocation
with its already-consumed original baseline). The
[source map](r5-whole-upgrade-obligations.json) retains every original case ID;
all nine existing protected launch/history test bodies remain unchanged.

The new tests invoke production `applyUpgradeSequence` with real grouped writes
to encrypted native Realm, actual consent/account-session observers, actual
cryptography and signed-v3 HTTP/transactional Relay. The asynchronous test wraps
only completion of the actual UTXO collection read; it supplies no fake database,
receipt, authority or response. Lost-ACK injection destroys the response after a
real committed CAS. The second-producer case invokes the whole producer again,
rather than using direct queue replay as a substitute. Each failure path checks
the complete relevant local migration group and zero additional cloud effects.
The omitted-origin case deliberately retains a valid current global verified
baseline; it must reject borrowing that later authority rather than passing only
because every baseline was cleared. The shared pending helper now independently rejects a stale
`backupRepairCompletedByAppId:true` flag as well as verified/current predicates,
including retained conflict/final-readback cases; no prior assertion is removed.

These are old-version inputs in the existing current-schema disposable fixture.
They do not establish authentic historic disk/schema migration, phone UI, native
TLS, physical signer coverage or release acceptance. No runtime pass is claimed
from syntax/source checks or a missing native binding.

After reviewing and pinning the selected app/tree/bundle and unchanged private
backend in the existing private proof controller, use its existing frozen app
dependencies, genuine Realm N-API binding and owned credential-free loopback
Mongo replica. From the selected app checkout, with the already checked backend
checkout in `KEEPER_PROTECTED_RELAY_CHECKOUT`, the exact host command is:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedLaunchHistory.proof.cjs
```

Use supported Node22.23.4+ and the existing controller's
`BACKUP_TEST_MONGO_URL=mongodb://127.0.0.1:27038`. Preserve the runner's exact295
backend admission and raw source fences before/after dependency setup and tests.
The complete file has13 cases (nine retained, four new); a runtime acceptance
receipt requires13 actual passes, zero failures/cancellations/skips/todos and
original exact-source evidence. This does not authorize another CI run here.

Retiring the obsolete public-v2 matrix requires independent obligation mapping
and genuine equivalent v3 execution for **every** remaining family, including
operation/fault grids, receipt ownership/reopen schedules, real HTTP aborts and
identity/fanout/interleave controls. This four-case addition or the separate
20 signer/USDT passes cannot discharge those families. Preserve the old
2PASS/293FAIL record. Only after complete mapping and fresh source-bound proof
should the maintainers replace the public-v2 pairing with the equivalent v3
requirement; do not rename, skip or relabel its failures as passes.
