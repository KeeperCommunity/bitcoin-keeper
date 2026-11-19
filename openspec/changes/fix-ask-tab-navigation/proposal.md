## Why

T-066: the live iOS 2.5.15 app can retain Ask Keeper prompt text over another
Home tab and lose its bottom navigation. The user confirmed Ask → More on an
iPhone 15 Pro Max, with a screenshot; restarting is currently required. An
earlier Release simulator check also lost navigation after returning from chat
to Ask history. These are related symptoms; shared root cause must be verified.

## What Changes

- Reproduce empty-state tab switching and the chat/history return separately.
- Correct native view ownership at the Home tab-content boundary, with the
  smallest verified change; retain the existing MenuFooter and navigation routes.
- Add repeatable native regression coverage for stale Ask text and reachable tabs.

## Non-goals

No new UX or copy, dependency-wide/native-renderer workaround, chat deletion,
Recovery Key fix, wallet changes, platform feature merge, or release submission.
Any subsequent release must use the existing version/artifact checks and a new
approved version/build; never replace the published 2.5.15 tag or artifacts.

## Impact

Both mainnet and testnet; all tiers. No Wallet, Vault, Signer or UTXO data changes,
key-material access, storage migrations, new network calls or hardware signer
compatibility changes. Native Maestro coverage is required because mocked React
tests do not validate Fabric mounting or on-screen tab placement.
