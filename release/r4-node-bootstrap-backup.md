# R4 managed default-node backup producer

15 October 2026. **NEEDS_LOCAL / NOT RELEASE-READY**. The newest
[PR #7045](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045)
**Codex local handoff** names the exact final SHA and actual check results.

## Failure and preserved controls

Local tested `9a19c6a2a4b4b71d6ffb0d6a5b9776f12a7dbf1d` with paired disposable
Relay `838049e537e07eb646a2a0393eb969fba43d0739`. The strict16KB Android17/API37
APK was `7331408887f5d755b439d0d350a49defbef3fdb6698c4bd1c6c89bb46b98acd0`.
After explicit opt-in and complete Verified readback (one wallet, two signers,
no nodes), simply opening Mobile Wallet details saved two canonical Testnet
nodes. Local revision became1, queued stayed0; fresh Status said Needs Updating.
Remote fingerprint stayed `d34ef089ca58d3f8`, with no nodes. All common recovery
content and metadata matched; only two additive nodes differed. No injected
fault or manual repair preceded this capture.

A first manual Back Up Now safely added only nodes and verified at
`64ab05c5d321d550`. A separate healthy-baseline ordinary rename then passed at
`69bc52bb10af357c`: actual native decrypted full image/metadata matched Realm,
with only `presentationData.name` changed. Cold PIN, MMKV, Realm and fresh
Status also passed. These controls do not pass the original bootstrap order
and are not results for the new source.

The earlier17e0 rename failure and [queue-admission evidence](r4-backup-queue-admission.md)
remain intact; its exact native cause was never uniquely proved. Its explicit
renamed-wallet repair conflict is expected conservative preservation behavior:
name differs, signers/metadata match, and additive nodes are not the discard
trigger. This producer does not change that guard or add a manual override.

## Actual caller and bounded change

`HomeWallet` opens Mobile Wallet details with `autoRefresh:true`. Refresh reaches
`connectToNodeWorker`; its initial/default and one-time fallback additions used
bare Realm helpers. Observers correctly expired verification but did not upload.
The unchanged9a19 actual-caller regression reproduced persisted defaults with
**zero CAS writes**, where one acknowledged exact-set write was required:
**RED0/1, zero skipped**. A prior Mongo-not-primary setup failure is separate.

The new producer retains original account/session/Realm and branded authority
before yielding, appends only missing node IDs in one managed transaction, then
starts the existing `updateAppImageWorker(updateNodes:true)` with its genuine
receipt. Dispatch stamps `CONNECT_TO_NODE`; direct callers propagate original
authority, including its absence. The exact-set payload includes all persisted
recoverable nodes, custom nodes and both networks. Existing IDs/fields survive;
a completed fallback migration does not resurrect a later explicit deletion.
No-op reconnects do not commit/upload. Missing/stale authority preserves local
nodes and remains pending without acquiring a fresh baseline after persistence.

The backup child is detached with `spawn`, retaining immutable receipt/origin;
the existing helper contains backup failures and all proof/CAS/readback guards
still apply. Electrum and its refresh/faucet/send callers do not wait for the
Relay deadline. Real native Realm connection-flag writes are exercised around
the background backup: `isConnected` is normalized out of recovery content.
Observers never upload. There is no new ciphertext replay or authority refresh.

`tests/recovery/automaticNodeBootstrap.integration.cjs` uses the production
network module, origin middleware/store observers, encrypted native Realm,
crypto and real HTTP/CAS/readback on clean Relay838049. Public Electrum
connectivity is stubbed; provider/fee actions are not serviced. It does not
render WalletDetails, exercise MMKV, or prove native UI/public-provider flows.
The exact commands/results, initial failures, TypeScript comparison and
independent safety review are recorded in the newest handoff.

## Reproducible proof and actual boundaries

The accepted RED ran before any app source edit with this exact command (the
new integration file then contained only its first test):

```bash
KEEPER_RELAY_FIXTURE_MODULE=/workspace/dependencies/Relay-r4-16kb-fixture/tests/support/automaticBackupHttpFixture.cjs \
  /workspace/dependencies/tools/node_modules/node/bin/node --test tests/recovery/automaticNodeBootstrap.integration.cjs
```

It failed `The actual network caller must enqueue its committed node image`,
expected1/actual0, after actual defaults and migration flags were saved.
Unchanged9a19 `src/store/sagas/network.ts` SHA256:
`744c69af7633e8ac4333b535c76f50dc76e34e2eae4b469d7c85826c86e8700e`.
Accepted RED log SHA256:
`8cbeec9e557cc4f6e8343b91113ad929cf950060c844201e8c2993c165d301b7`.
The committed first test plus optional network-slice fixture support provide
portable source, rather than requiring a Cloud-local log path. To reproduce
the failure, copy those two test files from this final commit into a separate
9a19 checkout with the same prerequisites and run only the first named test;
the later safety cases are for the fixed source. A filtered reproduction will
report the other cases skipped; the original single-test RED had zero skips.

The first focused GREEN ran19/19. The twentieth case separately passed1/1
after correcting its setup to close the existing Realm before reopening the
same account. The original attempt opened a second cached same-path wrapper,
then encountered a closed-Realm setup error. That lifecycle boundary is
preserved as an initial fixture failure, not fixed or claimed to be a Mac/app
reproduction. An earlier cross-VM empty-object assertion was normalized to
plain data before accepting RED; no production source was changed for it.

The final native toolchain is Linux x64, Node22.23.3, Realm12.15.0; the actual
`realm/prebuilds/node/realm.node` SHA256 is
`f9873520422ba77488708a7ef760b189117782a9b13ae1f5c963a68041965934`.
The runner requires and passes an actual native write/read before discovering
the matrices. Mongo7.0 uses the pinned disposable image
`mongo:7.0@sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca`,
replica set `keeperQA`, loopback port27058; clean Relay838049 stays unchanged.

```bash
export REALM_DISABLE_ANALYTICS=1
export KEEPER_RELAY_FIXTURE_MODULE=/path/to/clean/Relay/tests/support/automaticBackupHttpFixture.cjs
export BACKUP_TEST_MONGO_URL=mongodb://127.0.0.1:27058
npm run test:automatic-backup-genuine
npm run test:recovery
npm test -- --runInBand --coverage=false
node --test scripts/release-version.test.cjs scripts/verify-channel-config.test.cjs
python3 -B -m unittest discover -s scripts -p 'test_release_artifact.py'
ruby scripts/test_fastlane_build_only.rb
npm run version:check
node_modules/.bin/eslint src/store/sagas/network.ts
node_modules/.bin/tsc --noEmit --pretty false
```

Ruby3.3.8 ran offline with read-only source, tmpfs/tmp and image
`ruby@sha256:307aed56240959e9cd3fcc10740ae8d0e6c461e9b42efc076100d4f8126b87b9`;
these are rule tests, not actual Fastlane build/sign/upload actions.
TypeScript **fails** with944 diagnostics on both unchanged9a19 and final source,
with zero additions/removals after normalizing source locations and symlink
dependency paths while retaining diagnostic code/message/path/multiplicity.
Thus no new action/origin/producer typing diagnostic was added; this is not a
clean whole-project typecheck. All-four-module ESLint still **fails** with
12 inherited errors/17warnings in wallets/send; normalized findings add zero.
The network module is clean (previously2errors/2warnings); store.ts is clean.
Whole-project ESLint and native build/UI/MMKV/hardware are NOT RUN in Cloud.

| Final Cloud check | Actual result |
| --- | --- |
| `npm run test:automatic-backup-genuine` | PASS295/295, zero failures/skips/cancellations;213482.007654ms; native prerequisite passed; new producer20 + prior275 |
| Focused new fixture before full run | PASS19/19, then added Realm-handle case1/1 separately; all20 subsequently passed in the full runner |
| `npm run test:recovery` | PASS448/448, zero skips/cancellations;53687.300236ms |
| `npm test -- --runInBand --coverage=false` | PASS42suites/432tests;58.513s; focused connection Jest3/3 also passed |
| Release rule components | PASS28Node +7Python +21Ruby/117assertions, zero failures/skips |
| `npm run version:check` | PASS2.6.4 / Android627 / iOS620; counters remain provisional |
| Network ESLint / diff / changed handoff links | PASS; broader inherited lint and TypeScript failures remain as disclosed above |
| Independent read-only production/test safety review | No blocking findings; no reviewer edits or claimed independent native execution |
| Current-head native install/launch/UI/MMKV/hardware | NOT RUN in Cloud; NEEDS_LOCAL |

The final handoff records the full pushed SHA, hosted checks and actual Android
diagnostic cancellation stage. Cloud test passes do not imply current-head
hosted CI or native acceptance, backend rollout, signed-artifact identity or
release approval. Prior17e0/9a19 native results remain separately SHA-scoped.

## Exact-source Codex Local continuation

Required local checks: **IOS, ANDROID, HARDWARE**. Read the newest exact-head
handoff, [AGENTS.md](../AGENTS.md), this document and the
[full R4 handoff](r4-automatic-backup-local-handoff.md). Recheck the live SHA.
Preserve ongoing9a19 tests, owner apps/data and original failed artifacts;
advance only a separate clean checkout after this stage closes. Use disposable
Relay838049 without changing contributor pins or either readiness constant.

1. Incrementally build new **Android developmentDebug** and **iOS simulator
   Debug** artifacts from the exact new SHA, retaining matching native caches,
   dependencies and locks. Actually install/launch; record source/JS checkout,
   artifact hash, package/bundle, version/counter, device and backend. On strict
   arm64 Android17/API37 confirm PAGE_SIZE16384 and established fatal/true
   properties; do not enable compatibility mode. Old16KB/4KB/static/iOS results
   remain scoped to their original artifacts and SHAs.
2. On **each platform**, reproduce the original order with a fresh disposable
   account: consentOFF, no persisted nodes; explicit opt-in to complete Verified
   readback with one wallet/two signers/no nodes; then ordinary Wallets→Mobile
   Wallet detail (`autoRefresh:true`) **before any editor/rename/Save**. Require
   local canonical nodes and automatic current Verified with an acknowledged
   next revision and complete image/metadata readback. Do not bridge this step
   with manual Back Up Now.
3. From that automatic healthy baseline, perform one harmless ordinary rename.
   Require local persistence, acknowledged next revision, native decrypted full
   image/metadata matching current Realm and only the intended name delta.
   Fresh Status must be Verified. Reopen details/reconnect and confirm cache
   flags do not enqueue another recovery write. Cold launch/PIN unlock; check
   MMKV consent, nodes, renamed wallet and truthful proof without replay.
4. Retain relevant PIN/keypad, Portal initialization, MMKV/encrypted Realm,
   wallet/backup/recovery base smoke on both platforms. Preserve independently
   incomplete R4 categories; do not repeat unrelated large native/provider
   matrices solely for this TypeScript patch. Physical signer/camera/NFC/USB,
   public-provider and real-device claims require actual execution separately.
5. Post actual per-platform results for the exact SHA. If another failure
   remains, preserve sequence/local/remote evidence and artifacts and report;
   do not begin another speculative fix/rebuild loop under this handoff.

Only app files `src/store/sagas/network.ts`, `wallets.ts`, `send_and_receive.ts`
and `src/store/store.ts` change. Native/build inputs (`android/`, `ios/`), package
and Yarn locks, patches, JNA/Portal pins, version counters, tracked configuration,
contributor manifest, automatic transport/guards and readiness constants remain
byte-identical to9a19. New native acceptance is still required. Old physical
deferral does not transfer: only a new owner exact-SHA decision can defer unrun
HARDWARE, never IOS/ANDROID or an observed failure.

R4 remains blocked on current-head native acceptance, outstanding scope/review,
owner-parked failed Android C8/#7056, separate backend source/fleet/index/
transaction/old-writer proof and authorized rollout, fresh store/version/config
inputs and the separately authorized production artifact stage, plus separate
Desktop/website deliverables. Do not merge, deploy, create indexes, sign release
builds, construct production AAB/splits, upload, submit, publish, call real/paid
providers, message customers or broadcast transactions. Keep R4 independent of
Reproducibility and Bitkey Wallet.
