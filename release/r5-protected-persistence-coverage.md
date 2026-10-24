# Protected cold persisted consent/proof coverage

This additive seven-case package is based on R5 integration checkpoint
`c8c4e22ffc0137f774e533f167ada81aa673b94a`. It ports the bounded persistence and
display-proof obligations from the historical core matrix to signed v3. Product
source, the retired-wire matrix, shared fixtures, runners, dependency/backend pins
and gates are unchanged. Original 2 PASS / 293 FAIL and earlier exact-source
43+1+3, 32, 9 and 11 results retain their own attribution.

| Case | Genuine boundary / required result |
| --- | --- |
| Canonical BHR saved proof | Actual Redux Persist boot expires stale Verified and interrupted completion flags before subscribers see them; records and per-account consent survive; no HTTP or authority until fresh readback |
| Old root-only saved proof | Legacy consent waits for confirmed canonical absence; stale proof remains invalid; only a fresh later local receipt may write after a real signed check |
| Root-first canonical opt-out | Subscribers never see legacy opt-in while canonical storage is unresolved or opted out; genuine Check Again cannot authorize a later automatic local commit |
| BHR-first canonical opt-out | The opposite real reconciliation order preserves the same no-opt-in/no-write guarantee |
| Failed canonical read | Actual persistStore failure reaches production middleware; unavailable storage is not absence and cannot grant old consent or automatic write authority |
| Raw legacy fallback / durable opt-out | Confirmed absence preserves initialized nested state and sanitized legacy consent; actual persistStore output retains a later opt-out/pending peer; a second actual boot reads that writer's values without re-enabling backup |
| Current status expression | Actual AssistedBackupStatus phase declarations require current proof after A→B→A and a later native recovery mutation; display evaluation never requests backup |

A separate production client creates each case's actual protected namespace via
explicit opt-in, signed enrollment/repair and complete encrypted readback. That
client closes before the cold target starts. The target uses independent module,
store, Realm, consent and proof state; it cannot inherit the seeder's in-memory
authority. Real crypto, native encrypted Realm, production Redux Persist/origin
middleware/observers/queue, signed HTTP and the actual transactional backend remain
in the path. Fresh post-check mutations retain their original namespace/revision/
generation/authEpoch tuple and complete decrypted image comparison. Successful
storage, acknowledgements or comparison results are never fabricated.

The only persistence I/O/read-order boundary is the existing fixture's Promise
adapter for MMKV. Root sagas and rendered UI are not bootstrapped; unchanged
production workers are invoked through the existing host harness. These cases
establish the exercised serializer/reconciler/middleware/observer and write-
authority contracts, not native MMKV durability, an OS process relaunch, Keychain,
rendered UI, physical-device, deployed-backend or release acceptance. The second
boot reads actual host-adapter values emitted by the first writer; it is not a
phone-restart claim.

Before preparation, current private #171 at
`265e9d5c3e0145af5da94c5e28ed2db9d70fc712`, #173 at
`6cecfaa3c7db29cd2b131ab6c523a90f313e6c24` and D2 source
`e0252a4a0d82cabe3355888e981b552f12c8e1fe` were inspected. They cover ordinary
native recovery/account/PIN/cold consent-off/history observations, not injected
canonical-versus-legacy read orders, failed canonical reads or stale serialized
Verified. Their existing source/host results are not native passes and are not
rerun, altered or transferred by this package. No new native job is scheduled.

Run only the new file through the unchanged current-backend admission preload:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs --test \
  tests/recovery/protectedPersistence.proof.cjs
```

Prerequisites remain Node 22.23.3+ within 22.x, frozen app/backend dependencies,
the actual Realm N-API binding, exact separately obtained backend
`29597b27eeeb299205bf7d0555db0a90c38cc4be`, and a credential-free owned keeperQA
transactional loopback replica on port 27038. Missing prerequisites fail; do not
substitute v2 success, weakened integrity checks or production accounts.

Preparation: Node syntax, whitespace and the three existing runtime/Mongo-target/
backend-identity guard controls PASS. Full independent source/control review and
genuine seven-case execution are pending. A separately bounded private control
must pin the exact public source, the two additive paths/hashes and current
backend; it is reviewed before any triggering push. No runtime/native success
is implied by preparation checks. The estimated source/test delta is 5–8k tokens,
one persistence feature, separately reviewable from the broader R5 integration.

This does not redesign consent, credentials or storage and does not implement
other audit suggestions. No merge, shared promotion, secrets, provider operation,
production mutation, signing, distribution, release or personal Mac is required
or authorized by this package.
