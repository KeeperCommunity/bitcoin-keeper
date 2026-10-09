# Recovery Contact: client boundary

Status: **state model only**. `src/services/wallets/recoverable/contactRecoveryFlow.ts` has no key, cloud, contact-transport, or cryptographic implementation. No preview screen may report enrollment or recovery as complete from these states.

## Proposed independent route

Recovery Contact is distinct from the Inheritance Key, hardware signer, Server Key, and Keeper Recovery Key. The intended route restores only this wallet's Mobile Key from a separate encrypted backup, plus the wallet descriptor needed to find its funds. It does not reset Keeper or give the contact a signing role. The user must still pair the recovered Mobile Key with another signer to spend.

The first security option is access to the user's separate encrypted cloud backup **and** approval from an enrolled contact. A stronger option also requires a user-held recovery code. Both are represented in the state model; neither is selected as a product default yet. The owner must decide whether the extra code is worth its backup burden. With the first option, a malicious contact who also obtains the cloud blob could recover the Mobile Key, though that alone is insufficient for this wallet's 2-of-3 spend.

An eventual client implementation should generate a fresh random backup encryption key, encrypt the Mobile Key and descriptor with an audited authenticated-encryption implementation, and store only ciphertext in a dedicated preview iCloud/Google Drive location. The contact device keeps a separate recovery credential. Enrollment must cryptographically wrap the backup key to that credential and perform a cloud download plus authenticated decrypt of the stored result. The current reducer checks only that the downloaded ciphertext digest matches the written digest; that is **not** cryptographic readback verification. The existing Keeper CloudBackup module writes configuration PDFs in shared/default storage and cannot be reused for Mobile Key backup.

On a replacement phone, the client should download the encrypted blob, create an ephemeral replacement-device public key and one-time request, then exchange the request and response directly with the contact by QR or an external share channel. The contact must identify the person asking through a separate, human-verifiable check before approval. A reviewed encryption implementation must bind the contact's response to the wallet, request nonce, expiry, enrolled credential, and replacement-device key. The request and response must work while Keeper SigningServer and Relay are unreachable. A contact approval is not itself a decrypted backup or restored key.

The request and cloud receipt use a 32-byte public `walletPolicyHash`, not Bitcoin's 4-byte master fingerprint. A future implementation must derive this commitment from the **canonical final public policy/descriptor**, persist it with the encrypted backup, and verify it during restore. This state model checks its format and equality only; it cannot prove the hash was derived correctly or that the descriptor is authentic.

## What the state model enforces now

- Enrollment and lost-phone recovery have separate state machines. Cloud unavailable, retry, decline, expiration, cancellation, and contact approval are explicit.
- A matching testnet preview cloud readback receipt is required before inviting or requesting a contact. It stores object references and digests, never ciphertext or private key material.
- The optional-code mode cannot request a contact until an external code verifier reports success. The code itself is never an event or state field.
- A contact response is tied to the active request, wallet policy hash, credential reference, replacement-device key reference, and expiry. Repeated responses cannot advance the state twice.
- Both flows stop at `awaiting-cryptographic-enrollment` or `awaiting-cryptographic-verification`. There is no “ready”, “recovered”, or funding state.

## Required work before using this for funds

1. Implement and review an authenticated Mobile Key backup format, key wrapping, nonce/replay handling, versioning, and recovery on a fresh device. Prefer standard reviewed protocols such as [HPKE (RFC 9180)](https://www.rfc-editor.org/rfc/rfc9180) for the contact key exchange; do not construct a custom ECDH protocol in the UI.
2. Provision isolated preview iCloud and Google Drive identities/containers. Add upload, download, authenticated readback, offline, interrupted-write, and restore APIs. Confirm the production Keeper namespace is inaccessible.
3. Build the contact app/device credential lifecycle: enrollment, public-key confirmation, secure storage, encrypted export/restore, rotation, revocation, and loss handling. Current address-book association is not a recovery credential.
4. Build a server-independent QR/share request and response channel with identity checks, approval and decline screens. Confirm the contact cannot silently approve a different wallet or replacement device.
5. Test two devices, both assurance modes, failed cloud readback, expired/replayed messages, lost contact credential, app reinstall, Keeper endpoints blocked, and exact recovered Mobile Key xpub. Obtain independent cryptographic/security review before labeling the path usable.

The default Seedless design uses an independently generated Mobile Key. Keeper's Recovery Key cannot derive that same key; any RK-assisted restoration would need a separately designed encrypted copy or wrapping protocol. If the user explicitly chose the optional RK-derived Mobile Key at creation, that Recovery Key can regenerate the same key without contact approval. Neither route changes the wallet policy by itself. If a key is suspected compromised, rotation still requires a new policy, on-chain transfer, and Archived Wallet handling.
