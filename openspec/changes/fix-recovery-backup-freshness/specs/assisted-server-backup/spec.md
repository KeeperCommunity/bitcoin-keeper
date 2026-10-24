> Current R4 contract: [protected backup integration](../../protected-backup-integration.md) supersedes the historical v2 protocol and whole-copy Delete language below. Prior checked source/fixture boxes are SHA-scoped historical evidence, not protected-v3, native, hosted or release acceptance. Delete now applies only to the new protected copy; older encrypted copies remain read-only. All-copy erasure is outside approved R4 scope, unimplemented and unscheduled.

## MODIFIED Requirements

### Requirement: Enabled Assisted Server Backup includes committed subsequent mutations
The app SHALL automatically back up enabled recovery-relevant changes only after their successful local commit and operation-specific freshness proof. Pending historical repair SHALL NOT discard the local operation, grant consent or substitute for write proof. Server acceptance SHALL NOT be required to preserve local creation, edit or deletion.

#### Scenario: A wallet is created after the initial backup
- **WHEN** an opted-in account creates a Bitcoin wallet on either network after its initial backup
- **THEN** save the wallet locally before queuing its cloud effect
- **AND** capture the committed recovery generation and originating operation/account/session
- **AND** prove its encrypted recovery content against fresh committed local data at queue head before a revisioned write
- **AND** retain the wallet and pending backup state if proof or cloud transport fails

#### Scenario: A local operation fails or commits only partially
- **WHEN** related local writes fail or have not all committed
- **THEN** do not authorize a prepared automatic cloud mutation
- **AND** retain pending/unverified status without reporting the backup or partial operation complete

#### Scenario: Backup is disabled or another account did not consent
- **WHEN** local recovery data changes for a disabled or unconsented account
- **THEN** send no automatic backup mutation
- **AND** preserve local data and the other accounts' choices

## ADDED Requirements

### Requirement: Automatic intent proves committed payload and originating session
Every automatic write SHALL bind its operation ID, committed local recovery generation, originating app/account session and originally captured verified remote revision/epoch. At queue head the app SHALL recheck consent, key ownership and current local recovery content. A revision string alone SHALL NOT authorize a write.

#### Scenario: Local data changes while an action waits
- **WHEN** a queued payload no longer represents its committed local generation or records
- **THEN** reject it before network and keep backup pending
- **AND** do not retry its ciphertext or silently grant it a newly verified base

#### Scenario: The user switches A to B and back to A
- **WHEN** work captured in the first A session resumes after A→B→A
- **THEN** reject the old session before mutation or verified-state commit
- **AND** never select B's encryption key, destination or local persistence for A

#### Scenario: Deletion and identity migration
- **WHEN** a committed deletion or signer-map migration is queued
- **THEN** prove exact local absence/new identity and expected remote target
- **AND** preserve retained vault recoverability and validate exact KeyUID map entries and affected references

### Requirement: Revisioned mutations preserve complete remote recovery content
The app SHALL validate the v2 snapshot and use an atomic expectedRevision precondition through revisionedBackupMutation. A positive acknowledgement SHALL include updated: true, preconditionApplied: true and a valid newRevision. The app SHALL NOT fall back to old incremental or full replacement endpoints after protocol, conflict or transport failure.

#### Scenario: Remote-only or immutable conflicting content exists
- **WHEN** the proposed effect would remove remote-only recovery records or change immutable key, derivation, network, script or policy identity without an explicit user decision
- **THEN** preserve the remote backup and report conflict without sending that effect

#### Scenario: Another server writer wins
- **WHEN** the expected revision is stale or the Relay returns 409
- **THEN** stop the originating operation, preserve local data and leave backup pending
- **AND** re-read before preparing any new write

#### Scenario: The server is old or its response is malformed
- **WHEN** the v2 route returns 404 or acknowledgement/capability/revision validation fails
- **THEN** send no legacy fallback and show pending/unverified feedback

### Requirement: Logical fanout never completes on an intermediate response
A logical multi-record operation SHALL use one atomic revisioned transaction or a serialized sequence that revalidates current local proof and uses each preceding acknowledged newRevision. The whole backup SHALL remain pending until every required effect and final readback complete.

#### Scenario: Registration affects several vaults
- **WHEN** a persisted VaultSigner registration must update multiple vault images
- **THEN** preserve and propagate the committed registration metadata to every affected vault
- **AND** verify complete readback rather than marking success after the first update

#### Scenario: A later fanout member fails
- **WHEN** a prior member succeeds but a later member fails or loses its acknowledgement
- **THEN** stop all remaining prepared members, retain local results and keep pending
- **AND** do not replay the prepared fanout or claim rollback/verified success

### Requirement: Upgrade repair requires comparison and user action
The app SHALL compare local recovery content with a complete decrypted server snapshot for an opted-in unverified account. Retrieval, validation or decryption errors SHALL NOT be interpreted as mismatch or empty backup.

#### Scenario: Old backup omits local data
- **WHEN** comparison detects recovery data present locally but missing remotely
- **THEN** show a mismatch and Back Up Now through the existing backup area
- **AND** do not replace the backup until the user explicitly starts repair

#### Scenario: Backups match
- **WHEN** complete canonical content matches fresh local recovery data and current account/session/generation/protocol checks pass
- **THEN** mark that account verified without an upload

### Requirement: Completion means complete verified recovery content
After all acknowledged effects the app SHALL read back, decrypt and validate the complete backup, compare fresh local content at the same committed generation, and atomically recheck ownership/session/consent/generation before setting verified. A server acknowledgement alone SHALL NOT complete backup.

#### Scenario: An acknowledgement is lost
- **WHEN** a write fails after it may have committed on the server
- **THEN** stop the operation and read back within bounded limits without replaying its ciphertext
- **AND** do not mark that originating write or fanout complete from a content-only match
- **AND** allow a later independent read-only reconciliation to establish a fresh baseline only after all current checks pass

#### Scenario: A local mutation arrives before final completion
- **WHEN** local recovery data changes during upload, readback or immediately before the Redux verification commit
- **THEN** reject the completion claim and retain pending until a fresh comparison includes committed data

#### Scenario: The app restarts or changes accounts
- **WHEN** an operation is interrupted or its selected account/session changes
- **THEN** preserve pending/unverified state for the original account without clearing another account
- **AND** reconstruct fresh work after restart rather than replaying a prepared old payload

### Requirement: Whole-backup deletion uses explicit same-account consent
deleteBackup SHALL require an explicit opt-out for the same selected account/session and validated remote revision. It SHALL preserve the user's consent choice until a positive revisioned acknowledgement, complete empty readback and a current-session/current-consent-epoch final commit, and treat lost responses as uncertain.

#### Scenario: Remote deletion acknowledgement is lost
- **WHEN** explicit opt-out may have deleted the backup but no valid acknowledgement arrived
- **THEN** do not claim deletion or consent-change success
- **AND** preserve local recovery data and reconcile by readback before another deletion attempt

#### Scenario: A newer consent choice arrives before deletion completes
- **WHEN** the user makes a newer off-to-on choice while an older deletion is awaiting its reply or final completion
- **THEN** reject the older consent completion and preserve the newer selected choice
- **AND** retain pending/unverified state without claiming the older operation completed

### Requirement: Repair has bounded accessible progress
The repair screen SHALL expose truthful checking, preparing, uploading and verifying stages, slow-operation explanation after ten seconds and Back throughout. It SHALL NOT claim background execution or rollback. Stalled transport SHALL abort, repeated repair requests SHALL coalesce, and oversized records SHALL fail without truncation.

#### Scenario: Transfer stops progressing
- **WHEN** upload/download bytes do not advance for thirty seconds
- **THEN** abort transport and retain pending/unverified status with manual checking available
- **AND** repeated equal progress values do not reset the stall clock

#### Scenario: The user leaves progress
- **WHEN** Back is selected during repair
- **THEN** keep navigation available and let status be revisited in Assisted Server Backup
- **AND** preserve truthful durable state if the OS interrupts the operation

### Requirement: Failed server backup is not shown as success
Existing backup screens SHALL NOT enable Assisted Server Backup or display success following backup failure. Recovery Key confirmation SHALL remain a separate state.

#### Scenario: Server backup fails after Recovery Key confirmation
- **WHEN** the Recovery Key is confirmed but server verification fails
- **THEN** retain physical confirmation and show backup-not-verified feedback without falsely enabling backup

### Requirement: R4 includes current disposable and critical native proof
The automatic-backup fix SHALL pass the current all-seven-operation disposable matrix, fanout/uncertain-response/final-readback safety proof and critical native IOS and ANDROID backup acceptance before release. Historical repair fixtures or native runs SHALL NOT substitute for exact-source automatic-write proof.

#### Scenario: Only an older repair or desktop fixture passed
- **WHEN** evidence does not exercise the final automatic producers, committed-generation/session proof and compatible transactional Relay
- **THEN** leave the automatic-backup gate open and identify required exact-source checks

#### Scenario: Physical-device-only tests are unavailable
- **WHEN** an explicitly physical-only check cannot run before release
- **THEN** record that separate follow-up honestly
- **AND** do not defer required disposable or critical simulator/emulator backup create/edit/delete/relaunch/readback/restore checks

#### Scenario: A clean Recovery Key restore is tested
- **WHEN** disposable backup content produced by the current automatic pipeline is restored on IOS or ANDROID
- **THEN** verify all intended wallets/networks, keys, active/archived vaults, registrations, labels and nodes
- **AND** fail truthfully on missing/corrupt/unavailable data or interrupted local persistence rather than accepting an empty/partial restore
