# Recoverable Wallet — parallel Keeper preview

Status (8 October 2026): **first client preview implemented; Android package built; iOS package configured but not built**. This is a simulated walkthrough, not a released or security-reviewed wallet. Public name is undecided ("Recoverable Wallet" is a working term).

## First client checkpoint

- The separate preview app starts at **Add Wallet** and walks through automatic Mobile Key / Server Key ready statuses, hardware selection, a simulated connection/error, optional Inheritance Key, one final whole-policy review, and completion. Cancel and resume work while the app stays open. No key, wallet, address, backup, transaction, hardware session, or server registration is created.
- TAPSIGNER, Satochip, Jade, and Coldcard appear with their existing Keeper transport choices. The UI says policy verification and full Recoverable Wallet compatibility remain unproven. Every simulated status, error, and completion is labeled.
- The app entry requires the exact preview package ID and testnet-only preview flags. Normal Keeper continues through its original app component. The preview loads no wallet store, cloud backup, signing, or server client. The native preview identifiers are distinct, the Android CloudBackup module is disabled, and the iOS preview has no iCloud entitlement. See [native-preview.md](native-preview.md).
- An arm64 Android debug APK with an embedded JavaScript bundle was built and its package identity, signature, and merged manifest were checked. It installed and ran beside an existing Keeper development app on an Android emulator. Side-by-side installation with production Keeper on a physical device remains unverified. The iOS preview scheme, identifier, plist, and entitlements are configured, but an iOS build has not been run: this checkout lacks matching Pods and has insufficient free disk space for a safe fresh install/build.

| Evidence | Current result |
| --- | --- |
| Simulated client flow | Automated walkthrough covers four hardware choices, cancel/resume, connection error, inheritance choice, and final review. |
| Startup boundary and related regressions | 27 focused Jest tests pass across the preview, testnet header, and Recovery Key migration suites. |
| Native build | Android arm64 debug APK built with embedded JS, installed and launched on an arm64 emulator; iOS scheme configuration inspected, build pending. |
| Small-screen rendering | Android emulator walkthrough passed at 320dp width and 1.6× system font: statuses, four hardware choices, simulated error, inheritance, review, and completion remained scrollable and actionable. The Jest content check alone does not establish rendered layout. |
| Physical devices and production side-by-side installation | Pending. The emulator had Keeper development installed, not production Keeper. |
| Cryptography, cloud read-back, physical hardware, security review | Pending; no such functions are represented as complete in this preview. |

The next owner test is to install the Android APK beside normal Keeper, walk through both inheritance choices and a simulated error, verify text and controls at a small screen width with larger system font, then uninstall Preview and confirm the normal app and backups remain intact. Equivalent iOS testing follows a fresh matching Pods install, simulator/device build, and preview App ID/provisioning setup. Do not use real wallet funds or production recovery material in either preview.

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

Run the native device checks in [native-preview.md](native-preview.md), especially side-by-side installation and small-screen accessibility. Finish the iOS build with matching dependencies and separate provisioning. Keep real signing, cloud recovery, and server protocol work gated by their own tests and review; do not change SigningServer or Relay while awaiting Adam's contribution and an owner decision.
