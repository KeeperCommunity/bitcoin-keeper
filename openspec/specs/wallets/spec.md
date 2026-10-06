# Wallets Specification

## Purpose

Wallets owns the complete lifecycle of single-signature Bitcoin hot wallets in
Bitcoin Keeper: creation from the app's 12-word Recovery Key, import from an
extended key or mnemonic, balance and transaction syncing against the configured
Electrum node, wallet settings (rename, describe, hide, delete), and auxiliary
features such as xpub display, message signing, label import/export, and testnet
test-coin requests.

Internally, Keeper uses the term `vault` for all wallet entities in code and
persisted storage. User-facing copy must use **Wallet** throughout.

Buy, Sell, Swap, and Acquire entry points MUST NOT appear in the wallet creation
or wallet management flows. Keeper is a self-custody wallet only.

USDT wallets share the management surface but are classified separately and are
not covered by this spec (see `usdt` domain).

---

## Requirements

### Requirement: Default Wallet Creation

The app MUST allow the user to create a new single-signature Bitcoin wallet by
supplying a name, optional description, and a script type. The wallet MUST be
derived from the app's 12-word Recovery Key using BIP-85 so that it is always
recoverable from the primary Recovery Key. No subscription gating applies.

#### Scenario: Create a native-SegWit wallet (happy path)

- GIVEN the user is authenticated and navigates to the wallet creation screen
- WHEN the user selects the single-key wallet type, enters a name, leaves the description empty, and confirms with the default derivation path (P2WPKH)
- THEN a new wallet appears on the home screen with a zero balance
- AND the wallet is persisted in the relay server so it can be recovered from the primary seed

#### Scenario: Create a Taproot wallet

- GIVEN the user is authenticated and navigates to the wallet creation screen
- WHEN the user selects the single-key wallet type and chooses the P2TR (Taproot) derivation purpose before confirming
- THEN a new Taproot wallet is created and appears on the home screen
- AND the wallet's script type is recorded as P2TR

#### Scenario: Wallet name exceeds character limit

- GIVEN the user is on the wallet creation confirmation screen
- WHEN the user enters a wallet name longer than 18 characters
- THEN the name input enforces the limit and does not accept additional characters

#### Scenario: Duplicate wallet rejected

- GIVEN a wallet derived from a particular BIP-85 child seed and derivation path already exists
- WHEN the app attempts to create another wallet with the same instance number and path
- THEN the app rejects the creation with an error and no duplicate wallet is added

---

### Requirement: Wallet Import

The app MUST allow importing a watch-only or signing wallet using an extended public key (xpub, ypub, zpub, tpub, upub, vpub) or extended private key (xprv, yprv, zprv, tprv, uprv, vprv). The user MUST be able to set a name, description, and choose the script type before completing the import.

#### Scenario: Import a watch-only wallet via xpub

- GIVEN the user navigates to the import wallet flow and provides a valid xpub
- WHEN the user enters a name, optional description, and selects P2WPKH as the script type, then confirms
- THEN a watch-only wallet is created and visible on the home screen
- AND the wallet has no spending capability (no private key is stored)
- AND the wallet detail screen displays: "This wallet can show balances and transactions, but cannot send bitcoin."

#### Scenario: Import a signing wallet via extended private key

- GIVEN the user provides a valid xprv in the import flow
- WHEN the user completes the name and script-type steps and confirms
- THEN a fully-signing wallet is created and the user can initiate sends from it

#### Scenario: Invalid extended key rejected

- GIVEN the user enters a string that is not a valid extended key
- WHEN the user attempts to proceed
- THEN the app displays an error and does not create a wallet

#### Scenario: Duplicate extended key rejected

- GIVEN a wallet already exists for a given xpub fingerprint
- WHEN the user attempts to import the same xpub again
- THEN the app rejects the import and surfaces an error indicating the wallet already exists

---

### Requirement: Wallet Sync

The app MUST sync confirmed and unconfirmed balances, the UTXO set, and transaction history for each wallet via the configured Electrum node. Syncing MUST be triggered on demand (pull-to-refresh or explicit refresh) and automatically in the background.

#### Scenario: Pull-to-refresh syncs the wallet

- GIVEN the user is viewing a wallet's detail screen
- WHEN the user pulls down to refresh
- THEN the app contacts the Electrum node, updates the confirmed and unconfirmed balances, and refreshes the transaction list

#### Scenario: Hard refresh rescans from genesis

- GIVEN the user explicitly triggers a hard refresh
- WHEN the sync completes
- THEN the app rescans address history from the start and reflects any previously missed transactions

#### Scenario: Sync while Electrum node is unreachable

- GIVEN the configured Electrum node is offline or unreachable
- WHEN a sync is attempted
- THEN the app surfaces a network-error message indicating the node could not be reached
- AND the previously cached balances and transactions remain visible

#### Scenario: Incoming transaction triggers in-app alert

- GIVEN a wallet is synced and notifications are enabled
- WHEN the sync discovers a new unconfirmed UTXO arriving on an external receive address
- THEN the app adds an incoming-transaction action item to the alert stack

---

### Requirement: Wallet Visibility

The app MUST allow the user to hide a wallet from the home screen. Hidden wallets
are a visibility/privacy feature. Hidden wallets MUST NOT appear in the default
home-screen wallet list but MUST remain accessible and spendable from the wallet
management settings.

> **Note:** Hidden Wallet (visibility/privacy) and Archived Wallet (auto-created
> after scheme/key migration) are distinct. Archived wallets are not hidden wallets
> and must be unarchived (not unhidden) before use.

#### Scenario: Hide a wallet

- GIVEN the user is in the wallet settings for a visible wallet
- WHEN the user selects the hide-wallet action and confirms
- THEN the wallet no longer appears on the home screen
- AND the user is returned to the home screen

#### Scenario: View and unhide hidden wallets

- GIVEN one or more wallets are hidden
- WHEN the user opens wallet management settings and authenticates with their PIN to reveal hidden wallets
- THEN the hidden wallets appear in the list alongside visible wallets
- AND each hidden wallet shows an option to unhide it

#### Scenario: Hidden wallet still shows correct balance

- GIVEN a wallet is hidden
- WHEN the user navigates to it from the wallet management settings
- THEN the wallet displays its current balance and transaction history without restriction

---

### Requirement: Wallet Settings

A wallet owner MUST be able to rename a wallet and update its description at any time. The changes MUST be reflected on the home screen and synced to the relay server.

#### Scenario: Rename a wallet

- GIVEN the user opens wallet detail settings and selects edit wallet details
- WHEN the user changes the wallet name (up to 18 characters) and saves
- THEN the new name appears on the home screen and in the wallet detail header
- AND the relay server is updated with the new presentation data

#### Scenario: Update wallet description

- GIVEN the user opens the edit wallet details modal
- WHEN the user changes the description (up to 20 characters) and saves
- THEN the updated description is visible in the wallet detail view
- AND the relay server is updated

#### Scenario: Save rejected with empty name

- GIVEN the user opens the edit wallet details modal
- WHEN the user clears the wallet name field and attempts to save
- THEN the save button is disabled and the change is not persisted

---

### Requirement: xpub Display

The app MUST allow the user to view and copy the wallet's extended public key (xpub) from the wallet details settings. This MUST NOT be available for watch-only wallets that were imported via xpub (to avoid circular display).

#### Scenario: View xpub for a hot wallet

- GIVEN the user is in wallet detail settings for a DEFAULT wallet
- WHEN the user selects "Show xPub"
- THEN the app displays the wallet's xpub as text and as a QR code
- AND the user can copy it to the clipboard

#### Scenario: View derivation path

- GIVEN the user is in wallet detail settings
- WHEN the user selects the derivation path option
- THEN the app displays the full BIP-32 derivation path used for the wallet

---

### Requirement: Wallet Seed Access

The app MUST allow the user of a DEFAULT wallet (derived from the primary Recovery
Key) to view the wallet's BIP-85 child Recovery Key after re-authenticating.
Watch-only imported wallets MUST NOT expose this option.

#### Scenario: View Recovery Key after PIN confirmation

- GIVEN the user is in wallet settings for a DEFAULT wallet
- WHEN the user selects "Wallet Recovery Key" and successfully completes the PIN or biometric challenge
- THEN the app displays the wallet's 12-word BIP-85 child Recovery Key
- AND the user can confirm they have recorded them

#### Scenario: Recovery Key option absent for imported wallets

- GIVEN the user is in wallet settings for an imported (watch-only) wallet
- WHEN the user views the settings options
- THEN no "Wallet Recovery Key" option is visible

---

### Requirement: Message Signing

The app MUST allow the user of a DEFAULT wallet (with a private key) to sign an arbitrary text message using one of the wallet's receive addresses, producing a verifiable Bitcoin message signature.

#### Scenario: Sign a message successfully

- GIVEN the user is in wallet settings and selects "Sign message"
- WHEN the user enters a message and an optional specific address, then taps sign
- THEN the app produces a Base64-encoded signature
- AND displays it as text and optionally as a QR code for sharing

#### Scenario: Sign rejected when no address cache is loaded

- GIVEN the wallet has not yet synced and its address cache is empty
- WHEN the user attempts to sign a message without specifying an address
- THEN the app triggers a wallet sync to populate the address cache before proceeding

#### Scenario: Message signing not available for watch-only wallets

- GIVEN the user is in wallet settings for a watch-only imported wallet
- WHEN the settings options are displayed
- THEN no "Sign message" option is visible

---

### Requirement: Label Import and Export

The app MUST allow the user to export and import UTXO and address labels for a wallet in a format compatible with the wallet's output descriptor.

#### Scenario: Export labels

- GIVEN a wallet has one or more labelled UTXOs or addresses
- WHEN the user selects "Import/Export labels" in wallet settings and chooses export
- THEN the app produces a label file and shares it via the system share sheet

#### Scenario: Import labels

- GIVEN the user has a previously exported label file
- WHEN the user selects "Import/Export labels" and chooses import, then selects the file
- THEN the labels are applied to the corresponding UTXOs and addresses in the wallet

---

### Requirement: Test Coin Request

On testnet, the app MUST provide a mechanism within wallet settings to request test coins to the wallet's current receive address via the BitHyve relay.

#### Scenario: Receive test coins on testnet

- GIVEN the app is configured for testnet and the user is in the settings for a testnet wallet
- WHEN the user taps "Receive test sats" and confirms
- THEN the app sends the wallet's receive address to the relay and, on success, triggers a hard sync
- AND a success message is displayed once the test transaction is confirmed

#### Scenario: Test coin request fails

- GIVEN the relay cannot process the test coin request
- WHEN the request completes with a failure
- THEN the app displays an error toast and no balance change occurs

#### Scenario: Test coin option absent on mainnet

- GIVEN the app is configured for mainnet
- WHEN the user views wallet settings
- THEN no "Receive test sats" option is visible

---

### Requirement: Wallet Deletion

A watch-only or zero-balance wallet that is hidden MUST be deletable from the wallet management settings. A DEFAULT wallet with a non-zero balance MUST NOT be deletable until the user first transfers its funds elsewhere.

#### Scenario: Delete a zero-balance hidden wallet

- GIVEN a hidden wallet has a zero balance or is watch-only
- WHEN the user selects the delete action in wallet management settings and confirms
- THEN the wallet is permanently removed from the app and from the relay server

#### Scenario: Delete blocked for wallet with funds

- GIVEN a hidden wallet has a non-zero balance
- WHEN the user attempts to delete it
- THEN the app displays a message instructing the user to transfer funds before deletion
- AND the wallet is not deleted

---

### Requirement: USDT Wallet Distinction

The app MUST distinguish USDT wallets from Bitcoin wallets at every level of the interface. Existing visible USDT wallets MUST remain in the unified home wallet list with a distinct USDT identity. Their creation and import entry point is in Settings > Keys & Wallets.

#### Scenario: USDT wallet remains visible on home

- GIVEN the user has both a Bitcoin wallet and a USDT wallet
- WHEN the user views the main home screen wallet list
- THEN the USDT wallet appears alongside Bitcoin wallets with a distinct USDT identifier and balance unit

#### Scenario: USDT wallet detail remains accessible

- GIVEN the user has a USDT wallet
- WHEN the user taps the USDT wallet card on the home screen
- THEN the USDT wallet detail opens with its balance and transaction history

---

## Acceptance Criteria

- User-facing copy uses Wallet, not Vault.
- Internal `vault` code term may remain.
- Recovery Key (12 words) used in seed-access copy, not "seed words" or "mnemonic".
- Hidden Wallet (visibility/privacy) distinct from Archived Wallet (migration result).
- Unconfirmed transactions are included in wallet balance, shown as pending/unconfirmed.
- Watch-only wallet shows: "This wallet can show balances and transactions, but cannot send bitcoin."
- Buy, Sell, Swap, Acquire entry points are absent from wallet creation and management.
- No subscription/tier gating.
- Existing USDT wallets remain visible in the unified home wallet list with distinct USDT identity.

---

## Non-Goals

- Multi-key wallet creation and management are owned by the `vault` spec.
- The full send flow (fee estimation, PSBT creation, signing, broadcast) is owned by the `send-and-receive` spec.
- Receive address generation and BIP-21 URI handling are owned by the `send-and-receive` spec.
- UTXO coin control, labeling, and freezing are owned by the `utxo-management` spec.
- Transaction history listing, filtering, and per-transaction labels are owned by the `transaction-history` spec.
- Cloud backup and Recovery Key backup flows are owned by the `backup-and-recovery` spec.
- USDT wallet creation, receive, send, and transaction history are owned by the `usdt` spec.
- The Electrum node configuration (host, port, SSL, Tor) is owned by the `settings` spec.

---

### Requirement: Dust Report Entry Point in Wallet Settings

Wallet Settings SHALL include a "Dust Report" row for every wallet. The row SHALL
be wallet-specific and SHALL NOT appear in app-level settings. Tapping the row
SHALL navigate to the Dust Report screen for that wallet.

#### Scenario: User opens Dust Report from Wallet Settings

- GIVEN the user is on the Wallet Settings screen for any wallet
- WHEN the user taps the "Dust Report" row
- THEN the Dust Report start screen opens for that wallet
- AND no other wallet's data is shown

#### Scenario: Dust Report row is present regardless of dust status

- GIVEN the user is on the Wallet Settings screen for a wallet that has no
  classified UTXOs
- WHEN the Wallet Settings screen renders
- THEN the Dust Report row is still visible and tappable

---

### Requirement: Dust Report Entry Point in Vault Settings

Vault Settings SHALL include a "Dust Report" row for every vault. The row SHALL
be vault-specific and SHALL NOT appear in app-level settings. Tapping the row
SHALL navigate to the Dust Report screen for that vault. The `useDustReport` hook
SHALL resolve the entity by checking wallets first, then vaults, so a single hook
call handles both entity types transparently.

#### Scenario: User opens Dust Report from Vault Settings

- GIVEN the user is on the Vault Settings screen for any vault
- WHEN the user taps the "Dust Report" row
- THEN the Dust Report start screen opens for that vault
- AND no other vault's or wallet's data is shown

#### Scenario: Dust Report row is present for all vault types

- GIVEN the user is on the Vault Settings screen for any vault type (single-sig,
  multisig, miniscript, collaborative)
- WHEN the Vault Settings screen renders
- THEN the Dust Report row is visible and tappable
