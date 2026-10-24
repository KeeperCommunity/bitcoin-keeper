## Why

The owner confirms R4 / 2.6.4 is live. R5 must use its recorded artifact source
1d8a86a as the baseline and retain its transactional deletion protections while
completing the already-approved bounded key-deletion/startup work.

## What Changes

- Integrate the released R4 source into the isolated R5 branch, preserving R5
  history, R4 refs and the exact released dependency/native/configuration inputs.
- Bind a key-deletion confirmation to its originating account/session so a late
  passcode callback cannot be rebound by dispatch-time middleware.
- Rerun affected automated checks and record finite native acceptance still needed.

## Capabilities

### New Capabilities

- `r5-account-bound-key-deletion`: confirmation ownership across account/session changes.

### Modified Capabilities

None; released R4 backend requirements are preserved.

## Impact

Both mainnet and testnet. Signer, Vault and account/session ownership are affected;
no amount/UTXO, hardware transport, subscription tier, schema or key-material
change. Reuse existing DeleteKeys/KeyCard/KeeperModal/passcode components. Existing
flows/login.yaml remains the startup specification; account-switch/deletion native
checkpoints will be documented without deleting real wallets or contacting providers.
The R5 delta remains within the two-feature, approximately 13k–18k token estimate.

## Non-goals

No R4 branch modification or PR merge, release, backend/protocol change, dependency
upgrade, Receive QR, shared-component rewrite, scaling, Ask Keeper delivery,
private-data transfer or optional Linux setup.

The same existing startup feature must retain its account session across pending
notification tokens and delayed navigation; this is callback ownership, not a
third feature or a change to backend account creation.
