# Security Policy

Bitcoin Keeper is an open-source, non-custodial bitcoin wallet. We take
vulnerabilities that could affect users, keys, transactions, privacy, or the
integrity of released software seriously.

## Reporting a Vulnerability

Do not report suspected vulnerabilities through public GitHub issues,
discussions, pull requests, social media, or community channels.

Use [GitHub Private Vulnerability Reporting](https://github.com/KeeperCommunity/bitcoin-keeper/security/advisories/new)
to send the maintainers a private report. This is the repository's designated
security reporting channel.

Include as much of the following as you can:

- a clear description of the issue and its security impact;
- the affected app version, commit, platform, and wallet configuration;
- prerequisites and reliable steps to reproduce;
- a minimal proof of concept, logs, or screenshots with sensitive data removed;
- whether the issue applies to mainnet, testnet, or both; and
- any suggested mitigation or fix.

Never include a real Recovery Key, private key, passcode, production signing
material, personal data, wallet balance, or other user secret in a report. Use
fresh testnet-only keys and funds for demonstrations.

Please allow the maintainers a reasonable opportunity to investigate and fix
the issue before public disclosure. We will coordinate disclosure with the
reporter after assessing the impact and remediation.

## Security-Sensitive Areas

Security reports are especially useful when they concern:

- Recovery Key generation, display, backup, confirmation, import, or recovery;
- private-key generation, storage, export, deletion, or leakage;
- Server Key delivery, backup, policy enforcement, or signing;
- signer and signing-device registration, identity, communication, and health;
- multisig descriptors, wallet policy, thresholds, derivation paths, and
  Wallet Configuration Files;
- PSBT creation, parsing, transport, signing, finalization, and broadcast;
- recipient, amount, fee, change-address, UTXO, or network validation;
- wallet migration, key or scheme changes, and Archived Wallet handling;
- Personal Cloud Backup, Assisted Server Backup, restore, and local storage;
- Inheritance Key, Emergency Key, Wallet Timelock, signing delays, and spending
  limits;
- authentication, passcode, biometrics, session locking, and sensitive screen
  exposure;
- deep links, QR codes, NFC, files, hardware-wallet transports, and untrusted
  input handling;
- backend, Electrum, Tor, notification, update, and release-integrity paths; or
- dependencies, build pipelines, platform permissions, and supply-chain risks.

General bugs, feature requests, and UX issues without a security impact belong
in the public issue tracker.

## Architecture and Expected Behavior

The following context may help distinguish vulnerabilities from intentional
behavior. It is not a reason to withhold a report when the observed behavior
could violate the stated security property.

- Bitcoin Keeper is self-custodial. Wallets can be single-key or multi-key.
  Multi-key Wallets require the configured threshold of valid signatures to
  spend. Public wallet metadata, descriptors, extended public keys, addresses,
  or transaction data may be sensitive for privacy, but do not by themselves
  provide spending authority.
- The Recovery Key is the user's 12-word primary backup and is highly sensitive.
  It is distinct from a Wallet Configuration File and from backups belonging to
  external signing devices.
- The Server Key is an assisted key and only one key in a multi-key Wallet.
  Keeper cannot spend bitcoin with the Server Key alone. A finding that lets the
  Server Key bypass the Wallet threshold, signing policy, or configured delay is
  in scope.
- Personal Cloud Backup stores password-protected Wallet Configuration Files.
  Assisted Server Backup stores encrypted app data through Keeper's relay
  infrastructure. Neither is intended to replace the Recovery Key. Plaintext
  key material, a bypass of backup protection, or a backup that unexpectedly
  grants spending authority is in scope.
- Wallet Configuration Files are intended to preserve Wallet structure and
  configuration. They do not contain private keys. Treat privacy leaks,
  malicious descriptor substitution, or any path from configuration data to
  unauthorized signing as security issues.
- Testnet builds, test fixtures, mock secrets, and the Android debug keystore in
  the repository are not production credentials. Report them if they are usable
  against production systems, accepted by a production release path, or expose
  non-test data or authority.
- Source-code references to `vault`, `POLICY_SERVER`, or recovery/seed
  terminology may be legacy internal names for Wallet, Server Key, or Recovery
  Key concepts. A naming difference alone is not a security issue.
- A transaction remaining visible as pending/unconfirmed, and its value being
  reflected in Wallet balance, is expected behavior. Incorrect spendability,
  confirmation handling, replacement handling, or balance manipulation is in
  scope.

When uncertain, submit the report privately. The maintainers would rather
triage a good-faith report than have a potentially serious issue disclosed in
public first.

## Research Guidelines

- Work only with accounts, devices, keys, Wallets, and bitcoin you own or have
  explicit permission to test.
- Prefer testnet and the smallest practical proof of concept.
- Do not access, modify, retain, or disclose another person's data or bitcoin.
- Do not perform denial-of-service testing, degrade shared infrastructure, send
  unsolicited messages, or use social engineering.
- Stop testing and report immediately if you encounter real user data, key
  material, or a path that could move bitcoin without authorization.

This policy does not authorize activity that would otherwise be unlawful or
outside the researcher's permissions.
