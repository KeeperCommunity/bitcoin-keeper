# R4 inheritance and affected timelock validation

This checklist belongs to the R4 / 2.6.4 candidate in PR #7045. Read its latest Codex local handoff for the exact tested source SHA. Native and hardware acceptance remain open. The copy below is conditional on the documented acceptance and approved release; it does not authorize publishing or customer communication.

## Row 249: existing decaying-passphrase setup

The live tracker requires the same BIP39 words **with** a passphrase as the primary key and **without** a passphrase as the Inheritance Key in a 1-of-1 Miniscript wallet, with six-month activation. This is an existing inheritance-policy configuration, not a new passphrase-recovery engine.

### What the source supports

- `AddNewWallet.tsx` offers Single-key, then Enhanced Security Options → Inheritance Key. Enhanced option selection checks `usePlan().isOnL3Above`; the Inheritance Planning education entry checks `isOnL2Above`. In the current candidate **usePlan hardcodes L3**, as does useSubscriptionLevel, so both checks are presently true regardless of stored subscription. These source conditions do not establish actual store/product entitlement or require a purchase in this candidate. Observe the final build and confirm intended product availability before publishing customer steps; no entitlement logic was changed by this subtask.
- The primary AddSigningDevice step routes to AddReserveKey when inheritance is selected. AddReserveKey supports one inheritance signer and offers 6, 12, 18, …, 60 months; the default is **12 months**, so the user must explicitly choose **6 months**.
- `VaultMigrationController.tsx` computes one fixed activation lock: creation time + optional initial Wallet Timelock duration + selected inheritance delay. New wallets use a UNIX timestamp from `Date.now()`; re-vaulting an existing block-height policy preserves the block-height unit. Policy compilation uses `after(...)`, not a per-UTXO `older(...)` delay. Consensus timestamp maturity uses chain median time, so wall-clock presentation is not a guarantee of spend finality.
- Mainnet MONTHS_6 means a fixed **180 days**, rather than six calendar months. Testnet's identically labelled option is accelerated to **60 minutes** for new timestamp wallets; the legacy height fixture is **6 blocks**. Testnet acceptance must inspect the actual descriptor and must not mistake its accelerated duration for mainnet behavior.
- A 1-of-1 wallet has the primary key available before inheritance activation (unless a separate initial Wallet Timelock is deliberately enabled), and adds a distinct one-key Inheritance path at the fixed activation. The original primary path remains available afterward. For other quorum sizes, an Inheritance Key joins the quorum; generic copy must not promise that it alone spends every wallet.
- `generateSeedWordsKey` and the software seed-key setup derive from words without a passphrase; there is no in-app passphrase field in that path. The passphrase-protected primary key must be derived/exported by a suitable external signer, with its fingerprint/xpub checked against the chosen passphrase. Keeper cannot infer that two xpubs came from the same words.
- The source Miniscript allowlist includes MY_KEEPER, TAPSIGNER, SATOCHIP, BITBOX02, COLDCARD, JADE, KRUX, LEDGER, SPECTER, SEED_WORDS, KEEPER and POLICY_SERVER. This is a selection allowlist, not hardware/firmware proof. The fixture passphrase string `TREZOR` is a public BIP39 test value; it does not establish Trezor compatibility (TREZOR is absent from that allowlist).
- Receiving funds, spending funds, generating more addresses, opening Keeper or entering a passphrase does **not** restart activation. Later deposits to the same wallet descriptor retain its existing fixed date. Resetting uses an explicit new wallet version and fund transfer, with network fees and signer availability; old addresses keep the old policy.
- Wallet Settings → Wallet configuration file offers QR/file/PDF export; it contains the actual policy and is needed alongside the appropriate seed/passphrase recovery material. Wallet Settings has a separate Resetting Inheritance Key → re-vault flow. That flow must not be presented as an automatic inactivity reset.

### Targeted source changes in this continuation

AddReserveKey now uses a separate English/Spanish inheritance disclosure explaining the fixed activation, inclusion of any Wallet Timelock, non-resetting deposits/spends, and the need to re-vault and transfer funds to reset. The shared Emergency Key copy remains unchanged. The existing disposable policy test additionally checks that only the passphrase primary is available before activation, the seed-only path has threshold one after activation, and generating addresses/reading availability does not change the descriptor.

An additional concrete UI finding: the Inheritance Planning CTA passes `params.isAddInheritanceKeyFromParams`, while AddNewWallet previously read `route.isAddInheritanceKeyFromParams`. The scoped fix reads it from the existing `route.params` binding. The regression executes the actual CTA navigation expression, actual route binding and actual React state initializer; it covers the entry, ordinary creation without params, and retained inheritance policy. The main Create Wallet path still requires explicit Enhanced Security selection. Record the final fix SHA and validate this alternative entry separately.

### Cloud checks in this continuation

- `npm test -- --runInBand tests/services/passphraseDecayPolicy.test.ts tests/services/inheritanceEntryRoute.test.ts tests/services/initialTimelock.test.ts tests/services/addReserveTimelockBoundary.test.ts tests/services/addSigningDeviceTimelock.test.ts tests/services/resetTimelockBoundary.test.ts tests/services/resetTimelockRoute.test.ts`: **7/7 suites, 118/118 tests passed**. After refining the route read through its existing destructuring, the two directly changed suites were rerun: **2/2 suites, 6/6 tests passed**.
- Test-file Prettier, English/Spanish JSON parsing and disclosure-key presence, and `git diff --check`: **passed**.
- Scoped screen ESLint: **fails with existing screen debt**. Before/after isolated source comparison: AddNewWallet 27→26 errors, unchanged 15 warnings; AddReserveKey unchanged 33 errors/2 warnings. Config ignores test files. No newly introduced screen lint diagnostic; the obsolete root-route property diagnostic disappears. Full JSON Prettier check also fails the existing localization formatting; no whole-file reformat was applied.
- React best-practices review applied to the two narrow TSX edits: no new hooks, async work, components or subscriptions. Native accessibility/text-layout acceptance remains open for the longer disclosure.
- No simulator/emulator, physical signer, fund transfer, customer wallet assessment, production action, customer reply or release was performed by this audit.

### Exact UI steps to validate before customer use

These steps are source-derived and remain **draft** until observed on the final iOS and Android builds with a supported signer/firmware:

1. Use a disposable Testnet account and a signer capable of the generated Miniscript policy. Prepare the same public test seed with a test passphrase and with no passphrase as two distinct signer identities. Import/export the appropriate P2WSH/multisig xpubs and origins; record fingerprints. Do not use real recovery material in screenshots or logs.
2. From Home's wallet area, open the add-wallet control → **Create Wallet** → **Single-key**. Open **Enhanced Security Options**, select **Inheritance Key**, leave **Emergency Key** and **Wallet Timelock** off for this specific setup, then **Save Changes** and **Proceed**. Record whether the final build allows selection; if an actual product gate appears, stop rather than bypassing it. Do not infer paid-plan requirements from the current candidate's hardcoded L3 helper.
3. On key selection, choose the key derived with the passphrase as the sole primary key, then **Proceed**. Do not substitute Keeper's passphrase-free seed-key import for that primary.
4. On **Add Inheritance Key**, add/select the key derived from the same words without the passphrase. Check that its fingerprint/xpub is distinct from the primary. Select **6 months** explicitly; confirm that the fixed-date disclosure is visible and readable, then **Confirm**.
5. Name the wallet and use **Create Your Wallet**. Open its **Wallet Settings** → **Wallet configuration file** and save the disposable descriptor/config. Confirm the primary role is the passphrase key, the inheritance role is the no-passphrase key, and the policy has exactly the expected fixed fallback `after(...)` lock. Confirm no unintended initial primary timelock was introduced.
6. Complete the signing/receive tests below before moving this wording out of draft. For a mainnet customer, include the 180-day duration, fixed-date limitation, supported firmware and recovery/config requirement; do not claim generic passphrase import or unrestricted signer support.

### Local acceptance checklist (IOS, ANDROID, HARDWARE)

Record the final full app SHA, app bundle/package/version/build, OS/device, signer model/firmware, and pass/fail/not run per row. Use disposable Testnet funds only.

| Scenario | Expected evidence |
| --- | --- |
| UI and entitlement | Main Create Wallet path above works; English/Spanish disclosure wraps fully on a small screen and large font size; the 6-month choice is deliberate; disabled/unsupported signers explain the limitation. |
| Inheritance Planning entry | “Create vault with Inheritance Key” reaches creation with inheritance preselected after the scoped route-param fix. Record final availability/product gating; the current helper hardcodes L3 and does not prove subscription enforcement. |
| Two identities from the same seed | Passphrase and no-passphrase fingerprint/xpub differ; primary and inheritance roles match the imported origins. No stored field or heuristic is treated as proof of common seed words. |
| Descriptor and receive addresses | Two receive addresses plus change branch share one fixed fallback lock. Mainnet read-only policy inspection shows 180 days; Testnet actual descriptor shows its accelerated duration. Export/reimport preserves exact policy and origins. |
| Before activation | Supported hardware successfully signs the primary Testnet path. The no-passphrase key must not produce a currently spendable fallback before the descriptor lock matures. A signature or finalized future-dated PSBT alone is not maturity evidence; verify policy and chain finality in disposable fixtures. |
| After activation | Once chain median time or height is beyond the descriptor's lock, the no-passphrase key alone signs/finalizes a disposable fallback transaction; original primary still works. Record the maturity source and lock value. |
| No reset on use | Receive before and after activation; make a primary spend before activation; refresh/restart. Descriptor and fallback lock remain identical. A later deposit does not acquire a new six-month clock. |
| Recovery | On a separate disposable install, restore from exported wallet configuration with the required signer/seed material. Verify addresses and lock unchanged. Do not overwrite an owner's installed app or wallet data. |
| Re-vault limits | Do not initiate on a real wallet. If authorized for a disposable fixture, separately verify new policy/schedule, explicit transfer/fees, cancel/retry/restart and old-address continuity. Activation remains absolute; re-vaulting is a separate manual operation. |

Pending validation: exact UI, native builds/launch, hardware signing and fallback maturity, restore, and final release availability. Source fixture checks alone do not establish these.

### Conditional release and requester copy

Use only after the final build passes relevant acceptance and is actually released through an owner-approved channel. Confirm precise signer/firmware steps from Local before sending. No message or social post is sent by this Cloud continuation.

**Release note draft:** “Support for a decaying-passphrase inheritance setup: configure a 1-of-1 Miniscript wallet with the passphrase-protected key as primary and the same seed without its passphrase as the Inheritance Key. The six-month option is a fixed 180-day activation delay on mainnet; activity and later deposits do not restart it. Requires compatible signers and the wallet configuration for recovery.”

**Social draft:** “A decaying-passphrase inheritance setup is supported in Keeper 2.6.4 with compatible Miniscript signers. Its activation is fixed when the wallet is created: sending, receiving or using the wallet does not restart the delay. See the validated setup and recovery instructions before funding.” Add an actual published documentation/release link only when one exists.

**Requester reply draft:** “Your same-seed, with-passphrase / without-passphrase setup has been validated in Keeper 2.6.4 using [actual device/firmware and platforms]. Choose Single-key → Enhanced Security Options → Inheritance Key; use the with-passphrase key as primary, the no-passphrase key as Inheritance Key, and select 6 months. On mainnet this is a fixed 180-day delay from wallet creation, not a new six-month timer for each deposit or after activity. Keep the exported wallet configuration and your recovery material. To start a new delay you must explicitly re-vault and transfer funds, including the network fee. [Published release/instructions link].” Replace placeholders only with actual acceptance/release evidence; do not send before then.

## Row 252: affected Wallet Timelock assessment

The preserved artifact named by the live tracker is `outputs/r02-timelock-preserved-before-scope-trim-2026-10-02` (earlier pure read-only assessor plus 34 tests). It is **not present in this Cloud workspace or active candidate**. Preserve this missing dependency by name; do not silently replace it with a fresh detector that guesses prior intent. Existing `initialTimelock.test.ts` creates affected/intended disposable policies and compares them; it is not a stored-wallet assessor or repair implementation.

Current source boundary:

- `resolveInitialTimelock` rejects malformed or absent selection when TIMELOCKED is required. Current screen/controller tests cover route propagation and generated initial/fallback schedule. These guard future creation and re-vaulting; they do not repair already funded scripts.
- VaultDetails' timelock presentation and VaultSettings' reset entry use retained `usedMiniscriptTypes.TIMELOCKED` and stored timelock arrays. They do not compare the actual compiled primary spending path with independent original-lock intent.
- A retained TIMELOCKED marker with an unlocked primary path can signal a contradiction. When the intent marker is absent, an unlocked primary may be entirely legitimate; inference from inheritance/emergency locks alone cannot recover an original initial-lock duration.
- Existing Resetting Wallet Timelock or Resetting Inheritance Key flows create a new policy/version and transfer funds. They do not rewrite an already funded Bitcoin output script. Their existence is not row 252 assessment acceptance.

### Safe assessor port requirements, once preserved source is available

1. Recover the preserved source/tests without overwriting any work, identify original provenance and exact commit/artifact hash, review its assumptions, and port it as a separate read-only deliverable.
2. Accept only stored compiled primary-path evidence plus independent intent evidence (trusted original creation selection/config/owner-confirmed record). Inspect all supported primary spending alternatives and units; metadata alone is insufficient. Never serialize seed/private material or identifiable wallet data to shared logs.
3. Report at least affected / no demonstrated contradiction / unknown with evidence and explicit unknown reason. Absence of evidence must remain unknown, rather than a guessed duration or safety verdict. A matching policy is “not affected by this omission,” not a general wallet-security assessment.
4. Cover retained TIMELOCKED+unlocked primary, omitted metadata but independently attested intent, legitimate no-initial-lock inheritance, timestamp/height policies, contradictory descriptors vs phase metadata, malformed/unsupported policy, multiple primary paths, partial key/origin state and no independent intent. Reuse/extend the preserved 34 tests and record exact final results.
5. Prove inspection leaves wallet, backup, server, UTXO and navigation state unchanged; no sign/sweep/registration/upload side effects. Keep any proposed repair separate and inactive.

### Later funded-repair acceptance (explicit owner consent required)

Any repair needs a new wallet script and signed migration/sweep. Before a funded operation, privately review original intent, corrected primary lock and inheritance/emergency schedule, signer/recovery readiness, exact amount/fee and destination; get explicit owner consent. Do not guess the original duration, auto-migrate, shorten fallback schedules or treat a reset button as consent to security-policy repair.

Disposable repair acceptance must include fee display and consent, cancel without mutation, retry without duplicate sweep, restart/resume, partial/failed transfer, already-locked current wallet behavior, existing archived-wallet visibility/sync, old address receiving after migration, finding and recovering any remaining old-address UTXOs, configuration/recovery continuity and account isolation. Real-wallet repair is outside #7045 authorization.

Remaining row 252 blockers: preserved assessor/source and tests unavailable; independent per-wallet initial-lock intent evidence; separate assessor implementation/review; native read-only acceptance; and any later explicitly consented repair design/validation. No user wallet is assessed or repaired by this audit.
