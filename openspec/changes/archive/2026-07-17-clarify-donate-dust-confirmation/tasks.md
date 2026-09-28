## 1. UI Components

- [x] 1.1 Update `src/screens/UTXOManagement/UTXOManagement.tsx` to derive the current Do Not Spend UTXO count, gross satoshi total before fees, and manual-mark inclusion flag from the existing donation input set.
- [x] 1.2 Render the new Donate Dust confirmation disclosure lines inside the existing `KeeperModal` content, including the conditional manual-mark notice.
- [x] 1.3 Add localized copy placeholders for the summary line and manual-mark notice in `src/context/Localization/language/en.json`.

## 2. Tests

- [x] 2.1 Add or update Donate Dust confirmation tests to cover the count-and-total disclosure line.
- [x] 2.2 Add or update Donate Dust confirmation tests to verify the manual-mark notice appears only when at least one included UTXO has `isManualOverride === true`.