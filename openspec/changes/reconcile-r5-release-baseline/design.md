## Context

R4's middleware stamps app/session authority at dispatch and its deletion worker
checks retained Vault references inside the local transaction. R5's earlier UI
confirmation predates that dispatch boundary; its origin must survive an account
switch, including A → B → A. The owner-confirmed release baseline is 1d8a86a.

## Goals / Non-Goals

Preserve R4 and R5 history and all released backend/native/dependency inputs;
reject stale deletion confirmations without weakening reference, archived-key or
passcode guards. No schema/MMKV/store-shape change or Persist migration/version
bump; no PSBT, amount, UTXO or hardware interaction.

## Decisions

The DeleteKeys screen will capture the rendered storage appId and backup account
session with its one-use intent. Selection and confirmation compare that origin
against current Redux storage, current Realm KeeperApp and session before reading
references or dispatching. Delete/archive actions carry the original app/session
so R4 middleware cannot silently bind them to a different account. Existing
wallet sagas and transactional guards remain unchanged.

Affected R5 files: src/screens/SigningDevices/DeleteKeys.tsx,
tests/screens/DeleteKeys.test.tsx, src/screens/Home/components/Keys/ManageKeys.tsx
(typed navigation dispatch adaptation), docs/r5/R4-RECONCILIATION.md,
docs/r5/WORKSTREAM.md, and this OpenSpec change. The baseline integration also
combines the existing R5 CI workflow and explicitly installs its Realm N-API
prerequisite before recovery tests; package.json/yarn.lock/Podfile.lock and native
inputs remain exact R4 bytes. No new UI component: reuse KeyCard, KeeperModal and
PasscodeVerify and existing theme tokens per DESIGN.md. Its implementation
checklist is satisfied without changing layout, text scale or critical controls.

Redux storage.appId is read; existing DELETE/ARCHIVE_SIGINING_DEVICE workers and
backup origin middleware consume the unchanged action fields. UI screens and
flows/login.yaml retain the existing native checkpoints; document the finite
account-switch/deletion Maestro scenarios instead of scripting destructive actions
against arbitrary users. Native execution remains an explicit follow-up.

## Risks / Trade-offs

Separate model tests do not prove real Realm/auth provenance or native account
switches. Run original R5 tests against the combined tree, add stale-origin
regressions, rerun existing R4 deletion/session checks and disclose every unrun
native/genuine fixture. The inherited public-v2 Relay fixture mismatch is baseline
debt; no backend/protocol/pin workaround belongs in this reconciliation.

Existing NewKeeperApp effects/timers also capture the production transport session.
Their active predicates combine effect lifetime and session equality. Tests use
the real counter with explicit account-transition fixtures; setup workers and
account/credential schemas remain unchanged. Affected files additionally include
src/screens/NewKeeperAppScreen/NewKeeperAppScreen.tsx and its existing screen test.
