## Context

The current Donate Dust confirmation is rendered from `src/screens/UTXOManagement/UTXOManagement.tsx` using `KeeperModal` with static localized strings. The screen already derives the current donation set from the active `Wallet` or `Vault` by filtering confirmed and unconfirmed `UTXO` entries where `spendability === 'doNotSpend'`, and each `UTXO` may also carry `isManualOverride` when the user manually marked it Do Not Spend.

The donation flow estimates fees only after the user taps the confirmation button. That means the UI can know the current UTXO count, gross satoshi total, and whether any manually marked coins are included before the transaction is built, but it cannot know the final net donation amount yet.

This is a UI-only clarification change. It does not alter coin selection, fee calculation, Redux state shape, Realm schemas, MMKV keys, or the downstream PSBT signing flow.

Affected files:
- `src/screens/UTXOManagement/UTXOManagement.tsx`
- `src/context/Localization/language/en.json`
- Donation confirmation UI tests under `tests/`

Redux slices and sagas involved:
- `sendAndReceive` slice and existing send sagas remain part of the donation execution path, but no reducer or saga changes are required for this disclosure update.

UI pattern references from `DESIGN.md`:
- Reuse the existing `KeeperModal` confirmation surface rather than introducing a new component.
- Keep copy calm and explicit, with one main decision at a time.
- Reuse existing text/color tokens already used inside the modal content.

Agent implementation checklist alignment:
- Reuse existing modal and text primitives.
- Keep visual hierarchy consistent with existing confirmation sheets.
- Avoid adding new visual language or decorative UI.

## Goals / Non-Goals

**Goals:**
- Show an explicit Donate Dust summary line with the current Do Not Spend UTXO count and total value in satoshis before fees.
- Show an additional line when the donation set includes one or more `UTXO` entries with `isManualOverride === true`.
- Preserve the existing donation button flow, eligibility check, and locked signing path.

**Non-Goals:**
- Changing which UTXOs are included in Donate Dust.
- Estimating or displaying the final post-fee donation amount inside the confirmation before fee calculation runs.
- Introducing new Redux actions, saga branches, database fields, or migrations.
- Redesigning the modal layout beyond inserting the new disclosure lines.

## Decisions

### Decision 1: Derive disclosure values from the existing `doNotSpendUTXOs` array at render time

**Decision:** Compute the modal disclosure from the already derived `doNotSpendUTXOs` collection in `UTXOManagement`: count via `length`, total sats via a local sum, and manual inclusion via `some((utxo) => utxo.isManualOverride)`.

**Rationale:** These values are synchronous and always available before the user confirms. Using the existing array keeps the copy aligned with the exact inputs that will be passed into `calculateSendMaxFee` and `sendPhaseOne`.

**Alternative considered:** Wait for fee estimation and show the net donation amount in the modal. Rejected because the current UX intentionally opens the confirmation before any async work, and the minimal change requested is disclosure, not flow rework.

### Decision 2: Use “before fees” wording for the total amount

**Decision:** The new summary line will state the gross total “before fees,” not “after fees.”

**Rationale:** The confirmation knows the selected UTXO pool total, but not the final network fee yet. Gross total is accurate at modal-open time; post-fee total is not.

**Alternative considered:** Keep “after fees” copy with the gross total. Rejected because it would be factually incorrect.

### Decision 3: Keep the manual-mark disclosure binary and conditional

**Decision:** Render a second line only when at least one included `UTXO` has `isManualOverride === true`, using a concise warning that manually marked Do Not Spend coins are part of the donation.

**Rationale:** This covers the main ambiguity raised in review without changing behavior or requiring pluralization/count-specific copy.

**Alternative considered:** Show the exact number of manually marked coins. Rejected for now to keep the copy and localization change minimal.

### Decision 4: Implement as localized strings inside existing modal content

**Decision:** Add new translation keys in `en.json` and interpolate the dynamic values from `UTXOManagement` into the existing `KeeperModal` content block.

**Rationale:** This keeps the change localized to the existing confirmation surface, preserves current styling, and avoids introducing a new component for two short text lines.

**Alternative considered:** Add a dedicated summary card or richer details section. Rejected as unnecessary scope for a pre-merge disclosure improvement.

## Risks / Trade-offs

- [Gross total may be mistaken for the donated amount] -> Mitigation: explicitly include “before fees” in the summary line.
- [Manual-inclusion line adds warning density to a small modal] -> Mitigation: keep the second line short and render it only when needed.
- [Future changes to Donate Dust eligibility could drift from the copy] -> Mitigation: derive the disclosure directly from the same `doNotSpendUTXOs` array used to build the transaction inputs.

## Migration Plan

- No migration is required.
- No Realm schema changes, MMKV additions, or Redux Persist version bumps are needed.
- Rollback is a simple code revert of the modal disclosure lines and localization keys.

## Open Questions

- Whether the summary line should keep the literal word “coins” for all counts or add singular/plural handling can be decided during implementation.
- Whether the manual-mark line should eventually show an exact manual coin count is intentionally deferred.
