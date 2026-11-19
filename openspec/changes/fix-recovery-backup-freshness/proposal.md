# Recovery Key: keep Assisted Server Backup current

## Why
T-060 reproduced a later-created Testnet Mobile Wallet missing from an acknowledged server backup and from recovery with the correct Recovery Key. The enabled-backup gate skipped incremental writes when no full backup was pending. Permanent loss of wallet keys or funds was not established.

## What changes
- Enabled backups execute incremental mutations, including wallets not yet persisted to Realm. Pending historical repair does not suppress them.
- Upgraded opted-in accounts check the server against local recovery content without automatically replacing the backup. A mismatch prompts the user through Notifications and More → Backup and Recovery → Assisted Server Backup.
- Back Up Now checks again, prepares the snapshot, uploads and verifies by readback. Matching backups require no upload. Retrieval failure is not treated as an empty backup.
- Show real stages, slow-operation explanation, an immediate Back action, and explicit conflict/unverified states. Preserve per-account status across restart; active spinner state is transient.
- Serialize app, vault, label and deletion writes per account; coalesce repeated repair actions and invalidate completion when local mutations arrive.
- Bound stalled requests and overall attempts; chunk AES work while preserving the existing backup format. Never truncate large records.
- Use the current Recovery Key confirmation reducer after successful recovery. Fix three existing UI branches that enabled Assisted Server Backup or displayed success after server-backup failure.

## Status
Implemented locally in the isolated `keeper-recovery-t060` checkout. Not committed, integrated, deployed or release-approved. Native QA and relay concurrency/label-write limitations remain release gates; see validation.md. Existing backups missing data require the original device to still hold it; this change does not reconstruct arbitrarily missing wallets.
