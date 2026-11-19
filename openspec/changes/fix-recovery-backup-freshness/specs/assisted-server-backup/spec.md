## MODIFIED Requirements

### Requirement: Enabled Assisted Server Backup includes subsequent mutations
The app SHALL upload enabled incremental backup mutations even when no full backup is pending. It SHALL preserve explicit relay rejection semantics and pending repair after transport failure.

#### Scenario: A wallet is created after the initial backup
- **WHEN** an opted-in user creates a Bitcoin wallet on either network after backing up
- **THEN** its encrypted incremental payload is sent before local creation completes
- **AND** a pending historical repair does not skip the new wallet's write

#### Scenario: Backup is disabled
- **WHEN** the user creates or changes a wallet with Assisted Server Backup disabled
- **THEN** the automatic writer and upgrade check make no backup upload

## ADDED Requirements

### Requirement: Upgrade repair requires comparison and user action
The app SHALL compare local recovery content with a decrypted server snapshot for an opted-in unverified account. Retrieval or decryption errors SHALL NOT be interpreted as a mismatch or empty backup.

#### Scenario: Old backup omits local data
- **WHEN** comparison detects recovery data present locally but missing from the backup
- **THEN** show a mismatch and Back Up Now through the existing backup area
- **AND** do not replace the backup until the user starts repair

#### Scenario: Backups match
- **WHEN** canonical recovery content matches
- **THEN** mark that account verified without uploading

#### Scenario: Server-only data or conflicting recovery identity
- **WHEN** comparison detects server-only records, different keys or address counters ahead of this device
- **THEN** preserve the server backup and show the conflict state without upload

### Requirement: Completion means verified recovery content
The app SHALL read back the upload and compare it with the intended snapshot and current local data. It SHALL invalidate completion if a local backup mutation occurs during the operation. A server acknowledgement alone SHALL NOT mark repair complete.

#### Scenario: An upload response is lost
- **WHEN** the request fails after it may have reached the server
- **THEN** attempt readback within the deadline
- **AND** report verified only if the recovery data matches, otherwise leave unverified

#### Scenario: Another local wallet is created during repair
- **WHEN** a mutation arrives during full backup
- **THEN** serialize the incremental write and keep repair unverified until a subsequent check includes it

#### Scenario: The app restarts or changes accounts
- **WHEN** an operation is interrupted or the active account changes
- **THEN** retain unverified state for the original account without clearing another account's pending status

### Requirement: Repair has bounded, accessible progress
The repair screen SHALL expose real checking, preparing, uploading and verifying stages, a slow-operation explanation after ten seconds, and a Back action throughout. It SHALL NOT claim background execution or rollback on navigation. Stalled transport SHALL be aborted, repeated repair actions coalesced, and oversized records rejected without truncation.

#### Scenario: The server stops responding
- **WHEN** no upload/download bytes advance for thirty seconds
- **THEN** abort the transport and return an unverified state with manual checking available

#### Scenario: The user leaves the waiting screen
- **WHEN** Back is selected during repair
- **THEN** navigation remains available and operation status can be revisited in Assisted Server Backup

### Requirement: Failed server backup is not shown as success
Existing backup screens SHALL NOT enable Assisted Server Backup or show server-backup success following backupAllFailure. Physical Recovery Key confirmation remains a separate state.

#### Scenario: Server backup fails after Recovery Key confirmation
- **WHEN** the user confirmed the Recovery Key but server verification fails
- **THEN** retain the physical confirmation and show backup-not-verified feedback without falsely enabling the server backup setting
