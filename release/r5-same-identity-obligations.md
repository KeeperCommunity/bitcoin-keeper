# Same persisted ID with changed recovery identity

This private test-only slice ports original legacy cases189–193: signer xpub,
remembered private key and network, plus vault key and spending policy changes.
All five were UNCOVERED in the original source map. The exact original IDs,
assertions and source contracts are recorded in `r5-same-identity-obligations.json`.

Each case uses actual disposable extended keys, an encrypted native Realm,
production local commit/queue, real encryption, signed HTTP and the reviewed
transactional backend. The signer baseline's valid original xpub is installed
before genuine explicit enrollment; remote state is never replaced with a seed
helper. The real committed replacement keeps the exact original persisted ID.
Production image comparison must independently recognize immutable identity
conflict, and submitted ciphertext must decrypt to the actual local replacement.

The old map's prose says zero HTTP, but the original callbacks assert zero
attempted writes, not zero snapshot reads. Current production projection occurs
after a signed baseline read. These cases require that genuine successful read,
zero mutations/enrollment/repair, all original pending/completed assertions,
complete local/account retention and unchanged full remote recovery content.
They then require zero further HTTP when the invalidated original receipt is
replayed. This corrects map prose against the original assertions; it waives no
legacy assertion and changes no production contract.

On the existing fixed private genuine host with Node 22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedSameIdentityGrid.proof.cjs
```

Require exactly five actual PASS and zero FAIL, SKIP, CANCEL or TODO, bound to the
exact app/tree, bundle, backend/controller and raw-source fences. Source review
and offline checks are separate from genuine execution. No production, KDF,
protocol, dependency, version or counter changes are included. Historical public
2 PASS / 293 FAIL is unchanged; fanout/interleave and other fault grids remain
separate obligations.
