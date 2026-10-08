# Recoverable Wallet — parallel Keeper preview

Status: **parallel development stream, planning and isolated preview setup**. Not a released feature, not a security-reviewed wallet, and not an OpenSpec implementation package. Public name is undecided ("Recoverable Wallet" is a working term).

## Owner decision (8 October 2026)

Develop a Bitkey-like Recoverable Wallet **in parallel with** the existing R01–R10 work buckets. This stream is **not** a new R11/R12 bucket, and its feature is **not committed to ship in R9/R10**. User-visible progress must be measured by independently installable, manually testable preview builds, not just code review. No existing release is delayed or silently rescoped to fit this feature.

**Strict hold: do not change Keeper SigningServer, Relay, production infrastructure, or any server-side recovery interface as part of this preview stream while waiting for Adam's proposed contribution and subsequent owner decision.** The server-side hold is specific to this feature; it does not overturn explicitly approved routine R04/backend maintenance. Any server interaction required by early UI previews must use mocks/disposable isolated test infrastructure, and cannot be represented as validated cryptographic recovery.

Adam's contribution is welcome, optional, independently reviewed, and must not block client UX, preview packaging, hardware UI, cloud-transport research, test fixtures or safety tests. Do not merge Bitme's exact Hardware+Server-immediate/other-pairs-delayed descriptor into Keeper. Any eventual code use must retain the appropriate MIT notice and follow Keeper review.

## Non-negotiable product model

- One Wallet within Keeper; not a replacement for whole-app recovery with the twelve-word **Recovery Key**.
- Standard base **2-of-3 Mobile Key + user-selected Hardware Key + Server Key**. Mobile/Server status is presented automatically; no manual quorum builder.
- Hardware added last among the base keys, using appropriate physical connection, QR or NFC flow.
- Optional Inheritance Key is chosen before final wallet-policy approval. The *final complete* policy is confirmed once; don't fund/register an intermediate wallet.
- Plain base 2-of-3 is not Bitme's timelocked Miniscript descriptor. When inheritance is added, use Keeper's Miniscript policy with compatibility testing for **all** signers. Signing-only hardware (TAPSIGNER/Satochip) is distinct from policy-verifying hardware.
- After inheritance eligibility, independent heir's Inheritance Key + any eligible original signer can form the required 2-of-4 quorum; Keeper server cannot become mandatory for the heir's exit path.
- Cloud encrypted Mobile Key backup in user's iCloud / Google Drive is separate from existing Personal Cloud Backup. Its "healthy" status must be based on cryptographic read-back, not request success.
- Hardware-authorised unlocking via server-held recovery material is an accepted trade-off; design, isolation, replay protection and threat model require independent security review before real funds.
- Contact-based recovery must ultimately be **independent of Keeper's server** if an enrolled contact + accessible encrypted cloud backup are available.
- Hardware + Server supports delayed replacement of missing Mobile Key when cloud backup is missing, once server implementation is allowed.
- Mobile + Hardware and descriptor support server-independent spending/exit. Test actual external-wallet compatibility; public descriptors do not contain private keys.
- Key changes mean new wallet policy and on-chain transfer with fee and original-wallet authorization. Archive the complete predecessor and monitor retained archived addresses indefinitely, including zero-balance wallets. Do not archive merely because the same Mobile Key was restored.
- Keep Recovery Contact distinct from signing keys and Inheritance Key. The existing 12-word Recovery Key is an **additional whole-app recovery route**, not a mandatory prerequisite for this wallet's recovery methods.

## How the owner will test it

Deliver a **separate-installation iOS and Android Keeper Preview** (different app identity and storage namespace from production Keeper), testnet-only and isolated from real iCloud/Google Drive backups. Verify the necessary app IDs, native entitlements, cloud containers and distribution access before promising TestFlight or Android APK builds. Keep normal Keeper installed and unaffected. Preview actions may initially be mocked: they must be unmistakably identified as simulated; no fake success, funding or cryptographic-security claims.

A new preview checkpoint is complete **only after an installable build and a short device-specific owner test checklist are available**, and after actual tests are recorded:

1. **Prototype/UI**: tap through Add Wallet → recoverable wallet, hardware picker/connection, automatic Mobile/Server status, optional inheritance, one final policy review; include errors/cancel/resume.
2. **Disposable real wallet**: create fixed 2-of-3 wallet on testnet using supported available signers, safely receive/send test sats, inspect proper fees and outputs. No mainnet, no production credentials.
3. **Backup**: encrypted Mobile Key recovery blob, versioning, iCloud/Drive isolation, read-back verification, retry/offline/background/interrupted write tests; retain existing Keeper backup compatibility.
4. **Recovery via hardware**: lose/reinstall disposable preview, prove hardware possession, restore same wallet and explain retain-versus-rotate Mobile Key after restoration. This requires reviewed server protocol; do not simulate as if implemented.
5. **Recovery Contact**: enroll second person/device, approve/decline, backup/reinstall contact credential; recover when Keeper server is demonstrably unreachable. Actual independent channel/crypto is required for completion.
6. **Lost-key, inheritance and exit**: delay/veto/replacement, migration/archive/old deposit, Miniscript policy registration and exact signer paths, descriptor export plus actual compatible external-wallet sweep, with Keeper server offline.
7. **Hardening and mainnet-readiness**: comprehensive adversarial/destructive tests; iOS/Android real NFC/QR hardware and app life-cycle, independent crypto/security review, full regression against then-current Keeper build. Mainnet activation and campaign only after explicit user approval.

Each checkpoint may be smaller than the grouping above to keep visible feedback frequent. Keep a clean recorded matrix of **simulated / automated / native / physical / security-reviewed / user-tested**, never conflating these.

## Integration and communications

- Stay rebased on the current Keeper app branch; keep product-facing changes isolated behind a guarded preview feature path. Nothing is merged into shipping app without reviewed CI/native regression and owner approval.
- Server code is **frozen for this feature pending Adam's contribution and a new owner instruction**. The absence of Adam's PR does not block preview UI, local hardware functionality, cloud transport tests, threat modeling or design.
- Keep existing R5–R10 commitments intact. This work is recorded in a separate **Now — Parallel Recoverable Wallet** tracker entry, *not* a new numbered work bucket. Release integration will be scheduled later on evidence of readiness.
- Prepare, but do not publish, direct factual Bitkey comparison, blog, feature page, demo video, Ask Keeper help, X/Telegram campaign. Emphasize third-party hardware freedom and Miniscript inheritance. Bitkey already publishes source; do not claim otherwise. Keeper owner controls external communications.
- Self-hosted packaging/custom-server settings remain **Later**. No performance/security superiority claims without data.

## Immediate next action

Build the separate app-flavor / package identity and local navigable testnet preview **without touching any server repository or production recovery service**. Validate installs alongside production Keeper and separate cloud storage before testing on a real device. Do not represent this README or branch alone as an installable or functional preview.
