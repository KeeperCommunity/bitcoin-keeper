## ADDED Requirements

### Requirement: Donate Dust Confirmation Disclosure

When the user opens the Donate Dust confirmation from the Manage Coins screen, the app MUST display an explicit summary of the current donation scope before the transaction is built.

The summary MUST be derived from the current set of `UTXO` entries on the active `Wallet` or `Vault` where `spendability === 'doNotSpend'`.

The confirmation MUST show:
- the total count of current Do Not Spend UTXOs
- the combined value of those UTXOs in satoshis before fees

If one or more included `UTXO` entries have `isManualOverride === true`, the confirmation MUST additionally state that the donation includes coins the user manually marked Do Not Spend.

#### Scenario: Confirmation shows Do Not Spend count and total before fees
- **GIVEN** the active `Wallet` or `Vault` has 3 current `UTXO` entries with `spendability === 'doNotSpend'`
- **AND** their values total 2500 satoshis
- **WHEN** the user opens the Donate Dust confirmation from Manage Coins
- **THEN** the confirmation MUST state that all 3 Do Not Spend coins will be donated
- **AND** the confirmation MUST state that the total is 2500 satoshis before fees

#### Scenario: Confirmation shows manual-mark inclusion notice when applicable
- **GIVEN** the active `Wallet` or `Vault` has at least 1 current `UTXO` with `spendability === 'doNotSpend'`
- **AND** at least 1 of those `UTXO` entries has `isManualOverride === true`
- **WHEN** the user opens the Donate Dust confirmation from Manage Coins
- **THEN** the confirmation MUST state that the donation includes coins the user manually marked Do Not Spend

#### Scenario: Confirmation omits manual-mark inclusion notice when not applicable
- **GIVEN** the active `Wallet` or `Vault` has current `UTXO` entries with `spendability === 'doNotSpend'`
- **AND** none of those `UTXO` entries has `isManualOverride === true`
- **WHEN** the user opens the Donate Dust confirmation from Manage Coins
- **THEN** the confirmation MUST NOT display the manual-mark inclusion notice
