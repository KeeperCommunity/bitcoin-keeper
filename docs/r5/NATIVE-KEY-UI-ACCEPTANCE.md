# R5 normal-app key/PIN UI companion

This separately reviewable package adds one normal-app flow after the five healthy
startup/first-wallet samples and the separate controlled setup Retry fixture.
The same task-owned simulator/emulator, ordinary `index.js` Metro entrypoint,
current reducers/sagas, native Keychain and encrypted Realm remain in use. The
latency samples and Retry fixture keep their own receipts and outcomes.

The companion starts with the disposable Testnet account created by fixture six
(PIN1111, one unfunded Mobile Wallet, backup consent off). It uses the visible
Keys → Manage Keys action, verifies that no eligible deletion key is initially
shown, and creates one extra unused Mobile Key through Software Keys and the
normal PIN confirmation. That path derives locally and does not open seed/QR or
export screens. A generic `keys_add_key` selector on the existing floating action
button is the only app instrumentation; it contains no account/key identifier.

The executable flow checks the scoped deletion confirmation, cancellation after
partial PIN entry, rejection of PIN0000, correct PIN retry and the deletion
success/empty eligible-key list. The unrelated one-wallet list remains present.
After a cold process restart it also rejects the wrong login PIN, accepts the
correct PIN, verifies the eligible key remains absent and retains the one Mobile
Wallet. The hidden Recovery Key is excluded by the existing production deletion
filters and is never selected or exported.

The loopback backend remains create-only; the companion requires the completed
fixture-six receipt and rejects any additional account-creation request. It has
its own host-loopback metric receiver on port8766 with fixed ordered stage names
and no app data. PASS requires successful Maestro JUnit, every ordered stage,
unchanged candidate build identity and the unchanged account-creation count.
Only fixed outcome/scope identifiers are retained. Maestro's temporary
screenshots/hierarchy/PIN actions are deleted; the parent removes this suite's
process logs and task-owned installation. No raw error or key material is
copied to evidence or uploaded.

Scope remains explicit:

- Actual referenced-Vault UI protection is **NOT IMPLEMENTED** by this companion.
  Creating a real retained Vault using the present UI would require additional
  signer/hardware/seed/import journeys. The separate production-worker native
  reference/rollback/session probe keeps its controlled-boundary label.
- Native credential rejection is exercised through wrong PINs; a credential-store
  **read fault** is **NOT RUN**. No hidden credential injection or fault hook was
  added to production.
- Physical biometrics, protected-backup protocol/deletion, archived/concealed
  Vault UI, hardware signing, recovery cryptography and release readiness remain
  separately unverified. No simulator result may be reported as a physical pass.

Initial source: root integration checkpoint
`cad01c3ddba3a394bda33f969e0a177d153ba6d8`. The package adds roughly 4k–7k
changed code/test tokens, a small runner hook and two nonfunctional selector
changes. No producer branch or release operation is changed.

Actual host checks: seven companion HTTP/receipt/runner/privacy/failure contracts
PASS; the 23 existing product measurement/Retry contracts and 14 existing wallet
UI component regressions PASS. Babel and YAML parsing pass. Focused selector-file
ESLint retains its baseline failures (9 errors / 2 warnings); no added findings.
These contracts
use modeled driver/artifact boundaries and provide **no native acceptance**.
Both platform executions remain **NOT RUN** until the coordinator publishes and
runs the combined exact candidate sequentially. Keep failed native attempts and
all unimplemented rows visible; no acceptance transfers from another SHA.
