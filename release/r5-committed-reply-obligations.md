# Malformed revision and lost real committed replies

This private test-only slice ports original HTTP malformed/lost-reply rows across
all seven operations:14 cases, five PARTIAL and nine UNCOVERED. The original map
identifies malformed revision as distinct from existing malformed generation or
malformed JSON tests. Exact source IDs and obligations are recorded in
`r5-committed-reply-obligations.json`.

Every operation uses genuine enrollment, native committed receipt, production
queue, encryption, signed HTTP and transactional backend. The proxy must capture
the actual selected operation's successful committed ACK, which independently
must satisfy the complete positive production ACK contract. It then changes
only newRevision to an invalid shape, or destroys that actual reply before
delivery. No successful ACK, commit, network error or database is fabricated.

All original pending/completed, uncertain Delete consent, read-only
reconciliation, one-attempt and non-regressing local revision assertions remain.
Full local image/account and retained recovery data survive. Actual signed
readback proves the complete committed remote effect or exact tombstone. The
consumed receipt sends zero HTTP both before and after fresh read-only inspection.
V3's explicit deleted phase is the truthful state after committed Delete; it is
not a substitute for a successfully received Delete acknowledgement.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedCommittedReplyGrid.proof.cjs
```

Require exactly14 actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks confer no product execution. Production/KDF/protocol/dependencies,
versions and counters are unchanged. Historical public2 PASS /293 FAIL remains;
genuine HTTP404/409 and other field/caller obligations are separate.
