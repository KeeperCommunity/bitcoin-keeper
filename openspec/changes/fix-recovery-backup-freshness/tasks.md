> Current R4 contract: [protected backup integration](protected-backup-integration.md) supersedes the historical v2 protocol and whole-copy Delete language below. Prior checked source/fixture boxes are SHA-scoped historical evidence, not protected-v3, native, hosted or release acceptance. Delete now applies only to the new protected copy; older encrypted copies remain read-only. All-copy erasure is outside approved R4 scope, unimplemented and unscheduled.

# R4 automatic Assisted Backup tasks

Reconciled 13 October 2026 at audit starting app source b160656218dc6065ad12af9db220c974255bfc23, then updated from observed October source and disposable proof. The earlier checked checklist described a September candidate, including pre-persistence writes; it did not prove today's automatic-write contract. Historical results remain in [validation](validation.md) and unchanged evidence files. Current completion refers to [the result matrix](automatic-write-validation.md) and [sanitized October evidence](evidence/automatic-backup-source-proof-2026-10-13.md), not native or hosted release readiness.

## Local-first implementation

- [x] Give each logical recovery operation an originating account/session, operation ID and monotonic generation captured after all related local writes commit.
- [x] Reorder wallet/signer/vault creation, edits and deletions so local persistence precedes cloud effects; cloud failure preserves local results and the reducer pending-state contract. Verify actual persisted restart behavior in the native matrix below.
- [x] Prove all seven operation payloads/deletion targets against fresh committed Realm data at queue head with real decrypt/identity validation.
- [x] Reject stale generation, failed/partial commit, wrong owner/key/consent and queued A→B→A without network or later substitution of a newer verified base.
- [x] Cover account-bound node/version writes, exact-KeyUID migration, USDT direct deletion, delayed import callbacks and shared registration propagation in the recorded source/producer cases.
- [x] Handle explicit whole-backup opt-out separately; retain the user's choice until acknowledged empty readback and current consent/session completion, and reconcile lost responses.

## Server sequencing and verification

- [x] Validate v2 snapshot/capabilities and preserve remote-only/conflicting recovery content before automatic send.
- [x] Enforce atomic expectedRevision with positive precondition acknowledgement and valid newRevision; prohibit legacy fallback.
- [x] Use a serialized acknowledged revision chain, revalidating local proof for each member.
- [x] Stop on 409/404/protocol/network/timeout/lost response; do not replay prepared ciphertext or claim intermediate success. The matrix states which multi-member fault schedules actually ran.
- [x] Complete and decrypt server readback, then compare fresh local data at the same committed generation and account/session.
- [x] Make the final Redux verified transition reject a local mutation injected immediately before completion.
- [ ] Verify persisted pending state across actual native app interruption/restart; SDK Realm close/reopen and reducer tests do not substitute for this.

## Mandatory R4 disposable proof

- [x] Exercise each of seven production transport operations with real encryption and disposable Realm + transactional Relay fixtures, with separate actual saga/hook producer coverage.
- [x] Record valid committed write once, stale data/commit rejection, queued and after-send A→B→A, remote-only/conflicting snapshot, 409/old-route 404/malformed acknowledgement, timeout/lost response and complete readback outcomes per operation.
- [x] Prove vault creation+archive, multi-vault registration and label add/delete fanouts, including successful first member then failure and no later prepared send. Direct native mutation after first actual CAS/held ACK also stops the remaining effects.
- [x] Prove disabled/unconsented accounts send zero writes and successful local create/edit/delete survives cloud failure in the observed producer cases.
- [x] Prove clean Recovery Key restoration from the disposable encrypted backup, validating all intended records and key/policy/registration identity.
- [x] Run revisioned Relay HTTP/transaction source tests against a disposable replica set, including old-writer fences and competing writers. Deployed source/topology and fleet rollout remain open.
- [x] Link exact app/backend SHA, commands, fixture provenance, pass/fail/blocked counts and sanitized evidence in the current matrix; prior logs are not replacements.

## Mandatory critical native backup acceptance

- [ ] IOS: exact-source native build/launch; opted-in automatic create/edit/delete, relaunch persistence, check/readback and clean disposable Recovery Key restore.
- [ ] ANDROID: the same exact-source create/edit/delete, relaunch, readback and clean restore checks.
- [ ] Both platforms: legacy snapshot upgrade, failed/stale/absent check truthfulness, account/consent switching and A→B→A, interrupted/uncertain write/retry, no false verified/empty restore or automatic replacement.
- [ ] Both platforms: local mutation during pending upload/final readback remains pending; interrupted recovery never claims complete; record platform-specific outcomes rather than assuming parity.
- [ ] Record physical-device-only follow-up separately when unavailable; do not use it to defer required fixtures or critical simulator/emulator checks.

## Remaining delivery and NFR gates

- [ ] Independent final-source developer review and current-head CI, with inherited lint/type failures disclosed.
- [ ] Native small-width/enlarged-text, large/single-record frame time, memory, throughput and slow/background cases; distinguish mandatory critical safety failures from explicitly accepted physical-only follow-up.
- [ ] Verify deployed request limits and transaction topology, compatible running Relay artifact and old-writer drain/rollout under existing operator authorization.
- [ ] Refresh store histories/counters and source/artifact manifest; obtain intended merge/signing/submission/deployment/release approval separately.

Checked items describe observed source/disposable proof only. Every unchecked native, infrastructure, review/CI or release task remains open. Reproducibility, Bitkey/Recoverable Wallet and unrelated R4 code stay independent.
