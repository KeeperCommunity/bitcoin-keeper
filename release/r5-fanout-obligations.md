# Original fanout, local interleave and shared registration obligations

This private test-only slice ports legacy169–172 and183: four previously
PARTIAL rows and one UNCOVERED row. The exact source map is
`r5-fanout-obligations.json`. All native commits, queue/callers, encryption,
requests, transactional CAS outcomes and signed readbacks are real.

Three cases preserve all three prepared effects for create/archive vaults,
shared registrations and label import/delete. After own ACK1, a separately
signed actual peer CAS advances the real backend. Own member2 uses only its
own prior ACK tuple and receives genuine409; member3 never sends. The peer is
explicitly distinguished from the two own attempts, and its remote-only record
must survive. Complete local data and the precise first/old/remaining remote
effects are asserted. No conflict status or successful ACK is fabricated.

A fourth case holds the real first committed label ACK while a real later
native Tags transaction commits. The operation must remain unresolved through
that later commit. Releasing ACK1 permits neither member2 nor3. All original
imported local labels plus the later label survive; only the exact first label
and original deletion reach the remote copy. The held request is always drained.

The fifth case uses the actual BHR `buildAutomaticVaultMutation` and
`queueCommittedBackupWorker` against two existing vaults sharing one native
VaultSigner registration list. It retains both original decoded registration
array checks and verifies the full current image and original ACK chain.
Every case also proves zero further HTTP from an explicit old-receipt replay.
That deliberate replay is checked after successful current verification in the
happy case; its rejection does not claim to retain current verification.

On the existing fixed private genuine host with Node 22.23.4, frozen dependencies,
actual Realm N-API, reviewed backend29597 and owned loopback Mongo27038:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedFanoutObligations.proof.cjs
```

Require exactly five actual PASS and zero FAIL, SKIP, CANCEL or TODO with exact
source/tree, bundle, backend/controller and raw-source fences. Source review and
offline checks grant no product runtime pass. Production, KDF, protocol,
dependencies, version and counters are unchanged. Historical public2 PASS /
293 FAIL remains unchanged; other after-send account/UI and fault obligations
are separate.
