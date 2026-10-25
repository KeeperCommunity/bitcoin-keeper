# R5 native Version History companion

This package prepares native acceptance of the 5.1 history correction. It is
separate from the five product startup/first-wallet samples. Its native scenarios
have **NOT RUN** until an exact combined candidate executes them on hosted iOS
and Android. Offline fake-native tests establish fixture/runner contracts only.

## Source and bounded scope

Base: `3eb92fc8a622a3e09926d49f47243c163e32d009`, including 5.1
`c1c4b803039b61b940373c4dc9d08473cf25e042`. Producer implementations are unchanged.
The app source currently reports 2.6.4, iOS build620 / Android627. Work-package
labels 5.1 and 5.2 do not assign app versions. No version/counter is allocated.
This fixture intentionally fails if its expected current tuple/schema changes;
review that source change before adapting the fixture.

After the normal product/key/PIN/credential companion, the sole task-owned
fixture-6 account has native PIN1111, one wallet, no Vault, and original
`Initially installed` history. The helper verifies these assumptions before any
write: development/loopback build, account/Realm identity, native credential
username, known disposable PIN hash, existing schema109 and installed/current
KeeperApp/shared version. A missing Realm or credential is rejected; no new
account is created. The parent runner must retain its exact source/build/device
and recorded package-overlay guards.

Only fixed alternate CI entrypoints open the actual encrypted native Realm.
Actual Keychain/MMKV/AES primitives retrieve its key in the device process. The
key and credentials are never stored in fixture MMKV, printed, written to a host
artifact or sent to a server. The same-device dedicated MMKV backup contains
only history rows, local owner identifiers/known PIN hash and wallet identifiers;
those values are never exported. No production entrypoint imports the fixture.

1. Back up exact original history rows including date/releaseNote. Seed two
   explicit controlled old provenance rows (`Initially installed`, `Recovered
   Wallet`, fixed old dates), without changing account/shared app versions.
2. Ordinary `index.js` cold login must render the installed native tuple and
   `Current installation observed`. A separate native read verifies exactly one
   current tuple with an observation date inside the device-local seed-to-read
   clock window (1.5s precision tolerance), both old dates/titles, no invented upgrade row, unchanged
   account version and one wallet.
3. A second ordinary cold login and native read require the same observation
   date and row count. Repeating a fixture verification cannot substitute for
   the intervening normal UI flow in the runner contract.
4. Repeat with an explicitly empty history. Only the current observation may
   appear, and a second login must retain its date with no duplicates.
5. Restore and read back the exact original history rows. Remove the dedicated
   backup key and return to the normal product Metro entrypoint before Vault work.

These are controlled stale/empty *history* states. They do not claim an authentic
historical installation, actual version migration, recovered account, backend
compatibility, physical device or physical biometric acceptance.

## Runner interface and ordering

Call `product_history_acceptance.run_companion(h, data, device, private,
backend_receipt, switch_entrypoint)` after the successful credential restoration
companion and before Vault/account-count changes. `backend_receipt` must retain
the completed controlled retry fixture6 with exactly two account-create attempts
and one rendered wallet. Any additional account-create request fails.

The parent-owned `switch_entrypoint(phase)` callback must stop the app and its
owned Metro process group, start only the committed fixed configuration, wait
for readiness, and warm the corresponding bundle. Its only accepted history
phase values are:

- `history_seed_stale`, `history_verify_stale_first`,
  `history_verify_stale_repeat`, `history_seed_empty`,
  `history_verify_empty_first`, `history_verify_empty_repeat`,
  `history_restore`, `history_verify_restored`;
- `product` selects unchanged normal `index.js` without a config override.

Each `history_*` value maps exactly to
`.github/native/<phase>_metro.cjs` and its fixed entry wrapper. No environment
variable or app user flow selects an arbitrary entrypoint. Each Maestro phase
must finish with successful JUnit and a fixed native stage selector or normal UI
assertions. The runner verifies actual installed byte identity before and after
every phase, records fixed phase names/proofs only, and purges private Maestro
screenshots/hierarchies/log output. No receipt exports the App ID displayed by
the normal Version History screen.

This package supplies the companion and contracts. Root runner wiring remains
separately coordinated to avoid overlapping the credential/Vault producer files.
A failed fixture leaves a failed receipt and the parent discards its owned
installation/device; no later package may adopt that failed account.

## Checks and remaining work

Prepared checks: Node22 native-boundary controls, Python offline runner controls,
syntax/config/YAML checks and whitespace checks. Record exact counts and SHA in
the PR handoff. Actual native iOS/Android execution, combined package wiring,
protected-base trust, private Relay UI acceptance and physical checks remain
separate obligations. No merge, shared promotion, signing, upload, distribution,
deployment or publication is performed by this package.
