# R5 genuine Vault reference UI companion

Implementation package based on exact source
`3eb92fc8a622a3e09926d49f47243c163e32d009` (draft execution PR
[#7082](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7082)). The existing
[unused-key/PIN companion](NATIVE-KEY-UI-ACCEPTANCE.md) remains separately
reviewable at [#7079](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7079).
This package adds genuine Vault UI acceptance; shared product-runner wiring is
reserved for coordinator review. It does not schedule native jobs itself.

Current state: **IMPLEMENTED; SHARED RUNNER HOOK PENDING; IOS NOT RUN; ANDROID NOT
RUN; PHYSICAL NOT RUN.** These new checks have no native acceptance credit until
the coordinator integrates the reviewed package and runs the exact combined
candidate. Host contracts use synthetic harnesses and provide no native credit.
The source version remains 2.6.4; work-package labels 5.1/5.2 are not app versions.
This companion does not identify, modify or complete the separately running 5.2
package. Its authoritative handoff and combined checks remain required.

Cloud source checks: eight new host contract tests PASS; existing DeleteKeys and
HomeWallet suites PASS (67 component tests). All companion YAML parses, both
public BIP39 vectors validate, four edited TSX files transform, and new JS/YAML
formatting passes. Focused ESLint still FAILS with51 errors/14 warnings, exactly
matching source3eb92 on the same four files (zero added/removed diagnostics).
Whole TypeScript still FAILS with943 errors, matching that exact baseline after
normalizing line numbers and the shared dependency path (zero added/removed).
These inherited failures are retained; native checks remain NOT RUN.

The sequence uses the ordinary `index.js`, production navigation, native PIN
verification, encrypted Realm, reducers and sagas. It adopts only the same
task-owned Testnet simulator/emulator after the existing six-fixture product run
and a successful unused-key/PIN companion. That predecessor leaves one unfunded
Mobile Wallet, no eligible deletion keys, PIN1111 and backup consent off. There
is no device selector, app link, database write, credential override, test-only
entrypoint or account-creation path in this companion.

## Real UI scenarios

1. Generate a Mobile key through **Add a software key → Mobile Key → native PIN**.
   Import public BIP39 vector A through **Seed Key → Import**, then choose **Skip**
   at Remember Seed Words. The app derives the fingerprint, Testnet paths and
   public keys; the harness supplies no claimed derivation metadata.
2. Create a genuine custom 2-of-2 Vault using Mobile + A. A Mobile 1-of-1 creates
   a hot wallet and cannot satisfy this scenario. The suite checks the 2-of-2
   confirmation, Vault name and two visible wallets including Mobile Wallet.
3. Select the Mobile row's Delete action. An active visible reference must show
   **Key Used in Wallet**, the visible Vault name and its scoped explanation;
   no deletion PIN modal may open.
4. Hide the Vault through its ordinary settings and cold relaunch. One visible
   Mobile Wallet remains. The same deletion attempt must still block, while
   concealing the hidden Vault name and reference card. Unhide through **View
   Vault → Show hidden wallets → PIN → Unhide → PIN** and cold-check count two.
5. Use **More Options → Manage Keys → Mobile → Change Key**. Import public vector
   B through the ordinary key-add path and replace Mobile with B. The original
   empty Mobile+A Vault is archived; its A+B successor remains active. Only the
   zero-balance route reaches the expected replacement confirmation. The suite
   never follows a sweep/send route. Open **Archived wallet versions** and the
   original Vault, verifying the actual archive has a Reinstate action.
6. Cold relaunch; Delete Mobile with correct PIN. Production intentionally
   archives a signer with archived-only references and shows the existing
   success modal. This scenario must not claim that archived-only deletion is
   blocked or that the signer is physically erased. Its normal deletion row
   disappears and stays absent after another cold relaunch.
7. Open the original archived Vault and **Reinstate**. After a cold relaunch,
   count three means Mobile Wallet + both real Vaults. The retained Mobile signer
   reappears and its active-reference deletion protection returns. The worker
   refuses reinstatement if a referenced signer record is missing; the suite
   checks the cold result rather than relying on its optimistic success toast.

The public seed inputs are the standard 12-word reference vectors `abandon` ×11
+ `about`, and `legal winner thank year wave sausage worth useful legal winner
thank yellow`. They are intentionally known inputs and must never receive funds.
No generated private key, Recovery Key, seed display, export/QR screen, send,
receive, signing or hardware interaction is opened. The original 2-of-2 also
contains a fresh native Mobile key. No account or balance is funded by this work.

## Evidence and boundaries

`product_vault_acceptance.py` accepts only ordered, fixed stage names over
loopback port8769 (isolated from credential receipt8767 and private protocol control8768). It stores no app identifiers, fingerprints, names, words,
credentials or raw hierarchy. PASS requires all stages, successful Maestro JUnit,
the exact committed source/build, the predecessor's verified installed bytes,
unchanged built and installed artifacts, and no additional account-setup call.
Output explicitly distinguishes archive/reinstate record retention from native
private-material exactness, which UI does not directly inspect.

Maestro's automatic output can contain transient screenshots, hierarchy and PIN
actions. It remains in the parent's private temporary directory and is removed
on success/failure, including evidence-save or server-close failures. The parent
must also purge process logs and the disposable installation as in the existing
product runner. Never upload raw Maestro output.

The only app instrumentation is native view IDs on the existing wallet-add Fab,
wallet-detail back/settings buttons, and a safe signer-type key-card wrapper.
Existing callers may omit the optional KeyCard property. No key identity/name or
private value appears in a selector. The four Mobile Delete actions use
Maestro2.11.0's supported `childOf` selector; they do not assume Realm ordering.
Public seed B selection uses the second Seed Key card in the controlled fixture,
where A was imported first and B second. Wrong selection cannot complete the
replacement and final retention sequence.

Backend compatibility, protected-backup protocol behavior, credential-store read
faults, physical biometrics/devices, spending, recovery cryptography, 5.2 scope
and release readiness remain separate obligations. Existing controlled native
worker probes still provide distinct reference/record evidence; this companion
does not relabel that evidence as full UI acceptance. A pass here grants no
merge, protected-base installation, signing, distribution or release authority.

## Coordinator wiring

Load this module next to `product_key_acceptance.py` inside the source-owned
product runner. After the existing key companion succeeds, call
`run_companion(h, data, device, private, receipt, key_companion.installed_proof)`
while ordinary Metro and the disposable backend responder remain alive. The
helper writes `product_vault_ui` to native metadata and returns the separate
receipt. Include that receipt in the product result and final evidence; preserve
the unused-key receipt and five raw measurement samples. Update stale scope text
according to actual results, and budget up to1800 additional seconds in each
serialized platform job. Never adopt another device/install or start another
native build concurrently.
