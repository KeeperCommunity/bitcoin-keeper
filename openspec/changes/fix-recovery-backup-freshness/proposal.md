# Recovery Key: keep Assisted Server Backup current

## Why

T-060 reproduced a later-created Testnet Mobile Wallet missing from an acknowledged server backup and from recovery with the correct Recovery Key. Permanent loss of wallet keys or funds was not established. Later source review found that a previously verified Relay revision and selected account alone cannot prove that a prepared automatic mutation represents committed local recovery data.

## R4 / 2.6.4 scope

The automatic-backup fix and disposable proof are mandatory R4 work. Critical native iOS/Android backup acceptance also precedes release; physical-device-only follow-up may be recorded separately after release when authorized. Green tests for an earlier repair candidate do not satisfy the automatic-write gate.

- Persist each wallet, signer, vault, label, node or deletion locally before queuing its automatic cloud effect. A cloud failure must retain the committed local result and a truthful pending backup status; server success is not a prerequisite for local creation or deletion.
- Bind each operation to the originating account/session, committed recovery generation and operation ID, plus its originally captured verified remote base. Reject stale work, including A→B→A, rather than substituting new account data or a newer verification for an older action.
- At the per-account queue head, prove the decrypted payload or deletion target against fresh committed local recovery data. Preserve remote-only records and immutable key/policy identity absent an explicit user decision.
- Use the revisioned v2 Relay contract with atomic compare-and-swap. Prefer one transaction for a logical multi-record operation; any sequential fanout must use each acknowledged new revision, revalidate local proof and stop on the first uncertain/failed step.
- Keep the whole backup pending until complete decrypted readback matches fresh local recovery data at the same committed generation and the final atomic verification commit succeeds. A response, intermediate fanout success or content-only readback after a lost acknowledgement does not complete the originating operation.
- Keep upgrade/login checks read-only. Historical mismatch repair remains explicit in Notifications and More → Backup and Recovery → Assisted Server Backup. Transport/decryption failure is never an empty backup or permission to replace it.
- Preserve per-account consent and status, bounded truthful progress, data format, Recovery Key confirmation and failure feedback. Never truncate recovery records or put private material in diagnostics.

## Status and evidence boundary

Audit starting source: b160656218dc6065ad12af9db220c974255bfc23, 13 October 2026. At that baseline, backupPost rejects automatic mutations before network because end-to-end committed-payload proof is missing. Automatic transport may be enabled only after implementation and the required disposable matrix pass; an endpoint name or valid revision is insufficient.

The source now saves logical local operations atomically and proves their committed generation, account/session/consent and payload before revisioned writes and complete readback. The recorded host Realm/transactional HTTP tests support development loopback testing: `AUTOMATIC_BACKUP_SOURCE_READY=true`. `AUTOMATIC_BACKUP_RELAY_ROLLOUT_READY=false` keeps hosted writes fenced. This is source/disposable readiness, with the precise tested cases and remaining gaps recorded in [the current result matrix](automatic-write-validation.md) and [October evidence](evidence/automatic-backup-source-proof-2026-10-13.md).

See [design](design.md), [implementation tasks](tasks.md) and [automatic write readiness](automatic-write-readiness.md). [Validation](validation.md) preserves September results unchanged as historical evidence; they are not exact-head R4 signoff.

Current-source independent review, critical native checks, compatible Relay source/deployment evidence and release approval remain separate gates. No merge, production action or publication is authorized by this proposal. Existing backups missing data still need a device that holds it; this work does not reconstruct arbitrarily missing wallets.
