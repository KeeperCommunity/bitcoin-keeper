# Native local-operation proof boundaries

This private test-only slice ports original legacy195,196 and202, all previously
UNCOVERED. Original data, transaction/caller timing and assertions are mapped in
`r5-local-proof-obligations.json`. The earlier cloned-origin baseline case194
remains in the separate reviewed receipt43 family.

A real encrypted native Realm transaction first stages a Tag; while the write
is uncommitted it must expose no intent and cannot begin another local operation.
Deliberate rollback must remove that actual staged record. A caller true passed
to completion cannot substitute for the managed-commit identity.

A second case commits the original wallet mutation inside the final transaction,
then dispatches the selected-account switch before callback return. Both staged
mutation and actual selected-session transition must be witnessed; production
must roll back the complete transaction. A third case copies a genuine operation
and proves the counterfeit never enters its callback or produces an intent.

All original assertions remain. Every case also requires zero HTTP before full
unchanged native image/account comparison and a real signed remote read proving
the existing complete protected image is unchanged. The selected-account-switch
case reads the original namespace with its explicit valid mnemonic; that cannot
grant proof or alter the newly selected UI account. No database, cryptography,
caller proof or backend response is mocked, and no production behavior changes.

On the existing fixed private genuine host with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedLocalProofGuards.proof.cjs
```

Require exactly three actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks grant no runtime pass. Historical public2 PASS /293 FAIL remains
unchanged; app/KDF/protocol/dependencies, versions and counters are unchanged.
