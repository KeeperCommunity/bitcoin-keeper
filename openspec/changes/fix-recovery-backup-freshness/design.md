> Current R4 contract: [protected backup integration](protected-backup-integration.md) supersedes the historical v2 protocol and whole-copy Delete language below. Prior checked source/fixture boxes are SHA-scoped historical evidence, not protected-v3, native, hosted or release acceptance. Delete now applies only to the new protected copy; older encrypted copies remain read-only. All-copy erasure is outside approved R4 scope, unimplemented and unscheduled.

# Design

This is the R4 contract reconciled on 13 October 2026 from audit starting app head b160656218dc6065ad12af9db220c974255bfc23. The implemented source and observed host Realm/transactional HTTP proof are recorded in [the result matrix](automatic-write-validation.md) and [October evidence](evidence/automatic-backup-source-proof-2026-10-13.md). Source readiness permits development loopback testing; hosted Relay rollout remains disabled. The September native/fixture results in [validation](validation.md) remain historical.

## Entry points, consent and user flow

Reuse More → Backup and Recovery → Assisted Server Backup, AssistedBackupStatus and the existing notification. Login may schedule a read-only comparison for an opted-in pending/unverified account after essential startup/sync work, without awaiting its network result. Account-scoped opt-in never transfers to another account. A legacy global flag is migrated only with evidence of the consenting account.

The status screen keeps real checking, preparing, uploading and verifying stages, slow-operation explanation and an immediate Back action. Leaving does not imply rollback or continued background execution. Durable per-account pending/unverified state survives restart; active spinner state is transient. Different content offers explicit Back Up Now; a failed check reports an unavailable/unverified result, not missing data or permission to replace it. Recovery Key physical confirmation and verified server content are distinct states.

## Local transaction and operation identity

Each logical recovery operation captures the originating app/account, selected-account session, operation ID and originally verified remote revision/epoch before asynchronous work. Local changes are saved first. After all related Realm writes succeed, the operation obtains an account-scoped monotonic committed recovery generation. Pre-write invalidation alone is not a commit token. Failed/partial writes never authorize a cloud mutation or success; retain any local data and a pending result for reconciliation.

New wallets, signers, vaults, node changes and deletions must not depend on server acceptance to persist locally. Producers previously sending encrypted data before Realm insertion/deletion are reordered. If work is interrupted after the local commit, the data and durable pending status survive; restart reconstructs fresh work only after reading local/remote state, not by replaying old ciphertext.

An A→B→A transition invalidates the original A session, even if the same account ID returns. No worker substitutes another account's seed, destination or persistence context. A fresh check cannot retroactively grant an older action a new base revision or committed-generation token.

## Queue-head proof and recovery comparison

The per-account queue covers automatic app/vault/label/deletion mutations and explicit inspection/repair through final readback. Different accounts remain isolated. Each automatic effect must be proved at the queue head using fresh committed local recovery data, account/session, consent, encryption-key ownership, operation ID and generation. Stale action payloads, failed commit, generation/session change or missing intent leave pending without network.

image.ts compares canonical decrypted recovery data with deterministic ordering. Ignore rebuildable chain/balance/sync/receiving-address caches and live connection flags. Retain keys, derivation, address counters, manual UTXO spendability overrides by outpoint, signer/vault policy, archive state, labels, nodes and user metadata. Include both BTC networks, USDT, signers and all referenced vault/label records. Sanitize secrets with existing helpers; checking does not mutate Realm.

Prove additions/updates by decrypting the proposed record and matching its exact ID and recoverable fields with the committed record. Prove deletion by committed local absence and presence in the validated remote snapshot; retained vaults must remain recoverable. migrateXfps uses exact KeyUID map entries, not bare fingerprints, and validates affected vault signer references. Labels use account-derived hashed IDs and current tag content. Whole-backup deletion is a separate explicit same-session opt-out operation; preserve the user's consent choice until a positive acknowledgement, complete empty readback and final current-session/current-consent-epoch commit. A newer off-to-on choice cannot be overwritten by the older deletion completion.

Apply the proposed operation to the validated remote snapshot in memory before send. Reject removal of remote-only recovery records or immutable key/derivation/network/script/policy conflicts without explicit reconciliation. An invalid/partial/decryption-failed response is unavailable, never empty. Repairable registration metadata is distinct from immutable identity and must be preserved and propagated to every affected vault with readback.

## Revisioned server contract and logical fanout

Read getBackupSnapshot through the validated v2 protocol, including a valid 64-character revision and required capabilities. Automatic and explicit repair writes use revisionedBackupMutation; an explicit repair identifies operation repairAppBackup. Never fall back to legacy full replacement or an old incremental route after 404, 409 or protocol failure.

The Relay must atomically compare expectedRevision and apply all effects, preserving recovery records and rejecting ownership/reference/identity conflicts. A valid acknowledgement requires updated: true, preconditionApplied: true and a valid newRevision. Capability advertisement alone is not proof that a particular mutation used a precondition.

Prefer one revisioned transaction for a logical fanout, including new+archived vault migration, registration affecting several vaults, and label import/deletion. If the existing route is used sequentially, every member revalidates its committed local proof and uses the preceding acknowledged newRevision; do not reuse one captured base for all members. Partial success is pending, with local data retained. A failed/uncertain member stops later prepared members. Intermediate responses never mark the whole backup verified.

A request timeout/lost response may have committed on the server. Do not replay its ciphertext or assume a failed server write. Read back before deciding on any fresh write. The originating operation remains pending without a valid acknowledgement; a later independent read-only check may establish a new verified baseline only after complete content, current generation/session and protocol checks. It must not report the interrupted producer or fanout as completed.

## Complete readback and atomic UI completion

After the last acknowledged effect, read back and decrypt the complete server image, validating all referenced records. Compare it with a newly captured local image at the same committed generation. Recheck the originating account/session, consent, generation and operation at the final Redux verification commit. A concurrent local mutation, incomplete response, missing record or immutable conflict invalidates completion. Only this atomic final transition may set verified or clear durable pending state.

BHR defines persisted per-account verification/repair state separately from transient running state. Nullish defaults protect older persisted state. Account switching cannot clear another account's pending flag or grant its backup consent. Interrupted state returns to pending/unverified until a fresh read-only comparison completes. The host fixture uses real reducers and extracted production store hooks/origin middleware; it does not prove MMKV persistence or native app relaunch. Those checks remain in the required IOS/ANDROID matrix. No Realm schema migration is authorized by this document.

## NFR and restore boundaries

Existing engineering bounds are a 30-second no-progress transport abort and a ten-minute overall deadline. Genuine upload/download byte progress resets the stall timer; repeated equal byte counts do not. They remain provisional until native/deployed request-limit checks pass. Error reporting excludes Axios bodies/headers and private recovery material.

Crypto yields between 16 KiB chunks while retaining the existing OpenSSL format. Record/aggregate limits reject oversized data without truncation or verified success. Realm extraction, JSON, Base64 and UTF-8 still contain synchronous work; desktop timing is not native frame-time or memory acceptance. Preserve [the NFR review](nfr-review.md) as historical benchmarks and an open measurement plan.

Recovery predecodes the complete image and validates referenced vault/label identity before persistence. Failed local persistence or a derived Recovery Key identity mismatch prevents success; no failed records are skipped. Local restoration currently has sequential writes, so interruption may leave partial local records without completing recovery. Exact-head disposable and native clean/retry/interruption restore checks are mandatory before release. A correct Recovery Key with unavailable/corrupt backup receives retry feedback, not an incorrect-words error.

## Release gates

The automatic fix, all seven operation proofs, fanout/failure/readback matrix and critical iOS/Android backup tests are required R4 work, not a post-release waiver. Physical-device-only checks may be separately reported after release when authorized. Old-client/fenced-writer behavior needs exact-source disposable replica-set/HTTP proof; production transaction topology, running artifact, request limits and legacy-writer drain/rollout remain separately gated by operator access and explicit authorization. Source readiness is not deployed-service evidence.
