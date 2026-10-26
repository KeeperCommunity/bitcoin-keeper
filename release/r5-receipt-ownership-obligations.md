# Genuine protected receipt ownership and lifetime obligations

This private test-only slice ports all seven core operations across six receipt
admission and lifetime failures, plus the original cloned-origin control: 43
cases. The exact source map is `r5-receipt-ownership-obligations.json`; it joins
43 original legacy IDs (five previously PARTIAL, 38 UNCOVERED). Existing legacy
failures are unchanged. Source review is distinct from actual execution.

## Real boundaries and original schedules

The unchanged native fixture, production observers/sagas/queue and original data
builders perform enrollment, encryption, signed HTTP and remote readback. Every
case first positively verifies its full initial protected image against the
actual backend. No database, encryption, receipt or success is mocked.

For each operation, the cases preserve the original later local Tags write,
queued account A to B to A, real failed Tags transaction, copied branded intent,
missing whole receipt and close/reopen AFTER commit schedules. Queued cases wait
behind an entered production session barrier before invalidation. Realm reopen
must close the old native object and open a different native object. The missing
whole receipt case still has an available original global baseline; it cannot
be replaced by a receipt whose intent is absent. The failed transaction must
really execute, throw, roll back the entire collection and yield no intent.

The extra cloned-origin case spreads the actual captured baseline, performs the
real local wallet mutation and asserts committed true with intent undefined.
All legacy pending/completed assertions remain. Each case also proves zero HTTP
for the rejection and replay of the original receipt, complete local image and
account retention, saved consent including Delete, and an unchanged signed
remote snapshot whose decrypted full image still matches the initial copy.
Explicit Delete preparation performs its own genuine read before the no-HTTP
measurement; the rejected Delete itself cannot read, mutate or opt out.

## Host execution

Use the existing private, fixed-source genuine proof route with reviewed backend
`29597b27eeeb299205bf7d0555db0a90c38cc4be`, Node 22.23.4, frozen dependencies,
the real Realm N-API binding and owned credential-free MongoDB on port 27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedReceiptOwnershipGrid.proof.cjs
```

Require exactly 43 actual PASS and zero FAIL, SKIP, CANCEL or TODO, with the exact
source/tree, bundle, backend/controller identities and raw-source fences. Offline
syntax/source-map validation is not product execution. This slice changes no
production behavior, KDF, backend protocol, dependency, app version or counter.
Other HTTP abort, identity, fanout/interleave and non-ACK fault obligations stay
open. The historical public matrix remains 2 PASS / 293 FAIL.
