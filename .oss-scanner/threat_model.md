# Bitcoin Keeper — proposed OSS Scanner threat model

This is audit guidance for maintainer review, not a certification, a new product
promise, or evidence that the build or tests have passed. Read `SECURITY.md` and
assess the actual checked-out revision. Record its commit in every report.

## Project and scope

Bitcoin Keeper is an open-source, self-custodial bitcoin wallet for Android and
iOS. It coordinates single-key and multi-key Wallets and external signing devices.
A defect in transaction construction, signing or recovery can cause irreversible
loss; wallet metadata can also be sensitive without granting spending authority.

Start with the enrolled mobile repository and its reachable dependencies. Review
native Android/iOS sources as well as shared TypeScript/JavaScript. A Linux build
can exercise Android and shared logic; do not describe iOS, physical signers,
biometrics, cloud delivery or production backends as tested unless separately
reproduced. Public backend source, if needed later, requires an explicit scope
extension and its own supported test environment. Do not retrieve private source.

Unmerged previews and proposed removals are not deployed features. Code on the
enrolled revision remains relevant even when a proposal would replace it. In
particular, do not exclude USDT or other financial paths solely because a later
release proposes to pause or remove them.

## Security properties to assess

- Preserve Wallet identity, network, signer identity and configured policy across
  import, registration, signing, migration, archive and recovery. A fingerprint
  or device label alone must not substitute for validating the required key and
  policy information.
- An authorized spend must preserve the intended recipients, amounts, fee and
  change. Treat PSBT fields, derivation metadata and change labels as inputs to
  validate, not independent evidence of ownership. Multisig does not by itself
  prevent several signers from authorizing the same malicious transaction.
- Keep the Recovery Key, private keys, passcodes and signing material confidential.
  The Recovery Key is the user's sensitive 12-word primary backup; it is distinct
  from Wallet Configuration Files and external signing-device backups. Do not
  assume that an app passcode replaces the Recovery Key.
- Enforce the configured threshold and any applicable Server Key authorization,
  delay, spending limit and cancellation rules. The Server Key alone is not
  intended to grant authority to spend a multi-key Wallet. Separate client-side
  observations from claims about backend enforcement that was not tested.
- Treat account/profile isolation, authenticated backup content, rollback and
  revision handling, consent and truthful backup status as security-relevant.
  Encryption at rest alone is not evidence that tampering, substitution or stale
  data are rejected. Wallet Configuration Files are not intended to contain
  private keys; public metadata can still expose a user's privacy.
- Preserve access to existing funds and the information needed to recover them
  across key/scheme changes, app upgrades, Archived Wallets and partial failures.
  Distinguish data loss or a false verified-backup claim from harmless UI errors.

## Untrusted inputs and trust boundaries

Examine QR and animated-QR payloads, NFC, deep links, imported files, descriptors,
Wallet Configuration Files, PSBTs, hardware-wallet messages, externally supplied
keys and policies, Electrum/Relay/SigningServer responses, notifications and
backup records. Include malformed, oversized, duplicated, replayed, reordered,
cross-account and wrong-network data where the real entry point accepts them.

Trace data through parsing, validation, confirmation, persistence and signing;
identify the actual caller and the authority it has. Check native/JavaScript
bridges, local storage, logs, clipboard and sensitive-screen exposure. Review
reachable dependency behavior and build/release trust boundaries, but do not
claim a vulnerable package automatically means an exploitable Keeper flaw.

## Attacker assumptions

Prefer realistic models: a malicious link or file sender, remote cosigner,
untrusted service response, network adversary, or attacker with a specifically
stated level of device access. State authentication, user interaction and signer
cooperation prerequisites. Do not silently grant an attacker the user's complete
Recovery Key, a fully compromised OS, or enough authorized signing keys and then
report the resulting access as a new application vulnerability.

A stronger assumed compromise may still reveal a useful broken boundary. Report
which extra authority or secret is obtained beyond that initial compromise.

## Proposed triage priorities

These are impact-based starting points, not automatic severity assignments.

- Critical: demonstrate unauthorized spending or recoverable spending-key theft
  under realistic prerequisites, or a similarly severe release-integrity breach.
- High: demonstrate a material authorization/policy bypass, substantial secret
  exposure, cross-account backup compromise, or a recovery defect with a credible
  path to loss. Explain any missing step toward an actual spend or loss.
- Medium: demonstrated privacy exposure, bounded persistent denial of service, or
  misleading security state without a demonstrated direct-loss path.
- Low/informational: hardening opportunities or limited-impact behavior. A crash,
  old dependency version, naming inconsistency or debug fixture alone is not a
  high-severity finding. Elevate only with evidence of the relevant impact.

Separate demonstrated behavior from hypotheses. Do not suppress a finding merely
because current documentation calls a related behavior intentional; identify the
specific security property that could be violated.

## Proofs of concept and patches

Use synthetic accounts, fresh disposable test keys and local fixtures only. No
mainnet transaction, real wallet, real Recovery Key, production token, personal
record or hosted-service test is authorized by this enrolment. Test fully offline
where possible. Do not send reports or test payloads to other users.

Reports should include the affected commit, platform and entry point, attacker
prerequisites, expected versus observed behavior, a minimal local reproducer,
impact and uncertainty, and a focused regression test where possible. Identify
missing native/hardware/backend coverage. Group duplicate symptoms sharing one
root cause and preserve distinct exploitable paths when their fixes differ.

Propose small, reviewable patches. Never weaken verification, suppress failing
tests, silently change wallet derivation or require regeneration of existing
keys simply to make a test pass. Key/policy changes need explicit compatibility
and recovery analysis. Maintainers must reproduce and review every proposed fix.

## Reporting

Send scanner reports privately to `anant@bithyve.com`. Do not post suspected
vulnerabilities, sensitive traces or proofs of concept in public issues or PRs.
The project's general reporting channel remains GitHub Private Vulnerability
Reporting, as described in `SECURITY.md`. No automatic public disclosure or
production remediation is authorized by this preparation.
