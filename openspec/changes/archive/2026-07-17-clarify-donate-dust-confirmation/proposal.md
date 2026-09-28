## Why

The Donate Dust confirmation currently uses static copy, so users cannot see how many current Do Not Spend UTXOs will be swept, their combined value, or whether any manually marked Do Not Spend coins are included. Before this flow merges, the confirmation should make the donation scope explicit without changing transaction selection behavior.

## What Changes

- Add a dynamic confirmation summary line that states the total Do Not Spend coin count and combined value in satoshis before fees.
- Add a conditional confirmation line when the donation set includes one or more UTXOs that the user manually marked Do Not Spend.
- Keep the current Donate Dust input-selection, fee, and signing flow unchanged.
- Add localized confirmation copy placeholders for the new disclosure lines.

## Capabilities

### New Capabilities


### Modified Capabilities
- `utxo-management`: Manage Coins donation confirmation modal must surface the donation scope before the user proceeds.

## Impact

- Affected files: `src/screens/UTXOManagement/UTXOManagement.tsx`, `src/context/Localization/language/en.json`, and related UI tests for the donation modal.
- Environments: Mainnet and testnet.
- Hardware signer compatibility: No impact. The signing path and PSBT flow remain unchanged.
- Subscription tier gating: None.
- Security/privacy impact: Improves user disclosure before an irreversible donation transaction. No new key-material handling, storage changes, or network calls are introduced.

## Non-goals


- Changing which UTXOs are eligible for Donate Dust.
- Excluding manually marked Do Not Spend coins from the donation flow.
- Changing fee calculation, fee source, recipient address, or transaction review behavior.
- Altering hardware signer protocols or broadcast logic.