# R4 backup inspection queue admission

15 October 2026. **NEEDS_LOCAL / NOT RELEASE-READY**. PR
[#7045](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045); the newest
Codex local handoff names the actual final SHA. This document cannot contain
its own eventual commit SHA.

## Preserved evidence and narrow change

The [17e0 investigation](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6183834923)
preserves the original native rename failure, three diagnostic outcomes and
separate required-behavior **0/1 RED** regression, with portable fixture code.
Its app source is `17e0d9b9e3daf39359b762baa99b899f20b95f96`; the unchanged
paired disposable Relay is `838049e537e07eb646a2a0393eb969fba43d0739`.
The three diagnostic cases passed by establishing a successful completed rename,
the inspection-overlap defect, and a missing-original-baseline uncertainty
control. Those are not three backup acceptance passes.

`inspectBackup` previously expired the verified baseline before joining the
account queue. A later read-only inspection could therefore change the epoch
of an earlier current writer while that writer awaited its snapshot, CAS or
readback. Its original proof then failed closed, preserving local data and
pending state. The fix moves that invalidation into **every admitted `runOnce`
callback**, immediately after the captured-session stale return and before
`inspectOnce`. A coalesced caller does not acquire another admission. A retry
does acquire an admission and expires that admission's baseline, using the same
deadline. Stale A→B→A work returns before touching the new session's baseline.

No original intent is rebased. Session/consent, runtime brands, Realm identity,
generation/fingerprint, original revision/CAS, single-use ciphertext and complete
readback checks are unchanged. Hosted writes remain fenced. The source gate
stays true for approved development loopback; the rollout gate stays false.

This confirms a source ordering defect, **not the unique cause of the native
17e0 failure**. The modal normally closes after its upload attempt settles.
The reported Save→Home interval and later Status visit do not prove overlap;
concurrent/background inspection timing or missing dispatch-time authority
remains unestablished. Preserve the original local rename/unchanged remote
revision/pending evidence and the measured14.170s host/guest clock offset.
Later Local evidence at17e0 records one explicit **Back Up Now → conflict /
Backup needs review**, with unchanged remote revision fingerprint
`bfc41e774d5b0a53` (1wallet/2signers, no vaults/labels), and matching selected
account/live Realm/store. This is a separate actual **FAIL**, not covered or
resolved by the ordering fix. The conservative `replacementWouldDiscardRecovery`
guard compares recovery content, including presentation changes; safe field-level
differences are still being assessed read-only. No manual retry, override or
change to that guard is authorized in this cycle.

## Cloud proof and boundaries

The focused genuine matrix is
`tests/recovery/automaticInspectionQueue.integration.cjs`. It uses actual
encrypted Realm and production transaction/schema/crypto/producer/inspection/
store statements, with real HTTP to the paired transactional Relay. The
Node22 full genuine runner discovers this matrix in addition to the seven
existing matrices and requires a native Realm write/read prerequisite.

Required coverage includes writer-first checks requested before admission and
during original snapshot/CAS/readback; inspection-first later work and missing
original authority staying local-preserved/pending; old-session queued
inspection not erasing a fresh-session baseline; per-admission retry invalidation,
shared deadline and coalescing. Controlled HTTP schedules and any host clock or
public baseline-registration seams are disclosed in the tests. They do not
constitute native navigation/dispatch/MMKV or simulator/emulator execution.

The final PR handoff records exact commands, counts, skips and review results.
Historical17e0 results remain SHA-scoped. No source fixture pass is an iOS or
Android build/install/launch pass.

The focused file passed **12/12, zero skipped** on Node22.23.3 with real
Realm12.15.0 and paired Relay838049. The first focused run was11/12: its retry
test's deliberate thrown snapshot callback re-entered the fixture response
handler and produced an HTML error instead of the intended setup read. Only
that test was corrected to hold a genuine HTTP reply until the actual client
abort; the source patch did not change. The final retry case compresses transport
abort timers to1000ms, delegates actual HTTP, and asserts the same unmodified
inspection deadline across attempts. No host inspection clock is replaced.

The stale-session/retry cases deliberately exercise the public baseline
registration boundary. A real HTTP snapshot must strictly decrypt, match the
full native Realm image and app metadata, with stable session/Realm handle/
fingerprint, before recording it. This is not a claim that a nested queued
native inspection can run while its own account queue is held. The stale-session
test also uses the preserved fresh baseline for a real subsequent rename CAS.
Independent read-only source/test review found no authority rebase or guard/gate
change. The completed Cloud results for this implementation are:

| Check | Actual outcome |
| --- | --- |
| `npm run test:automatic-backup-genuine`, Node22.23.3/native Realm12.15.0/paired Relay838049 | PASS275/275, zero skipped/cancelled;168791.623271ms; native write/read prerequisite passed |
| New `automaticInspectionQueue.integration.cjs` alone | PASS12/12, zero skipped/cancelled;10982.202962ms |
| Preserved required-behavior case, changing only its fixture import to this source | GREEN1/1, zero skipped; original17e0 RED0/1 remains preserved separately |
| `npm run test:recovery` | PASS448/448, zero skipped;42324.276752ms |
| `npm test -- --runInBand --coverage=false` | PASS42suites/432tests;46.243s |
| Release rule components | PASS28Node +7Python +21Ruby/117assertions, zero failures/skips; Ruby3.3.8 ran offline in a read-only source container, not Fastlane actions |
| `npm run version:check` | PASS2.6.4 / Android627 / iOS620; counters remain provisional |
| `eslint src/services/backup/repair.ts`, diff and changed handoff links | PASS |
| Whole-project TypeScript/ESLint | NOT RUN here; historical inherited failures are not new clean results |
| New-head native build/install/launch, MMKV/Realm/UI, hardware | NOT RUN in Cloud; NEEDS_LOCAL |

The tests used the exact minimal source patch with the unchanged dependency
caches; the final commit adds the recorded evidence/handoff. The genuine runner
used the pinned disposable Mongo7.0 image and source identities documented in
the complete Local handoff. Ruby used
`ruby@sha256:307aed56240959e9cd3fcc10740ae8d0e6c461e9b42efc076100d4f8126b87b9`
with `--network none --read-only`, a read-only source mount and tmpfs/tmp.
None of these checks signs, builds or publishes a production release. Final
push/hosted-CI status and full source SHA are recorded in the fresh PR handoff.

## Focused Codex Local continuation

Read the newest exact-head PR handoff, [AGENTS.md](../AGENTS.md), this document
and the preserved17e0 investigation before selecting a clean isolated checkout.
Check the live head again. Preserve existing owner apps, QA accounts/databases,
failed artifacts/logs and ongoing independent17e0 checks; do not reset or clean
their worktrees or overwrite failed evidence.

The only changed app module is `src/services/backup/repair.ts`. Native/build
inputs remain byte-identical to17e0: `android/`, `ios/`, `package.json`,
`yarn.lock`, `patches/`, JNA5.18.1/Portal pins and exclusions, build versions,
tracked configuration code/templates and approved contributor manifest. Backup transport,
automatic-write implementation/guards and both readiness constants are unchanged.
Use existing matching dependencies, CocoaPods/Gradle/native caches for incremental
builds; do not rewrite locks or reinstall unrelated inputs to obtain a pass.
Actual new-artifact install and launch are still required.

Required local checks remain **IOS, ANDROID, HARDWARE**. The focused retest is:

1. Build from the actual new SHA: Android **developmentDebug only** and iOS
   simulator **Debug**, using the established disposable loopback configuration
   and paired Relay838049. Use the existing functional simulator development
   signing if required for Keychain; no release signing or production artifact.
   Ensure Metro or the packaged JS comes from this exact checkout. Record source,
   package/bundle ID, version/counter, artifact SHA/certificate and launched device.
2. Actually install/launch both artifacts. Preserve the17e0 strict16KB/normal4KB
   and iOS compile evidence as historical, not new-head passes. On the disposable
   strict16KB arm64 Android17/API37 AVD, confirm PAGE_SIZE16384 and the established
   fatal/true properties; do not enable compatibility. Do targeted native
   Portal initialization/MMKV/Realm/PIN/wallet smoke. Native inputs are unchanged;
   do not repeat unrelated large static/provider/hardware matrices for this patch.
   Verify the new artifact's identity and continued strict launch rather than
   transferring the old artifact's result.
3. In a separate disposable QA account/dataset on each platform, establish a
   complete Verified backup, perform ordinary BTC Mobile Wallet rename, and
   observe local persistence plus the intended revisioned write/readback. Open
   AssistedBackupStatus for a fresh check; require the new name remotely and
   Verified at the current local generation. Include one controlled overlapping
   read-only check if the existing approved fixture/operator can schedule it,
   recording the actual sequence. Do not add broad app instrumentation.
4. Cold-launch/unlock and confirm the renamed local wallet and truthful pending/
   fresh-verification behavior, without replaying old ciphertext. Keep the
   original17e0 failed account/artifact/evidence intact. Missing baseline,
   concurrent local change or another failure must remain pending rather than
   borrowing a new baseline. Preserve the separate17e0 manual conflict; do not
   press manual repair again or override it to hide a failed result. This patch
   does not claim to fix that conflict.
5. Post actual per-platform results for the new SHA, retaining all unresolved
   R4/native/release categories separately. A known native failure is not waived
   by Cloud proof. If another failure remains, preserve it and report; **do not
   start another speculative source fix/rebuild loop** under this handoff.

Keep Android C8/#7056 owner-parked and failed; this patch does not retest, resolve
or waive it. Physical-only deferral still requires the owner's new exact-SHA
scope decision; retain HARDWARE and actual NOT RUN boundaries. Existing source
reviews, full native acceptance gaps, hosted backend fleet/index/transaction/
old-writer rollout, current store/config/production artifact evidence and separate
Desktop/website deliverables remain open. No merge, deployment/index mutation,
release signing, production AAB/split construction, upload/publication, customer
message, transaction broadcast or new real/paid provider call is authorized.
R4 remains independent of Reproducibility and Bitkey Wallet.
