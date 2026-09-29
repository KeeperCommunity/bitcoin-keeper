# Backup comparison and repair: NFR review

Reviewed 29 September 2026. This audit records the original baseline for the check → prompt → update → verify flow. The flow and safeguards are now implemented locally; see design.md and validation.md for current status. The observations below describe the pre-change candidate, not the final implementation. No approved numerical backup performance budgets were found in the synced product sources or repository OpenSpec documents searched. The thresholds below are proposed engineering targets, subject to native validation.

## Original observed gaps (addressed unless listed as a remaining gate in design.md)

- `src/services/rest/RestClient.ts:64`: POST passes headers only to Axios. The backup endpoints supply no explicit request timeout, abort signal, or transfer progress callbacks. No global Axios timeout override was found. A stalled request can leave the loading state pending indefinitely. An existing unrelated call passes `{timeout: 20000}` as the headers argument, so that pattern must not be copied as a timeout implementation.
- `src/store/sagas/bhr.ts`: full backup synchronously serializes/encrypts all wallet, signer, vault, node and label records before posting one large request. Saga orchestration does not move synchronous encryption off the React Native JavaScript thread. One large wallet can stall it even if work yields between smaller records.
- `ActivityIndicatorView` is an overlay modal with a spinner and no stage text or explicit exit/retry control. Existing backup consumers use a global loading flag. It is unsuitable as the entire long-running repair experience.
- Existing `validateServerBackupWorker` compares most collections by IDs/counts, decrypts records synchronously, omits local USDT wallet records from its wallet comparison, and mutates the local node object's `isConnected` field during comparison. It cannot be reused unchanged as read-only semantic verification.
- The generic watcher forks each request, so repeated repair actions can overlap. Full snapshots replace server collections; concurrent mutations need ordering/version checks, not merely button disabling.
- The candidate's repair marker currently means server acknowledgement, not post-upload readback verification. That is insufficient for the proposed final verified-success message.
- Candidate upgrade repair currently uploads automatically for opted-in accounts. Adopting the proposed comparison/prompt flow requires replacing that upgrade behavior; it is not yet done.

## Measured local baseline

`node tests/recovery/benchmarks/backup-cost.cjs` exercises production AES encryption/decryption with disposable synthetic records, one warm-up and three measured repetitions. Median measurements on this Mac (Node darwin/arm64), not React Native/device results:

| Synthetic input | Encrypted payload | Encrypt | Decrypt + parse | Upload + readback at 1 Mbps each way, theoretical minimum |
| --- | --- | --- | --- | --- |
| 10 × 50 KiB records, 0.49 MiB total | 0.65 MiB | 19 ms | 14 ms | 11 s |
| 100 × 50 KiB, 4.89 MiB total | 6.52 MiB | 176 ms | 136 ms | 109 s |
| 100 × 200 KiB, 19.54 MiB total | 26.05 MiB | 718 ms | 498 ms | 437 s |
| One 19.53 MiB record | 26.04 MiB | 917 ms | 504 ms | 437 s |

Transfer estimates exclude the initial comparison download, protocol overhead, latency, retries and server processing. They assume symmetric sustained 1 Mbps, not typical user throughput. Synthetic sizes are stress cases, not observed user backup sizes or proposed supported limits. JSON request overhead and peak memory were not measured. Local relay source accepts JSON bodies up to 50 MB; deployed proxy/server limits remain unverified.

## Required behavior

1. **Startup and interaction:** show the unlocked app without awaiting the upgrade comparison's network result. Schedule the check after essential startup work. Encryption/comparison must not freeze navigation or signing UI. Proposed native target: no backup-induced JavaScript-thread task longer than 50 ms; measure on the slowest supported device, including a single large wallet. Yielding between records alone does not solve large-record stalls.
2. **Progress:** display the real current stage: checking, preparing, uploading, verifying. Proposed response target: visible feedback within 250 ms of the user starting repair. Show explanatory slow-operation status after 10 seconds. Do not invent a percent, remaining time, or completion while bytes/server work are unobserved.
3. **No trapped waiting screen:** allow users to leave the progress view from the outset and expose the operation status from the existing backup area. Leaving the view must not claim that an upload has been undone. OS background suspension/app termination must leave durable pending/unverified state; do not promise continued execution in the background.
4. **Bounded stalls:** implement transport-level cancellation/deadlines, not only a UI timer. Proposed stall threshold: 30 seconds without genuine transfer or stage progress. A healthy large transfer may take minutes, so a blanket 30-second total timeout is inappropriate. Establish a bounded overall attempt budget and supported payload ceiling from native and deployed-backend measurements before release; do not guess those limits from the Mac benchmark.
5. **Ambiguous outcomes and retries:** timeout/cancellation after upload may mean the server already accepted it. Mark the outcome unverified, re-read before retrying, and never treat a retrieval error as mismatch or empty backup. Use bounded retry/backoff with manual retry available; no tight loops or repeated prompts at every unlock.
6. **Correct comparison:** compare canonical recovery-relevant plaintext locally after decryption, not randomized ciphertext, volatile balances or live connection flags. Include all supported wallet types/networks and associated recovery material. Preserve server-only/conflicting records pending explicit reconciliation. Comparison must not mutate live Realm objects or alter keys.
7. **Consistent verification:** freeze/version the intended snapshot; coalesce repair work per account and coordinate full/incremental writes. New wallet activity during repair must remain pending until included and verified. Only a readback matching the intended complete recovery data can produce verified success or permanently clear the reminder.
8. **Privacy and consent:** preserve Assisted Server Backup opt-out. Report diagnostic sizes, durations, stage and error category only; no Recovery Key, private keys, plaintext backup, wallet IDs or addresses in telemetry/logs. Do not add new analytics as part of this review.
9. **Accessibility:** use existing Keeper components; stage/failure text must remain readable at small widths and enlarged system text sizes. Controls remain reachable, progress changes are accessible, and a spinner is not the only status signal.

## Native acceptance matrix / current status

**Completed locally:** native small-fixture upgrade and clean recovery on Android/iOS, Android repair/readback, iOS backend failure/retry. These are development/simulator results.

**Remaining native matrix:** large/single-large-record datasets; many labels/signers; both networks and USDT; normal network, 1 Mbps network, high latency, no response, offline/reconnect; background/foreground, OS kill/relaunch, screen navigation, account switch, repeated taps, and wallet mutation during upload. Measure UI stalls, end-to-end stage durations, peak memory, bytes and retry count. Verify bounded stalled-state exit and uncertain-outcome readback, and that matching backups produce no repair prompt.

**Infrastructure update:** the shared Docker VM still has storage errors. A separate `keeper-recovery-qa` Colima profile now runs a healthy disposable MongoDB replica set and local relay; database/HTTP contract tests pass. Native performance acceptance is still pending. The Mac benchmark is a finding, not an NFR pass; keep the candidate in Now until applicable release gates pass.

## Current desktop stress follow-up

The real production AES/comparison path under Node 22, with mocked Realm/transport, repaired 10 wallets + 10 keys in 487 ms, 100 + 100 in 3,866 ms and 1,000 + 1,000 in 35,314 ms. Comparison took 189 / 2,050 / 20,145 ms; maximum event-loop delays were 36 / 37 / 91 ms on a busy Mac. The largest case exceeds the proposed 50 ms task target even here. This is not native NFR acceptance. Evidence: now-candidate-2026-09-29/evidence/backup-performance.json.
