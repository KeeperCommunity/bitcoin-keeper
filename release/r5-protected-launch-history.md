# R5 signed-v3 launch/history producer proof

This additive package executes the unchanged `applyUpgradeSequence`,
`updateVersionHistoryWorker` and `observeCurrentVersionHistory` declarations
with genuine encrypted native Realm, production Redux Persist and origin
middleware, real pinned authority/AES dependencies, authenticated loopback HTTP
and the reviewed transactional protected-backup backend. It changes no product
source, migration gate, app version, build counter, dependency, runner or original
proof. Estimated implementation delta: 7–11k code/test tokens, two additive files.

The existing installation remains **2.6.4 / build 627**, derived from released R4
source `1d8a86a7462d935cbd0e28b857934b5718c152fc`. Work-package labels 5.1/5.2 do
not assign app versions. A dormant account starts with disposable `2.6.3` input
metadata; only the actual launch producer advances it to the installed version.
The login source uses selected KeeperApp metadata before a persisted Redux
fallback; this package invokes its actual launch producer with the same scoped
arguments, rather than simulating the whole PIN/login/native UI worker.

The `1.0.5` input is a **fresh current-schema logical fixture**, deliberately
inside still-supported source migration gates. It is not an authentic historical
disk, schema migration, or proof that every historical key type migrates. Its
public-only COLDCARD signer cannot exercise mobile private-key derivation or
server-policy migration. Those provider operations fail loudly if unexpectedly
reached. Every final version/history update, label/health staging, Realm commit,
backup receipt, encrypted payload and verification result comes from production
source. Initial old-version seeding is never used as a replacement for that
producer.

## Nine-case coverage map

All cases live in `tests/recovery/protectedLaunchHistory.proof.cjs`.

| Case | Actual producer and evidence | Historical obligation / boundary |
| --- | --- | --- |
| 1 | `applyUpgradeSequence` advances dormant `2.6.3` Realm metadata, history and actual persisted Redux to existing `2.6.4`; one real signed CAS and complete readback; `observeCurrentVersionHistory` refuses an unupgraded account and then preserves the genuine upgrade row across repeated observations | Adds the reachable R4-derived producer witness and truthful current history. No invented R5 version or upgrade date |
| 2 | Dispatch the shipped history action through actual origin middleware after genuine baseline invalidation; `updateVersionHistoryWorker` commits local history/version with no original intent, zero HTTP and backup pending | Current history-worker local-first/no-original-base equivalent; does not assert cloud acknowledgement |
| 3 | Existing `1.0.5` gates stage label, health and version changes in one actual Realm transaction before any HTTP mutation; app/live/archive/label fanout carries only its own ACK tuples, complete image matches, consumed receipt cannot replay | Original whole-upgrade success and consumed-receipt obligations combined; old source gates remain intact |
| 4 | A read-only in-transaction probe positively observes the staged label/health edits and old version immediately before the unchanged invalid version write; genuine native Realm validation failure and rolls back all earlier staged migration effects; no queue, HTTP, history or Redux upgrade | Original late transaction rollback obligation; no mocked commit result |
| 5 | An actual A→B→A account switch invalidates the originating session before launch; no local upgrade, queue or HTTP | Original stale initial origin obligation; current account-session identity is real |
| 6 | Bound arrival at an actual completed signed snapshot response after local A commit, select B, then release/drain the worker in `finally` before teardown; producer withholds stale Redux/topic/cloud completion, preserves local A and leaves B untouched | Current-path asynchronous account switch; covers the original paused-session invariant without duplicating cold persistence races |
| 7 | After real ACK1, a genuine competing signed peer CAS makes fanout member2 return actual HTTP409; no rebase, remaining fanout, retry or consumed-receipt replay; all local migrations survive | Original partial fanout conflict obligation, with real server CAS rather than injected successful/rejected write results |
| 8 | Real launch mutation commits but its ACK is lost; local upgrade survives, even matching independent signed readback cannot confer acknowledgement, and consumed receipt cannot replay | Original uncertain ACK obligation; no invented success |
| 9 | Four genuine fanout writes commit; corrupt only the actual final snapshot's version metadata response; producer stays pending and cannot claim Verified or replay the consumed receipt | Original final metadata mismatch obligation; backend retains its real committed metadata |

This is a semantic port of the original nine upgrade obligations plus current
launch/history behavior. It does not retire, skip, rewrite or reclassify the
original `automaticUpgradeProducer.integration.cjs` cases. The original 295-case
current-protocol attempt remains **2 PASS / 293 FAIL** at its original source.
The source census remains a census, not a release checklist or app-defect count:
current audit maps 243 residual callers after the separately completed 32 queue/
bootstrap, 9 label and 11 wallet/vault obligations. This package does not convert
those historic counts into passes or claim mechanical 295-test parity.

## Adjacent evidence remains separately attributed

- `protectedUpgrade7066.proof.cjs` proves explicit protected opt-in/recheck/delete
  for an upgraded disposable account, including lost enrollment reply and retained
  older data. It manually assigns fixture versions and does not invoke the launch
  producer; that proof remains unchanged and distinct.
- Completed private Cloud controls #171/#173 provide native recovery/account
  admission and host fixture receipts. Their UI/history/old-disk stages are
  explicitly synthetic or NOT RUN; they do not supply this launch producer proof.
- D2 account admission/UI work, the cold persistence package and native #7107
  evidence retain their own source, scope, run and acceptance boundaries.
- Host byte storage and Firebase topic recording are explicit boundary adapters.
  Real Redux Persist serializes/rehydrates/flushes its own bytes. Firebase performs
  no provider operation. Original complete unspendable wallet/vault builders and
  public descriptor metadata are input adapters, never successful-write mocks.

## Exact-source execution

Use reviewed Node **22.23.3**, Yarn **1.22.22**, frozen app/backend dependency
installs and reviewed patches, genuine Realm N-API, and reviewed backend
`29597b27eeeb299205bf7d0555db0a90c38cc4be`. The disposable credential-free loopback
Mongo replica on port 27038 must be writable and support real transactions.
Set only the admitted checkout and disposable Mongo inputs:

```sh
node --require ./scripts/run-protected-upgrade-regression.cjs \
  --test tests/recovery/protectedLaunchHistory.proof.cjs
```

The unchanged CommonJS preload admits the current reviewed backend instead of the older historical
runner pin. Do not weaken checks, alter original runners, share caches with active
producer work, or fabricate Realm/native availability. Only this new file needs
execution in the separately bounded private control. That control must verify
exact app/backend/control source, both additive file hashes and the aggregate
additive-only app delta before/after installation and execution. Its finite branch
exemption must prevent unrequested provider analysis. Its unique run/attempt-owned
Mongo container requires a matching ownership label before cleanup. The R5 owner
reviews that control before it is pushed.

## Preparation and acceptance state

- Node22 syntax and whitespace: PASS during preparation.
- Original protected-runner source/admission guard tests: PASS, 3 tests under
  actual Node22.23.3; no guard, runner or original test changed.
- First genuine hosted execution at app `1952adc87b622eb4c0b6ba6c60a2112fb004bc22`:
  **FAIL**, 9 cases, 2 PASS / 6 FAIL / 1 cancelled / 0 skipped / 0 todo. All three
  source fences, genuine Realm installation and owned writable-replica startup/
  cleanup passed. The new proof incorrectly queried Version History through the
  generic `id` helper although that schema's primary key is `version`; its HTTP
  observation assertion also threw into admission, causing the timeout. The
  failed raw receipt remains preserved, with no native or new-source pass transfer.
- This correction reads the real Realm primary key and records observation errors
  for assertion after the actual worker drains, without throwing into HTTP
  admission. It changes no product behavior or successful result. Genuine nine-case
  execution of the corrected source is **NOT RUN**, pending fresh exact-source
  review and bounded hosted execution. Local Realm remains unavailable
  (`MODULE_NOT_FOUND`).
- iOS, Android, real devices, original historical disks, native login/PIN UI,
  mobile private-key derivation and server-policy provider calls: **NOT RUN** by
  this host package. No acceptance from another SHA is transferred.

The draft PR handoff must record the final app SHA, actual local checks and any
later genuine hosted run. Passing this host proof is neither native acceptance,
backend deployment approval, release readiness nor authorization to merge,
promote, sign, upload, distribute, deploy or publish.
