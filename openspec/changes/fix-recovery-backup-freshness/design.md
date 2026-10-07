# Design

## Entry points and user flow
Reuse More → Backup and Recovery → Assisted Server Backup. The row opens `AssistedBackupStatus`; its existing switch retains enable/delete behavior. The existing server-backup notification opens the same status screen. Login dispatches a read-only check after wallet sync for opted-in accounts with pending/unverified status. Login does not await the result.

The status screen uses ScreenWrapper, WalletHeader, KeeperText, Buttons, themed cards and a ScrollView. Body text explicitly enables system font scaling. Full-width actions are stacked. Back is available throughout and does not cancel or imply rollback. No progress percentages or promises of continued background execution are shown.

Copy is maintained in `recoveryBackup` in both existing locale JSON files. States: disabled, checking, different, preparing, uploading, verifying, verified, conflict, unverified. Different offers **Back Up Now**; terminal enabled states offer **Check Again**. Slow-stage text appears after ten seconds. Restart maps persisted in-progress phases to unverified until the new check starts.

## Backup comparison and repair
`src/services/backup/image.ts` compares canonical decrypted recovery data, with deterministic object ordering. Exclude rebuildable chain caches, balance, sync timestamps, receiving-address caches and live node connection flags. Retain user-authored manual UTXO spendability overrides by outpoint, independent of confirmation/cache ordering. Retain keys, derivation, address counters, signer policy, vault policy/archive state, labels and user metadata. Include BTC wallets from both networks, USDT, signers, vaults, nodes and labels. Sanitize local signer/vault secrets using the existing helpers and never mutate Realm during checking.

Server-only records, differing key identities and server address counters ahead of local data produce conflict with no upload. Invalid/decryption-failed/partial responses produce unverified with no upload. Capture a local snapshot and check it again before upload and completion. Final success requires the uploaded recovery data to match the server readback and current local recovery data.

A lost upload response has an ambiguous outcome. Attempt readback within the same overall deadline. A matching readback is sufficient for verified success; otherwise keep unverified and let the user check again. No automatic retry loop or repeated full upload on startup.

## Ordering and persistence
All client backup mutation endpoints use a shared per-account queue in `transport.ts`; full inspection owns the queue through readback. Pending incremental writes increment an account revision and invalidate any in-flight completion claim. Vault `appID` and `appId` payload variants share the correct account queue. A new wallet's incremental write is never replaced with a pre-creation snapshot.

BHR is separately persisted. `backupRepairStateByAppId` and `backupRepairCompletedByAppId` are durable; `backupRepairRunningByAppId` is blacklisted. Only phase verified sets completion. Old persisted states use nullish defaults. Account changes cannot clear the next account's pending flag or enable its backup setting. No Realm migration is needed.

## NFR implementation and remaining limits
Transport aborts after 30 seconds without advancing upload/download bytes, with a ten-minute overall attempt deadline. Both are engineering limits requiring native/deployed-backend validation. Progress callbacks reporting the same byte count do not extend the timer. Error messages discard Axios request bodies/headers. No new telemetry is added.

AES encrypt/decrypt yields between 16 KiB chunks using CryptoJS's existing OpenSSL format. Local JSON text is guarded using a conservative three bytes per UTF-16 code unit against an 8 MiB record budget; encrypted aggregate payloads are limited to 32 MiB. Reject oversized data without truncation or verified success. Realm extraction, JSON serialization/parsing, Base64 conversion and UTF-8 decoding still have synchronous sections; native frame-time and memory budgets are NOT established by these guards or desktop tests.

## Server contract and release gates
Repair now requires `getBackupSnapshot` and `repairAppBackup` from the paired relay candidate. The snapshot returns a SHA-256 revision over encrypted recovery records. Repair supplies that revision and rechecks it inside a MongoDB snapshot transaction. Vaults, labels, signer maps and the app image update atomically; stale revisions, missing referenced records and attempts to omit existing recovery records fail closed. Existing label IDs update their encrypted content. Archived metadata is preserved. No fallback to the legacy full replacement endpoint is permitted.

Local database and HTTP tests establish this contract for the new endpoints. Production requires a transaction-capable replica set, compatible deployed request limits and relay deployment before the mobile update. Those deployment facts are not yet verified.

The legacy full-backup endpoint remains callable by older clients and does not participate in the new revision contract. Mixed-version full replacement remains an unresolved release gate. Normal incremental wallet/signer updates in the relay candidate now set individual records atomically, including a version-only call without `nodes`, but that does not make every legacy mutation transactional. Server-only/conflicting data is preserved pending reconciliation.

## Restore integrity follow-up

Actual Recovery Key restoration predecodes the complete server image, verifies referenced vault/label identities, and requires each local persistence operation to succeed. A failed fetch cannot masquerade as an empty backup. Success is exposed only after the expected derived Recovery Key signing material is present; failed records are not skipped. Database writes remain sequential rather than one atomic transaction. A correct Recovery Key with unavailable/corrupt backup receives retry feedback instead of an incorrect-words error. Existing private-material policy is preserved per key type.
