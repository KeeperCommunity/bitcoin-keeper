# Wrong-key ciphertext in the actual final readback

This private test-only slice ports all seven original wrong-key final-ciphertext
cases: legacy24,48,72,96,120,144,168, all previously UNCOVERED. Exact original
names, source identities and protected registrations are in the adjacent JSON map.

Each genuine original operation first commits its native change and receives its
actual successful signed-v3 CAS acknowledgement. The acknowledgement must satisfy
every positive field and original tuple. Only the second real snapshot response,
after that ACK, replaces or inserts retained-wallet ciphertext encrypted with the
original independently different public disposable fixture key. Positive controls
require real AES encryption/decryption under that different key, the actual final
fault, one committed mutation, and the exact initial-read/mutation/final-read order.

The response keeps its original revision. For non-Delete cases the complete raw
signed-v3 projection hash rejects changed ciphertext before AES decryption. For
Delete, inserting a wallet violates the empty tombstone contract even earlier.
These are the truthful stronger protocol boundaries; this test neither forges a
matching revision nor claims execution of the client's wrong-key AES branch.

The original result stays unconfirmed with every pending/nonverified/completed
flag and consent retained. A received ACK can legitimately leave updated=true.
Complete committed native data/account survives. Independent signed readback
proves the actual complete remote effect or tombstone was never changed by the
fault. The consumed original receipt sends zero HTTP before and after that read.

On the existing fixed private genuine host, with Node22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedWrongKeyReadbackGrid.proof.cjs
```

Require exactly seven actual PASS and no FAIL/SKIP/CANCEL/TODO with exact
app/tree/controller/bundle/backend bindings and raw-source fences. Offline checks
and source review grant no genuine runtime/native/store acceptance. No product,
protocol, KDF, fixture, dependency, version or counter changes are included.
Historical public2 PASS /293 FAIL remains unchanged; other gaps remain separate.
