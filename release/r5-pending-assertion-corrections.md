# Correct two inherited FULL-map assertion omissions

Fresh source reconciliation identified an omitted original completed-state
assertion in the common pending helpers used by legacy17 and180. Their baseline
map said FULL, so these exceptions are counted separately from newly mapped
PARTIAL/UNCOVERED rows. The exact existing protected IDs and case names are in
`r5-pending-assertion-corrections.json`.

Add just one independent backupRepairCompletedByAppId !== true assertion to each
existing helper in protectedWalletVault and protectedWriteRealmRelay. Every old
callback, native/HTTP schedule and assertion remains byte-identical. Removing
only that added line restores each entire file's original47a inventory hash.
Production, fixtures, protocol, cryptography, dependencies and versions do not
change. The old map and old2 PASS /293 FAIL evidence remain intact.

Because these common helpers apply to existing tests, rerun both entire affected
proof files on this exact successor through the existing genuine host. Their
unchanged static expansion is11 +43 =54 tests. This regression is justified by
the new shared assertions; it is not54 new historical obligations or a claim to
close the remaining matrix gaps. The separately added six body-binding cases
may run as a third step on the same exact source, for60 total if not frozen yet.

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedWalletVault.proof.cjs
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedWriteRealmRelay.proof.cjs
```

Require actual11 +43 PASS, no FAIL/SKIP/CANCEL/TODO and all exact source/tree,
bundle/backend/controller/raw-source fences and owned Mongo cleanup. No product
execution or current native/store/complete public295 acceptance is claimed by
source review or offline checks.
