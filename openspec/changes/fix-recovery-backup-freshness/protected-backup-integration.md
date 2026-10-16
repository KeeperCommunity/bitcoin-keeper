# Current R4 protected-backup contract

This supersedes older v2 and whole-copy Delete requirements for the owner's approved R4 scope. It does not mark the release complete. Exact source checks and native instructions belong to the newest PR #7045 handoff and the accompanying release evidence.

## Identity and authorization

The Recovery Key derives a separate self-certifying `bk3_` namespace using BIP39 seed bytes, HKDF-SHA256 and hardened BIP32 child0. The isolated supported signing implementation must not use the old wallet signing adapter. Verify that mnemonic, canonical lowercase stored seed and original Keeper App ID agree before enrollment or writing. Preserve all existing wallet, encryption and BIP85 derivations.

The original Keeper App ID continues to own Realm, accounts, provider and billing identity. A backup namespace never replaces it, adopts a legacy account or grants a subscription. Authenticate requests using the fixed ES256K JWS profile, exact body bytes, audience/path/namespace and bounded freshness. Reads and enrollment cannot reset generation, epoch or tombstones.

## Writes and complete verification

All seven automatic operations and explicit full repair use protected v3 transport. Retain the original committed-local receipt, account session, consent epoch, fingerprint and namespace/revision/remote-generation/auth-epoch tuple before asynchronous work. Sequential fanout advances only through each member's own positive acknowledgement. No retry/rebase of uncertain ciphertext, observer uploads or substitution of a newly verified base.

Validate the raw complete projection and its checksum before identity adaptation. Decrypt every recovery record; verify strict protected wallet-map IDs, encrypted label IDs, vault scheme/archive/signer references and complete scoped maps, plus recovery metadata. Only fresh matching local evidence and final synchronous Redux admission can report Verified. The projection checksum is public consistency data, not ownership proof or a server signature.

Status reads do not enroll or write. Explicit opt-in or repair can enroll only within its original source/session/consent scope and approved hosted readiness. Initial absence, enrolled-empty, tombstone, authorization/decryption/protocol/network failure and previously-known namespace conflict stay distinct.

## Delete, disable and recovery

Delete means **Delete protected backup**, including a protected copy created after upgrade. Confirm the scoped acknowledgement, advancing generation/epoch and complete empty tombstone readback before reporting success or disabling consent. Preserve local wallets/keys/Recovery Key, original account/billing identity, server identity/fences/generation and retained older encrypted copies. Disclose that older copies may remain read-only even after upgrading. All-copy erasure is separately unimplemented and unscheduled; no cleanup action is offered.

Turning off automatic updates keeps existing copies and is not Delete. Persisted deletion hints are not fresh verification authority. A lost response remains unconfirmed.

Clean recovery checks the authenticated protected namespace first. Never automatically fall back after absence, tombstone, errors or a known-namespace conflict. A separately selected **Recover an older copy** reads retained legacy data with provenance and a missing-newer-changes warning. Decode and validate the full selected image before the first local write; never report partial/conflicted/unavailable recovery as complete.

A recovery request remains bound to its original request serial as well as account session through asynchronous decrypt/derivation and every consent, Redux and Realm write. Newer discovery cancels the old recovery task and called child generators; cancellation must not emit stale retry or completion. A superseded protected or older-copy request cannot mutate local data or consent.

After validation, revoke target-account automatic-backup consent and expire old queued/opt-in scope before any restore write or producer. This applies even when saved consent was true for a not-yet-selected account. Neither recovery source silently enables or uploads the recovered copy; a later explicit opt-in is separate.

## Acceptance and remaining gates

Historical v2 proof stays historical. Preserve the public fixture/runtime pins and their existing guard; the separately identified exact-private genuine lane must prove current authority/transport/production consumers against real encrypted Realm and transactional loopback Mongo. Unit transport mocks, V8 bundle execution and Hermes bytecode compilation have narrower meanings than that lane or native UI acceptance.

Hosted automatic transport, protected Delete and manual repair remain fenced until actual backend source/runtime/audience/provisioning/index/transaction/drain/ingress/read protection and compatible rollback readiness, review and separately approved enablement. Source tests do not establish deployment. Upgrading old writers requires actual per-platform availability and an approved denial interval; old binaries cannot be promised an upgrade prompt or truthful rejection UI.

Exact-new-SHA IOS and ANDROID builds/install/launch and critical recovery/backup acceptance remain required. HARDWARE stays explicit; only an exact-SHA physical-only owner decision can defer eligible unrun physical checks. No failed critical check, store/artifact/review/channel gate or release approval is waived. Parked C8/navigation work and independence from Reproducibility/Bitkey remain unchanged.
