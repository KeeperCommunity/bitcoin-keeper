# Settings Specification

## Purpose

Settings owns app preferences, security/privacy settings, wallet management entry
points, network settings, support/diagnostics entry points, donations, and
legal/about links.

Settings MUST include a **Support Keeper / Donate** entry point. Donations are
optional and MUST NOT block wallet creation, backup, recovery, signing, sending,
receiving, or support access.

Diagnostics must require permission and must never collect:
- Recovery Key
- Passcode/PIN
- Private keys
- Signer seed material
- Biometric data

Settings grouping should separate:
- App preferences
- Security and privacy
- Wallet management
- Network/node settings
- Support and diagnostics
- Donations/support project
- Legal/about links

---

## Requirements

### Requirement: USDT wallet creation entry point

On mainnet, Settings > Keys & Wallets MUST show "Add USDT Wallet". It MUST open the existing USDT create/import choice. On testnet, the entry point MUST be absent. Moving this entry point MUST NOT remove existing USDT wallets or change their send, receive, GasFree, backup, or management behavior.

#### Scenario: Open USDT wallet creation from Settings

- GIVEN the user is on mainnet
- WHEN the user opens Settings > Keys & Wallets and taps "Add USDT Wallet"
- THEN the user can choose "Create Wallet" or "Import Wallet"

#### Scenario: USDT creation unavailable on testnet

- GIVEN the user is on testnet
- WHEN the user opens Settings > Keys & Wallets
- THEN "Add USDT Wallet" is not shown

---

### Requirement: Node Configuration

The app MUST allow the user to add, connect, disconnect, and delete custom Electrum
servers. Each server is configured with a host, port, and SSL toggle. Only one server
may be actively connected at a time. The app MUST offer a curated list of public
servers alongside the option to enter a private server manually or by scanning a QR
code. When the user connects to a new server the previously connected server MUST be
disconnected first. A server that is currently connected MUST require explicit
disconnection confirmation before it is deleted.

#### Scenario: Add and connect a private Electrum node

- GIVEN the user is on the Node Settings screen
- WHEN  the user taps "Add New Node", enters a host, port, and SSL preference, and
  saves
- THEN  the app attempts to connect to the specified server
- AND   on success a toast confirms the connection and the node appears in the list
  marked as connected

#### Scenario: Connection to private node fails

- GIVEN the user enters an unreachable host and port
- WHEN  the user saves the new node
- THEN  the app displays an inline connection error message
- AND   the node is not added to the saved list

#### Scenario: Connect to a predefined public server

- GIVEN the Node Selection screen is open showing the Public Servers tab
- WHEN  the user selects a predefined server from the list
- THEN  the app connects to that server and returns to the Node Settings screen with
  the newly connected server shown as active

#### Scenario: Scan QR to add a node

- GIVEN the user is on the Node Selection screen
- WHEN  the user opens the QR scanner and scans a valid Electrum server QR
- THEN  the host and port fields are pre-populated from the QR data
- AND   the user can save and connect without re-entering the details manually

#### Scenario: Delete a connected node

- GIVEN a node is currently connected
- WHEN  the user requests to delete that node
- THEN  the app shows a disconnection warning modal before proceeding
- AND   on confirmation the node is disconnected, deleted, and removed from the list

#### Scenario: No node connected warning

- GIVEN the node list is empty or no node is connected
- THEN  the app displays a warning note indicating that no node is connected

---

### Requirement: Tor Routing

The app MUST allow the user to enable Tor routing for all network traffic. Two Tor
methods are available: in-app Tor and Orbot (system-level). The app MUST display the
current Tor connection status (OFF, CONNECTING, CONNECTED, ERROR, CHECKING) at all
times on the Tor Settings screen. When Orbot is selected the app MUST open the Orbot
application and check connection status when the app returns to foreground.

#### Scenario: Enable Tor via Orbot

- GIVEN the user is on the Tor Settings screen and Tor is currently OFF
- WHEN  the user taps "Tor via Orbot" and confirms in the modal
- THEN  the app opens Orbot and sets the status to CHECK_STATUS
- AND   when the user returns to the app the connection status is refreshed

#### Scenario: Tor connection status reflects current state

- GIVEN the user is on the Tor Settings screen
- WHEN  the screen loads or the refresh icon is tapped
- THEN  the app checks the Tor connection and updates the status label accordingly
  (Connected, Disabled, Connecting, or Error)

#### Scenario: Tor connection fails

- GIVEN the user has enabled Tor
- WHEN  the connection cannot be established
- THEN  the status label shows "Error"
- AND   a refresh button is visible so the user can retry

---

### Requirement: Bitcoin Network Selection

The app MUST allow the user to switch between Mainnet and Testnet. Switching network
MUST disconnect the current Electrum node, update the active network, connect to
default nodes for the new network, create a default wallet and signer for the new
network if one does not already exist, and re-fetch fee rates. The user MUST confirm
the network change before it is applied.

#### Scenario: Switch from Mainnet to Testnet

- GIVEN the current network is Mainnet
- WHEN  the user selects Testnet and confirms the change
- THEN  the app switches to Testnet, syncs with a Testnet Electrum node, and shows
  a success toast
- AND   all wallet and vault views reflect Testnet balances and addresses

#### Scenario: Network switch fails

- GIVEN the user has initiated a network switch
- WHEN  the Electrum connection for the new network cannot be established
- THEN  the app shows an error toast
- AND   the network setting remains on the previous value

#### Scenario: Confirm dialog prevents accidental switch

- GIVEN the user has selected a new network in the modal
- WHEN  the user taps Cancel instead of Confirm
- THEN  the network is not changed and the modal closes

---

### Requirement: Display Currency

The app MUST allow the user to select a fiat currency from a supported list for
displaying BTC values. Exchange rates MUST be fetched from an external rate source on
login and after network switches. If the selected currency does not have a current
exchange rate available the app MUST alert the user and decline to apply the change.

#### Scenario: Change display currency to EUR

- GIVEN the user is on the General Preferences screen and the current currency is USD
- WHEN  the user opens the currency picker and selects EUR
- THEN  all BTC-denominated amounts across the app are shown in EUR using the latest
  fetched exchange rate

#### Scenario: Currency without exchange rate rejected

- GIVEN the exchange rate for a particular currency is not available
- WHEN  the user attempts to select that currency
- THEN  the app shows an alert explaining the rate is unavailable
- AND   the active currency code remains unchanged

#### Scenario: Exchange rate unavailable (network failure)

- GIVEN the device cannot reach the exchange rate API
- WHEN  the app attempts to refresh rates
- THEN  a toast informs the user that rates could not be updated and values may be
  outdated
- AND   the previously cached rates are used for display

---

### Requirement: Unit Display (Sats Mode)

The app MUST allow the user to toggle between BTC and satoshis as the primary display
unit. The selected unit MUST be reflected immediately across all balance, fee, and
amount displays throughout the app.

#### Scenario: Enable sats mode

- GIVEN the current display unit is BTC
- WHEN  the user enables the sats toggle on the General Preferences screen
- THEN  all amounts in the app switch to satoshi display immediately

#### Scenario: Disable sats mode

- GIVEN the current display unit is satoshis
- WHEN  the user disables the sats toggle
- THEN  all amounts revert to BTC display immediately

---

### Requirement: Theme (Dark / Light Mode)

The app MUST allow the user to switch between Light and Dark themes. The selected
theme MUST persist across app restarts. Users on the Keeper Private subscription tier
MUST be assigned a PRIVATE theme variant automatically when the dark mode toggle is
active.

#### Scenario: Switch to dark mode

- GIVEN the app is in Light mode
- WHEN  the user enables the Dark Mode toggle on the Settings screen
- THEN  the entire app UI switches to the dark colour palette immediately
- AND   on subsequent launches the app opens in Dark mode

#### Scenario: Switch back to light mode

- GIVEN the app is in Dark mode
- WHEN  the user disables the Dark Mode toggle
- THEN  the app UI reverts to the light colour palette immediately

#### Scenario: Keeper Private tier forces PRIVATE theme variant

> **Note:** Subscription tiers (Keeper Private, Hodler, Diamond Hands, Pleb, L1–L4)
> are removed from Keeper. The PRIVATE theme variant is no longer subscription-gated.
> If a theme variant remains, it must not require a subscription.

---

### Requirement: Language Selection

The app MUST allow the user to select the app language from the supported list. The
currently selected language MUST be shown at the top of the picker. The UI MUST
update to the chosen language immediately upon selection.

#### Scenario: Change app language

- GIVEN the user is on the General Preferences screen and the current language is
  English
- WHEN  the user opens the language picker and selects a different language
- THEN  the app UI text switches to the selected language immediately
- AND   the selected language persists across app restarts

#### Scenario: Single language available

- GIVEN only English is in the available languages list
- WHEN  the user opens the language picker
- THEN  English is shown as the only option and is already selected

---

### Requirement: Login Method

The app MUST allow the user to switch between PIN and biometric (Touch ID / Face ID)
authentication. When enabling biometrics the app MUST first verify that a biometric
sensor is available on the device. If biometrics are not enabled in the device
operating system the app MUST surface a prompt directing the user to device Settings.
Switching to biometric MUST require biometric verification before the change is
applied. Switching back to PIN MUST require no additional verification.

#### Scenario: Enable biometric authentication

- GIVEN the user is on the Privacy & Display screen and PIN login is active
- AND   a biometric sensor is available and enabled on the device
- WHEN  the user enables the biometric toggle
- THEN  the device biometric prompt appears for verification
- AND   on success the login method changes to biometric

#### Scenario: Biometric not available on device

- GIVEN the user is on the Privacy & Display screen
- AND   no biometric sensor is available or biometrics are disabled in device settings
- WHEN  the user attempts to enable the biometric toggle
- THEN  the app shows an error toast indicating that biometrics are not enabled
- AND   a shortcut to device Settings is offered to allow the user to enable biometrics

#### Scenario: Disable biometric and revert to PIN

- GIVEN the user is on the Privacy & Display screen and biometric login is active
- WHEN  the user disables the biometric toggle
- THEN  the login method reverts to PIN immediately

---

### Requirement: PIN Change

The app MUST allow a logged-in user to change their PIN by first verifying the current
PIN. After current PIN verification the user MUST enter and confirm a new PIN. The
change MUST be committed only when the new PIN and its confirmation match. A health
check seed confirmation step MUST be presented before the PIN change is applied when
backup history exists.

#### Scenario: Successful PIN change

- GIVEN the user is on the Privacy & Display screen
- WHEN  the user taps "Change Passcode", enters the current PIN correctly, completes
  the health check confirmation if required, then enters and confirms a new PIN
- THEN  the PIN is updated and a success toast is shown

#### Scenario: New PIN and confirmation do not match

- GIVEN the user is entering a new PIN
- WHEN  the confirmation PIN does not match the new PIN
- THEN  an inline mismatch error is shown
- AND   the PIN change is not applied until both fields match

#### Scenario: Current PIN entered incorrectly

- GIVEN the user taps "Change Passcode"
- WHEN  the user enters an incorrect current PIN
- THEN  the verification modal shows an error
- AND   the PIN change flow does not proceed

---

### Requirement: Wallet Management

The app MUST provide a Manage Wallets screen that lists all wallets and USDT wallets
(both visible and hidden). From this screen the user MUST be able to:
- Hide a wallet (visibility/privacy)
- Unhide a hidden wallet (after PIN verification)
- View archived wallets (automatically created after scheme/key migration)
- Delete an empty or watch-only wallet

**Hidden Wallet** is a visibility/privacy feature. Hidden wallets do not appear in
the normal wallet list but remain accessible and spendable.

**Archived Wallet** is automatically created after wallet scheme/key migration.
Archived wallets are not active by default and must be unarchived before use.
Archiving is not a normal user action.

Deletion of a wallet that still holds a balance MUST be blocked until funds are moved.

#### Scenario: Hide a wallet

- GIVEN the user is on the Manage Wallets screen
- WHEN  the user taps "Hide" on a visible wallet
- THEN  the wallet is removed from the home screen wallet list
- AND   it remains accessible on the Manage Wallets screen under the hidden section

#### Scenario: Unhide a wallet requires PIN

- GIVEN a wallet is hidden on the Manage Wallets screen
- WHEN  the user taps "Unhide" on that wallet
- THEN  a PIN verification modal is presented
- AND   on success the wallet's visibility is restored to default

#### Scenario: Show all hidden wallets requires PIN

- GIVEN there are hidden wallets on the Manage Wallets screen
- WHEN  the user taps "Show Hidden Wallets" at the bottom
- THEN  a PIN verification modal is presented
- AND   on success all hidden wallets are displayed in the list

#### Scenario: Delete empty wallet

- GIVEN the user is on the Manage Wallets screen
- AND   the wallet has zero balance or is watch-only
- WHEN  the user taps "Delete" and confirms the passcode prompt
- THEN  the wallet is permanently removed

#### Scenario: Delete wallet with balance blocked

- GIVEN a wallet has a non-zero balance and is not watch-only
- WHEN  the user attempts to delete it
- THEN  a modal informs the user that funds must be moved first
- AND   an option to navigate to the send flow is provided
- AND   the wallet is not deleted

---

### Requirement: Multi-User Accounts

The app MUST allow up to 10 independent user accounts to be created on the same
device. Each account is a fully isolated app instance with its own PIN and wallet
data. When biometric login is active on the current account, the user MUST disable
biometrics before adding a new user account.

#### Scenario: Add a new user account

- GIVEN the user is on the Multi-User screen
- AND   fewer than 10 accounts exist on the device
- AND   PIN login is active for the current account
- WHEN  the user taps "Add User"
- THEN  the app creates a new isolated account and navigates to the PIN creation flow
  for that account

#### Scenario: Add user blocked by biometric

- GIVEN biometric login is active for the current account
- WHEN  the user taps "Add User" on the Multi-User screen
- THEN  a modal prompts the user to disable biometric login before adding a new account

#### Scenario: Maximum accounts reached

- GIVEN 10 accounts already exist on the device
- THEN  the "Add User" button is disabled and cannot be tapped

---

### Requirement: Privacy and Display Options

The app SHOULD allow the user to control analytics opt-in and other privacy-related
display preferences accessible from the Privacy & Display screen.

#### Scenario: Access Privacy & Display settings

- GIVEN the user is on the main settings screen
- WHEN  the user taps "Security & Login"
- THEN  the Privacy & Display screen opens showing login method toggle, passcode
  change, and any applicable privacy options

---

### Requirement: App Version History

The app MUST display a changelog of recent version updates accessible from the
Settings screen. The user's public app ID MUST also be visible on this screen for
support purposes.

#### Scenario: View version history

- GIVEN the user is on the Settings screen
- WHEN  the user taps "Version History"
- THEN  a scrollable list of version entries is displayed in chronological order
- AND   the user's app ID is shown at the bottom of the screen

---

### Requirement: General Preferences Screen

The app MUST group currency, sats toggle, and language selection into a single
General Preferences screen accessible from the Settings menu.

#### Scenario: Navigate to General Preferences

- GIVEN the user is on the main Settings screen
- WHEN  the user taps "General Preferences"
- THEN  the General Preferences screen opens showing the currency picker, sats mode
  toggle, and language picker

---

### Requirement: Support Keeper / Donate

The app MUST provide a **Support Keeper / Donate** entry point in Settings.
Donations are optional. Donation copy should explain that donations help maintain
the project. Donations MUST NOT block wallet creation, backup, recovery, signing,
sending, receiving, or support access.

#### Scenario: User opens Donate / Support Keeper

- GIVEN the user is on the Settings screen
- WHEN  the user taps "Support Keeper" or "Donate"
- THEN  the donation screen is displayed with an explanation of how donations
  support the project
- AND   the donation flow does not require any previous wallet or account action

---

## Acceptance Criteria

- Settings includes Donate / Support Keeper.
- Donations are optional and non-gating.
- No subscription/tier settings remain (no Pleb, Hodler, Diamond Hands, L1/L2/L3/L4,
  upgrade prompt, Restore Purchases, Keeper Private subscription theme).
- User-facing copy uses Wallet, not Vault.
- Hidden Wallet (visibility/privacy) and Archived Wallet (result of migration) are distinct.
- Archived Wallet must be unarchived before use.
- Diagnostic sharing excludes secrets (Recovery Key, PIN, private keys, signer seed material, biometric data).

---

## Non-Goals

- This spec does not cover the cloud backup or Recovery Key backup flows themselves;
  those are owned by `backup-and-recovery`, even though entry points to those flows
  exist in the Settings navigation hierarchy.
- This spec does not cover Canary Wallet creation; that is owned by the `vault`
  domain.
- This spec does not cover wallet creation, renaming, or sync behaviour; those are
  owned by the `wallets` domain.
- This spec does not define exchange rate data sources or frequency of refresh beyond
  what is observable in the UI.
- This spec does not define the internal implementation of Tor tunnelling or the
  specific Orbot integration protocol.
