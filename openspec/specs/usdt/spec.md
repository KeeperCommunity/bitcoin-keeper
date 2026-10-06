# Usdt Specification

## Purpose

The USDT domain owns the complete lifecycle of TRC-20 USDT stablecoin wallets on the
Tron network: wallet creation and import, balance display, receiving funds, gas-free
transfers, transaction history and detail, and wallet settings (rename, hide,
Recovery Key export).

Buy USDT via Ramp Network is **removed from active scope**. The Buy button and Ramp
integration MUST NOT be shown to users.

USDT wallets are labeled **USDT Wallet** in user-facing copy. USDT wallets are
surfaced alongside Bitcoin wallets in the unified home-screen wallet list but are
visually and functionally distinct from all Bitcoin and multi-key entities.

---

## Requirements

### Requirement: USDT Wallet Availability

The app MUST offer USDT wallet creation and import from Settings > Keys & Wallets only when the active Bitcoin network is mainnet. The home Add Wallet control and onboarding MUST lead to Bitcoin wallet flows without a currency picker. On testnet, Settings MUST NOT show the Add USDT Wallet entry point. Moving this entry point MUST NOT delete or migrate existing USDT wallets.

#### Scenario: USDT entry point shown on mainnet (happy path)

- GIVEN the user is authenticated and the app is configured for mainnet
- WHEN the user opens Settings > Keys & Wallets
- THEN an "Add USDT Wallet" item opens a choice to create or import a USDT wallet

#### Scenario: USDT entry point hidden on testnet

- GIVEN the user is authenticated and the app is configured for testnet
- WHEN the user opens Settings > Keys & Wallets
- THEN the "Add USDT Wallet" item is absent

#### Scenario: Add Wallet remains Bitcoin focused

- GIVEN the user is on the home screen on either network
- WHEN the user taps "Add Wallet"
- THEN the Bitcoin wallet create, import, and collaborative wallet choices appear directly
- AND no USDT choice appears in that flow

---

### Requirement: USDT Wallet Creation

The app MUST allow the user to create a new USDT wallet by supplying a name and optional description. The app MUST be derived from the app's primary 12-word Recovery Key using BIP-85 so that it is always recoverable from the primary Recovery Key.

#### Scenario: Create a new USDT wallet (happy path)

- GIVEN the user opens "Add USDT Wallet" in Settings and selects "Create Wallet"
- WHEN the user enters a valid wallet name (up to 18 characters) and optionally a description, then confirms
- THEN a new USDT wallet is created and appears in the home-screen wallet list
- AND the wallet's creation is persisted to the relay server as part of the app image backup

#### Scenario: Wallet name missing

- GIVEN the user is on the USDT wallet creation screen
- WHEN the user attempts to confirm without entering a wallet name
- THEN the app shows a toast error and the creation is not submitted

#### Scenario: Creation fails due to network error

- GIVEN the user has entered a valid wallet name and taps confirm
- WHEN the backend call to initialise the wallet's GasFree account status fails
- THEN the app shows a toast error message and the wallet is not added to the list

---

### Requirement: USDT Wallet Import

The app MUST allow the user to import an existing USDT wallet by providing its BIP-39 mnemonic phrase. The imported wallet MUST be stored separately from derived (default) wallets.

#### Scenario: Import a USDT wallet via mnemonic (happy path)

- GIVEN the user opens "Add USDT Wallet" in Settings and selects "Import Wallet"
- WHEN the user enters the correct seed phrase for an existing USDT wallet
- THEN the wallet is imported and appears in the home-screen wallet list with its corresponding Tron address

#### Scenario: Duplicate mnemonic rejected

- GIVEN a USDT wallet with a particular mnemonic already exists in the app
- WHEN the user attempts to import a second wallet using the same mnemonic
- THEN the app rejects the import with an error message and does not create a duplicate

---

### Requirement: Wallet List Display

The app MUST display all visible USDT wallets in the unified wallet list on the home screen alongside Bitcoin wallets. USDT wallets MUST be visually distinguished from Bitcoin wallets and labeled as "USDT Wallet". The available balance MUST be shown in USDT units.

#### Scenario: USDT wallet appears in wallet list (happy path)

- GIVEN the user has at least one visible USDT wallet
- WHEN the user views the Wallets tab on the home screen
- THEN the USDT wallet card appears in the list, showing the wallet name, its USDT available balance, and a USDT visual identifier

#### Scenario: Available balance excludes frozen amounts

- GIVEN the user has a USDT wallet with a balance of 100 USDT and 10 USDT frozen in a pending transfer
- WHEN the home-screen wallet card is displayed
- THEN the shown available balance is 90 USDT

#### Scenario: Hidden wallet excluded from list

- GIVEN the user has hidden a USDT wallet via its settings
- WHEN the user views the Wallets tab on the home screen
- THEN the hidden USDT wallet does not appear in the list

---

### Requirement: USDT Wallet Details

The app MUST provide a detail screen for each USDT wallet showing the wallet name, available balance, and quick-action controls for sending and receiving. The screen MUST display the most recent transactions and provide navigation to the full transaction history.

Note: Buy USDT is removed from scope. The Buy action MUST NOT be shown.

#### Scenario: Open USDT wallet details (happy path)

- GIVEN the user is on the home screen and at least one USDT wallet is visible
- WHEN the user taps the USDT wallet card
- THEN the USDT wallet detail screen opens, showing the wallet name, available balance in USDT, and action buttons for Send and Receive

#### Scenario: No transactions yet

- GIVEN the USDT wallet has never received or sent any funds
- WHEN the user views the wallet detail screen
- THEN an empty-state illustration is shown in the transactions area and no transaction rows are rendered

---

### Requirement: Receive USDT

The app MUST display the wallet's GasFree receive address as a scannable QR code and as a copyable text string. The screen MUST remind the user to send only USDT TRC-20 to this address.

#### Scenario: View receive address (happy path)

- GIVEN the user is on the USDT wallet detail screen
- WHEN the user taps the Receive button
- THEN the receive screen opens showing a QR code encoding the wallet's GasFree address
- AND the address is also displayed as copyable text below the QR code
- AND a note warns the user: **"Send only USDT TRC-20 to this address. Sending other tokens or using a different network will result in permanent loss of funds."**

---

### Requirement: Send USDT — Recipient Entry

The app MUST require the user to provide a valid Tron network address as the recipient before proceeding to amount entry. The user MUST be able to enter the address manually or scan a QR code. Self-transfers to the sender's own address MUST be rejected.

#### Scenario: Enter recipient via keyboard (happy path)

- GIVEN the user is on the USDT send screen
- WHEN the user types a valid Tron address and taps the proceed button
- THEN the app navigates to the amount-entry screen

#### Scenario: Scan recipient address via QR

- GIVEN the user is on the USDT send screen
- WHEN the user taps the QR scanner icon and scans a QR code containing a valid Tron address
- THEN the scanned address is populated in the recipient field
- AND the user may proceed to the amount-entry screen

#### Scenario: Invalid Tron address rejected

- GIVEN the user has typed a string that is not a valid Tron address for the active network
- WHEN the user taps proceed
- THEN the app blocks navigation and shows an error indicating the address is invalid

#### Scenario: Self-transfer rejected

- GIVEN the user has entered their own wallet's GasFree address as the recipient
- WHEN the user taps proceed
- THEN the app shows an error toast and does not allow the self-transfer to continue

---

### Requirement: Send USDT — Amount Entry

The app MUST present a numeric keypad for the user to enter a USDT amount. The app MUST display the wallet's available balance and support a "Send Max" action that populates the maximum sendable amount after deducting fees.

#### Scenario: Enter a valid send amount (happy path)

- GIVEN the user is on the amount-entry screen with a sender wallet that has sufficient balance
- WHEN the user enters a positive USDT amount that is within the available balance minus fees
- THEN the amount is accepted and the user may proceed to the confirmation screen

#### Scenario: Send Max

- GIVEN the user is on the amount-entry screen
- WHEN the user taps the "Send Max" button
- THEN the amount field is populated with the maximum sendable value, equal to the available balance minus the estimated transfer fee
- AND if the available balance is less than the minimum fee the app shows an error and does not populate any amount

#### Scenario: Insufficient balance

- GIVEN the user has entered an amount that together with the estimated fees exceeds the available balance
- WHEN the user taps proceed
- THEN the app shows a toast error indicating insufficient balance and does not navigate to the confirmation screen

#### Scenario: Account not yet active — pending outgoing transaction warning

- GIVEN the wallet account is not yet activated and a prior outgoing transaction is still pending
- WHEN the user reaches the amount-entry step
- THEN the app shows a warning that the account is not yet active and advises the user to wait before sending again

---

### Requirement: Send USDT — Confirmation

The app MUST present a summary screen showing the sender's address, recipient address, send amount, applicable fees (activation fee if the account is not yet active, plus transfer fee), and total outflow before asking the user to confirm. The confirmation MUST trigger a gas-free permit transfer via the GasFree service.

#### Scenario: Confirm and broadcast (happy path)

- GIVEN the user has reviewed the confirmation screen showing correct sender, recipient, amount, and fees
- WHEN the user taps "Confirm & Proceed"
- THEN the app submits a gas-free permit transfer
- AND on success a toast confirms the transfer and the user is returned to the USDT wallet detail screen

#### Scenario: Activation fee disclosed for new accounts

- GIVEN the sender's GasFree account has never been activated
- WHEN the confirmation screen is displayed
- THEN an activation fee line item is visible in the fee breakdown in addition to the standard transfer fee

#### Scenario: Transfer fails

- GIVEN the user confirms the send
- WHEN the GasFree service returns a failure or the preparation step is invalid
- THEN the app shows an error toast with the failure reason and stays on the confirmation screen so the user can retry

---

### Requirement: USDT Transaction History

The app MUST display the complete list of transactions for a USDT wallet in reverse-chronological order. Each row MUST distinguish sent from received transactions.

#### Scenario: View full transaction list (happy path)

- GIVEN the user is on the USDT wallet detail screen and the wallet has transactions
- WHEN the user taps "View All" in the recent-transactions section
- THEN the transaction history screen opens with all transactions listed, most recent first

#### Scenario: Empty transaction list

- GIVEN the wallet has no transactions
- WHEN the user opens the transaction history screen
- THEN an empty-state view is shown with a "No transactions yet" message

---

### Requirement: USDT Transaction Detail

The app MUST display a detail view for each USDT transaction showing the transaction identifier, direction (sent/received), amount in USDT, timestamp, transaction status, and sender and recipient addresses. Completed transactions MUST link to a public block explorer.

#### Scenario: View a completed (confirmed) transaction (happy path)

- GIVEN the user taps a confirmed transaction in the transaction history
- WHEN the transaction detail screen opens
- THEN the screen shows the transaction ID, direction (Sent or Received), USDT amount, date and time, a SUCCEED status badge, and tapping the transaction ID opens the transaction on Tronscan

#### Scenario: View a pending transaction

- GIVEN the user taps a pending transaction that has a trace ID but no final transaction ID
- WHEN the transaction detail screen opens
- THEN the screen shows the trace ID and a CONFIRMING status badge
- AND tapping the trace ID shows an informational toast indicating the transaction is still being processed

#### Scenario: View a failed transaction

- GIVEN the user taps a failed transaction
- WHEN the transaction detail screen opens
- THEN the screen shows a FAILED status badge alongside the transaction details

---

### Requirement: USDT Wallet Settings

The app MUST provide a settings screen for each USDT wallet allowing the user to
update the wallet name and description, hide the wallet, and export the wallet
Recovery Key. Recovery Key export MUST require PIN or biometric re-authentication.

#### Scenario: Rename wallet and update description (happy path)

- GIVEN the user navigates to USDT wallet settings and selects "Wallet Details"
- WHEN the user edits the name or description and saves
- THEN the updated name and description are reflected on the wallet detail screen and home-screen card

#### Scenario: Hide the wallet

- GIVEN the user is on the USDT wallet settings screen
- WHEN the user taps "Hide Wallet"
- THEN the wallet's visibility is set to hidden
- AND the user is redirected to the home screen
- AND the wallet no longer appears in the home-screen wallet list

#### Scenario: Export Recovery Key — successful authentication

- GIVEN the USDT wallet was created from a mnemonic (default or imported type)
- WHEN the user selects "Wallet Recovery Key" in settings and successfully authenticates with PIN or biometrics
- THEN the app navigates to the Recovery Key export screen showing the wallet's 12-word Recovery Key

#### Scenario: Export Recovery Key — authentication fails

- GIVEN the user selects "Wallet Recovery Key" in settings
- WHEN the user fails PIN or biometric verification
- THEN the app does not reveal the Recovery Key and remains on the settings screen

---

### Requirement: Buy USDT

> **Status: Removed from Active Scope**
>
> The Buy USDT via Ramp Network feature is removed. The Buy button MUST NOT be
> shown in the USDT wallet detail screen or any other user-facing surface.
> The Ramp Network integration code may remain but MUST NOT be invoked.

---

### Requirement: Coin Details (Exchange Rate)

The app MUST fetch and store current BTC and USDT market price data from the BitHyve relay service so that exchange-rate context is available for amount conversion within the app.

#### Scenario: Coin details loaded successfully (happy path)

- GIVEN the app is online and the user is authenticated
- WHEN the coin details are requested
- THEN the current BTC and USDT prices are stored and available for amount conversion displays throughout the USDT flow

#### Scenario: Coin details fetch fails

- GIVEN the relay service is unreachable
- WHEN coin details are requested
- THEN the app handles the failure gracefully without crashing; exchange-rate displays may show a loading or unavailable state

---

## Acceptance Criteria

- USDT Wallet is labeled "USDT Wallet" in user-facing copy.
- Buy USDT via Ramp Network is not shown to users.
- Recovery Key export uses "Recovery Key" language (12-word).
- Receive screen warns about TRC-20 network requirement with permanent loss warning.
- USDT transaction history is owned by this spec (not transaction-history domain).
- No subscription/tier gating remains.

---

## Non-Goals

- This spec does not cover Bitcoin or multi-key wallets; those are owned by the `wallets` and `vault` domains.
- This spec does not define the swap flow (BTC ↔ USDT exchange).
- This spec does not cover UTXO management, coin control, or BIP-329 label import/export for USDT wallets.
- This spec does not cover health checks or signing-device interactions for USDT wallets.
- This spec does not specify Ramp Network's internal purchase or KYC flow.
- This spec does not cover testnet USDT functionality.
