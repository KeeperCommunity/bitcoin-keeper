> Current R4 contract: [protected backup integration](protected-backup-integration.md) supersedes the historical v2 protocol and whole-copy Delete language below. Prior checked source/fixture boxes are SHA-scoped historical evidence, not protected-v3, native, hosted or release acceptance. Delete now applies only to the new protected copy; older encrypted copies remain read-only. All-copy erasure is outside approved R4 scope, unimplemented and unscheduled.

# R4 automatic Assisted Backup: result matrix

Updated 13 October 2026 from observed source/disposable evidence. Historical September logs remain unchanged in [validation.md](validation.md). The [sanitized October proof record](evidence/automatic-backup-source-proof-2026-10-13.md) records commands, source identities, counts and coverage boundaries. The table below retains the original Cloud source-proof result; a later exact-head Codex Local report on PR #7045 records native results and any new app SHA.

Automatic-backup implementation and disposable proof are mandatory R4 work. Critical IOS/ANDROID backup acceptance also precedes release. Host-native Realm means the real Node Realm SDK, not an iOS/Android app launch. Physical-device-only follow-up cannot waive critical simulator/emulator safety checks.

The [15 October exact-698 Local report](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6178691569) supersedes the historical native NOT RUN cells only for its explicitly tested subset. It records a strict-16-KB Android startup FAIL. The [targeted supplier correction and new-head retest](../../../release/r4-android-16kb.md) do not constitute native acceptance or R4 readiness. Android C8/#7056 remains owner-parked and failed; this continuation must not restart that separate fix/retest cycle. Both hosted-backup readiness constants and the approved contributor manifest are unchanged.

## Source and result record

| Field | Current record |
| --- | --- |
| Audit starting app source | b160656218dc6065ad12af9db220c974255bfc23; historical |
| Final tested code commit before documentation | 3cc9368ca2f3b2149db5743a5f9d230aa516d6a0; includes persisted-proof expiration, current-proof status projection and seven new genuine cases |
| Original tested Relay fixture commit | b600416e5ba7325927d7d2871cff7776f4e593fe; runner requires clean tracked source. Native Android later exposed an incomplete repair readback on this fixture |
| Current paired disposable Relay source | 838049e537e07eb646a2a0393eb969fba43d0739 in draft Relay #4 fixes subscription metadata on an existing AppImage during explicit revisioned repair. Focused route regression RED 0/1 on b600 and GREEN 1/1 on 838; full HTTP 58/58, backup suite 120/120 and Relay TypeScript PASS. This is loopback evidence, not deployed Relay readiness or final exact-SHA app signoff |
| Runtime and topology | Node 22.23.3, actual Realm 12.15.0, Linux host, disposable loopback keeperQA Mongo replica set on port 27058; no hosted credentials |
| Combined genuine fixture command/result | `npm run test:automatic-backup-genuine`: PASS 260/260, 0 failures/skips, 208.779 seconds, clean frozen-Yarn run terminal recorded 2026-10-13 05:26 UTC; core 213 + producers 46 + restore 1 |
| Recovery unit command/result | `npm run test:recovery`: 443/443 PASS, 0 failures/skips, 52.156 seconds at 3cc9368ca2f3b2149db5743a5f9d230aa516d6a0 |
| Clean encrypted Recovery Key restore | PASS: actual recovery saga, real key derivation/AES, blank encrypted Realm and real HTTP reads; complete image, all signer fields and normalized nodes checked |
| Source/hosted flags | AUTOMATIC_BACKUP_SOURCE_READY=true for DEVELOPMENT loopback only; AUTOMATIC_BACKUP_RELAY_ROLLOUT_READY=false; hosted rollout remains false |
| IOS / ANDROID exact-source result | NOT RUN / NOT RUN; NEEDS_LOCAL |
| Review and current-head CI | Independent agent fixture review completed; external final-source review remains open. Prior head 2071 hosted Tests 38348159148 and CodeQL 115134694738 succeeded; current final-head combined CI awaits the post-documentation push. Source #7042 at 163cc own-head checks succeeded with runtime d280 unchanged; prior failures remain in [October evidence](evidence/automatic-backup-source-proof-2026-10-13.md) |
| Current Jest | 42 suites / 432 tests PASS, 37.9 seconds at 3cc9368ca2f3b2149db5743a5f9d230aa516d6a0 |
| Type/lint boundary | Recorded focused six core module lint/format PASS. Prior 2071 hosted whole lint CLI FAIL: 5353 problems, 4467 errors, 886 warnings, tolerated by the green job. Whole-project tsc FAIL with 945 inherited diagnostics versus 957 at baseline bb66cea459fbb00ec33c5c4ebd601d07c0d7c125; zero added normalized diagnostics, not a clean typecheck |
| Current release preflight | FAIL: 2026-10-13 04:11 UTC command found iOS store history older than 24 hours; refresh required before release |
| Production running artifact/topology/authorization | NOT VERIFIED; no deployment, merge or publication authorized |

Use PASS, FAIL, BLOCKED or NOT RUN with provenance. The source SHA precedes this documentation commit; the final PR handoff must separately name the actual post-push head SHA. Earlier October results at efa6 (253 genuine) and 0f375 (430 recovery), and the earlier 41-suite/393-test Jest report, remain as the prior checkpoint in the linked evidence. No real seed, private key, account identifier, label content, plaintext backup or credentials are included in the evidence.

## Common cases required for every operation

| Case | Required assertion |
| --- | --- |
| C1 committed match | Real local commit precedes cloud send; operation ID, originating account/session, generation, decrypted payload/target and original verified base are valid. Exactly one intended v2 effect reaches the production transport/HTTP path. Local results survive cloud failure. |
| C2 uncommitted/stale state | Failed/partial local commit, stale generation/payload, wrong encryption owner or missing operation proof sends no mutation. No pre-persistence upload or newly verified base is substituted. |
| C3 account session | A→B→A before send performs no old-session mutation; change after send remains uncertain/pending for A without using B's key/data or changing B's status. |
| C4 remote conflicts | Apply the proposed effect against the validated remote snapshot; remote-only records and immutable identity conflicts are preserved without automatic overwrite/deletion. |
| C5 consent | Disabled/unconsented accounts send zero automatic mutations. The separately explicit whole-backup opt-out preserves its consent choice until positive acknowledgement. |
| C6 competing writer | A real revision race/409 stops the chain and leaves pending; no refreshed base authorizes an old payload. |
| C7 old/malformed protocol | 404/unsupported v2, malformed snapshot or acknowledgement, false/missing preconditionApplied, and invalid/missing newRevision fail closed with no legacy fallback. |
| C8 timeout/lost acknowledgement | Read back uncertain server state before fresh work; do not replay ciphertext or send later fanout members. Matching content alone does not complete the interrupted originating operation. |
| C9 complete readback | Final decrypted server image includes all recovery records/references and matches freshly captured local state at the same committed generation/session. Corruption, partial response or missing references cannot produce verified. |
| C10 final commit race/restart | Inject a local mutation immediately before Redux verification commit: pending persists and verified is rejected. Restart keeps committed local data and pending state; it does not replay prepared payloads. |

## Seven-operation host matrix

The genuine matrix uses actual production snapshot/commit/automatic/transport code, real AES, production schemas and encrypted native Realm, extracted production Redux middleware/store observers, and real HTTP into the pinned transactional Relay. Common negatives include stale generation, queued A→B→A, remote-only/key conflict, failed commit, copied/missing proof, unsupported/malformed protocol, timeout/lost ACK, incomplete/wrong-key readback and closed/reopened Realm. The additional after-send A→B→A and inter-member native-write schedules passed 8/8 at fixture commit 7b1ad70ba9e2aa1a2778b375f36e776bdd26a5ad, before source commit efa6f89ebf7140f738f03ce8a7218a2a1e7f9bc2 enabled development loopback testing. The combined final runner result is recorded separately.

Most operation mutation callbacks in the core matrix are constructed directly over the production commit API. Separate producer files exercise actual wallet/vault, signer/registration, label, version-upgrade and existing-USDT functions. Seven additional cases exercise real Redux Persist reconciliation in both BHR/legacy-root orders and the actual UI AST declaration projection over native Realm/HTTP proof. This does not attest rendered React Native UI, native MMKV, UI navigation or native app relaunch. USDT new-wallet creation/import remains paused; tested USDT records are existing retained records only.

| Operation | Observed production proof | Host result / evidence |
| --- | --- | --- |
| updateAppImage | Committed wallet/signer records, node exact-set replacement and app/version metadata; stale action ciphertext rejected | PASS existing core/producer cases; added held-ACK schedules PASS; [October proof](evidence/automatic-backup-source-proof-2026-10-13.md) |
| migrateXfps | Exact old/new KeyUID and committed sanitized signer, live/archive vault references and registration/policy continuity | PASS existing core + signer producer 9; added held-ACK schedules PASS; [October proof](evidence/automatic-backup-source-proof-2026-10-13.md) |
| deleteAppImageEntity | Committed local BTC/USDT/signer absence with validated expected remote target and retained recovery content | PASS existing core + existing-USDT producer 11; added held-ACK schedules PASS; [October proof](evidence/automatic-backup-source-proof-2026-10-13.md) |
| deleteVaults | Exact committed local absence and preserved retained/server-only recovery records | PASS existing core; added held-ACK schedules PASS; [October proof](evidence/automatic-backup-source-proof-2026-10-13.md) |
| updateVaultImage | Committed vault/policy/archive/signersData and shared registrations; real create/archive and correction fanouts | PASS existing core + wallet 8 + signer 9; added held-ACK schedules PASS; [October proof](evidence/automatic-backup-source-proof-2026-10-13.md) |
| modifyLabels | Committed tags, exact account-derived hash/ciphertext, grouped send/change labels and import rollback | PASS existing core + label 9 + upgrade 9; added held-ACK schedules PASS; [October proof](evidence/automatic-backup-source-proof-2026-10-13.md) |
| deleteBackup | Fresh explicit same-session opt-out, positive ACK, complete empty readback, retained local records and protected consent completion | PASS existing core including newer-choice/reentrant completion guards; added held-ACK schedules PASS; [October proof](evidence/automatic-backup-source-proof-2026-10-13.md) |

## Logical fanout and producer proof

| Scenario | Result / observed boundary |
| --- | --- |
| New vault plus archived predecessor | PASS real wallet producer migration; both local effects precede HTTP, archive sends before new vault, success readback and second-CAS rejection tested |
| Shared registration | PASS real persisted VaultSigner registration fans out to active/archive vaults; complete readback required; second CAS rejection leaves pending |
| Label import plus deletion / grouped send labels | PASS actual label producers, real tags/AES/HTTP; invalid late import rolls back atomically; 409/404/malformed/lost response preserves local data |
| First fanout member succeeds, next fails | PASS second-member 409 schedules for create/archive, shared registration and label fanouts. Signer/upgrade lost-first-reply schedules stop later effects. This does not claim every fault was injected at every position |
| Native local mutation between fanout members | PASS added actual native-write schedule after first real CAS while its ACK is held: the next prepared member sends nothing, local data survives and pending remains |
| New verification cannot authorize old/cloned intent | PASS immutable original-base/captured intent/operation tests, queued stale generation and no-original-baseline producer cases |
| Local-first creation/edit/deletion | PASS observed actual wallet/vault/signer/label/upgrade/existing-USDT producers; failures retain truthful committed local results and pending backup |
| Disabled/unconsented account | PASS no-original-baseline/consent-off host cases and unit coverage; no inherited consent or upload. Fresh explicit whole-backup opt-out while consent already off is separately tested |
| Complete encrypted restore | PASS actual Recovery Key worker into blank Realm; BTC MAINNET/TESTNET, existing DEFAULT/IMPORTED USDT, keys, active/archive vaults, registrations, labels and nodes |
| Final verification race | PASS native write immediately before actual Redux verification dispatch leaves pending; copied/uncommitted proof cannot bypass it |
| Account change after send | PASS added after-send A→B→A for all seven operations, with a distinct B seed/account/publicId and independently verified B backup; old A completion leaves B state, native data and remote backup unchanged |
| Realm close/reopen | PASS stale queued proof rejects the reopened handle; this is not native app/process restart or MMKV evidence |
| Persisted host rehydration / current-proof display | PASS six actual Redux Persist boot/consent/durability cases and one actual UI AST declaration projection case over native Realm/HTTP. Saved Verified/interrupted/completed status expires to unverified/pending; consent, confirmation, local records and existing negative findings survive. Canonical consent wins both read orders and subscriber prefixes; only confirmed absence permits fallback, errors deny it, and late raw legacy fallback preserves continued nested writes. No replay or upload; only fresh complete readback restores proof |
| Persisted app interruption/relaunch and background behavior | NOT RUN; mandatory IOS/ANDROID Local checks |
| Transactional HTTP contract | PASS actual paired route/service/Mongoose transaction path and disposable source contract checks; hosted artifact parity, topology, limits and old-writer fleet rollout remain unverified |

## Mandatory critical native acceptance

Both platforms must test the final source with disposable accounts/data and a compatible fixture backend. Do not replace the owner's installed app or mutate real wallets for this matrix. Use native build/launch plus simulator/emulator flows; unit mocks and a historical simulator compile do not substitute for launch/flow evidence.

| Native scenario | IOS result + evidence | ANDROID result + evidence |
| --- | --- | --- |
| Build and launch exact source; identify native package/version and backend source | NOT RUN | NOT RUN |
| Cold launch with saved Verified/interrupted state, nested/legacy consent precedence and durable MMKV: unverified/pending until fresh complete readback; no replay, preserved local data/choices/confirmation | NOT RUN | NOT RUN |
| Opted-in automatic create/edit/delete after initial backup; local data survives forced cloud failure and relaunch | NOT RUN | NOT RUN |
| Complete server readback and clean Recovery Key restore of newly produced committed dataset | NOT RUN | NOT RUN |
| Legacy encrypted snapshot upgrade plus absent/stale/transport/server/decryption failure; no false missing/empty/verified or unsolicited replacement | NOT RUN | NOT RUN |
| Account/consent switch including A→B→A while connectivity/queue/readback waits; no cross-account upload, key selection, persistence or status change | NOT RUN | NOT RUN |
| Local mutation during upload/readback/final completion; truthful pending and no stale verified | NOT RUN | NOT RUN |
| Interrupted/uncertain write, relaunch and manual read-only reconciliation; no ciphertext replay or spinner trap | NOT RUN | NOT RUN |
| Interrupted clean recovery preserves truthful incomplete result; correct Recovery Key retries unavailable/corrupt backup without incorrect-words/empty-success feedback | NOT RUN | NOT RUN |
| Registration-only repair and immutable key/policy conflict, with all affected vaults included in verified readback | NOT RUN | NOT RUN |

Native performance/layout and hardware/physical-only results remain separately described in [nfr-review.md](nfr-review.md) and the final Local handoff. Any accepted physical-only follow-up must name the exact unperformed scenario and its authority; it must not relabel required critical native safety checks as optional. Store/signing/deployment/merge approval remains separate from test results.

## Durable evidence and handoff

The October proof record is sanitized durable evidence; September files remain unchanged. After the final Cloud push, the AGENTS.md Codex local handoff must name the actual current PR head and required IOS, ANDROID and relevant HARDWARE checks. Each native row requires exact-head Local results; new code commits invalidate prior signoff. Source/disposable passes do not authorize hosted rollout, merge, signing, store submission or publication.
