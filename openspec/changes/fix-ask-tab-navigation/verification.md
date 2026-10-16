# Navigation regression verification — 26 September 2026

## Status and scope

Fix prepared locally on `codex/fix-ask-tab-navigation`, based on published source
`e79e16b572d6e3472ac94500bf812d937bd89135`. Not committed, pushed, merged or
released. The user explicitly requested holding this fix for a later grouped
release. No version allocation is needed until that release is prepared; use a
new version/build and the existing release checks then. Published 2.5.15 remains
unchanged.

Only runtime changes: retain a native, non-collapsing Home content View with the
selected tab as its key; add stable selectors to the existing footer controls.
No wallet, key, transaction, recovery, storage or chat logic changed.

## Before/after evidence

The user's physical iPhone 15 Pro Max report was reproduced in the unmodified
2.5.15 Release simulator app on a fresh iPhone 15 Pro Max simulator running
iOS 26.4: empty Ask → More retained Ask prompts/security text and lost the
footer. The same sequence passed after replacing the JS bundle with the fix.

This verifies the app-level boundary correction. It does not establish the exact
upstream Fabric mounting defect; the native logs did not expose the failing
transaction. The user's physical iOS version is unknown.

Private evidence directory:
`/Users/devaccount/Workspace/keeper-local-dev/ask-navigation-evidence/`

- Before: `empty-switch-baseline.log`, `empty-before.png`, `empty-after.png`.
- After: `fixed-ios-retry.log`, `fixed-empty-before.png`, `fixed-empty-after.png`.

## Test matrix

| Check | Environment | Result / evidence |
| --- | --- | --- |
| Original empty Ask → More failure | iPhone 15 Pro Max / iOS 26.4 simulator | Reproduced before; passed after |
| Ask → More / Wallets / Keys, three cycles (nine exits) | Same iPhone simulator | PASS, `ios-repeated-tabs-retry.log` |
| Same nine exits with Recovery Key reminder present | iPhone 13 mini / iOS 26.4 simulator | PASS, `small-ios.log` |
| Three exits at extra-extra-extra-large system text size | iPhone 15 Pro Max simulator | PASS, `ios-large-text.log`; restored normal size afterward |
| Nine empty-state exits | Android 17 emulator, disposable user 10 | PASS, `android-tabs-final.log` |
| Existing chat → keyboard focus → back → history → main tabs, three cycles | Android emulator | PASS, `android-history.log` |
| Repeated disclaimer dismiss/reopen, About Ask return, keyboard/back/history/tab switches | Android emulator | PASS, three cycles, `android-info-retry.log` |
| Same information/modal/keyboard/history flow, three cycles | iPhone 15 Pro Max simulator | PASS, `ios-history-final.log` |
| Keys add-sheet and Wallets type-sheet open/cancel, then Ask → More | iPhone 13 mini simulator | PASS, `small-key-modal.log`, `small-wallet-modal.log`; no key or wallet created |
| Relevant existing unit suites | Local Jest | PASS, 27 tests in two suites, `jest.log` |
| Formatting, whitespace, release-version consistency, strict OpenSpec validation | Local checks | PASS |

The automated flows assert both absence of stale Ask content and presence and
operation of the footer, rather than merely checking that no crash occurred.
Chat checks use disposable conversations with a predefined nonsensitive question.
An iOS response was received; Android AI-provider availability is not an acceptance
claim of these navigation tests. No funds were transferred.

## Test build limits

- iOS: existing Release simulator native binary, with a fresh production-mode
  Hermes JS bundle containing the fix, locally ad-hoc signed. No new native
  dependencies; not a fresh Xcode archive or distributable IPA.
- Android: existing debug native app using the fixed JS through Metro and local
  backend configuration. Not a signed production APK/AAB validation.
- Two iPhone device sizes share iOS 26.4. No second iOS-version coverage or
  physical-device verification. Enlarged-text checks concern navigation, not a
  full accessibility audit.
- The physical iPhone follow-up remains tagged **Office** in T-066. When an
  eventual test build is available, repeat the reported exits and history/back
  sequence on that iPhone. No user action is needed now.
- Before public release: review/commit the patch, create fresh signed artifacts
  with new verified version/build numbers, and rerun these flows on the intended
  release builds. Do not overwrite published artifacts or the existing tag.

## Earlier harness failures, retained for audit

Initial attempts encountered onboarding/notification dialogs, an overly strict
wallet text selector (iOS merges accessibility labels), and an information-link
selector that omitted its arrow. The info button opens a disclaimer first, then
its Learn more link opens About Ask Keeper. The flow now follows that real path.
These setup/selector failures are retained separately from the reproduced
application failure; they are not counted as successful test runs.

## Reusable regression rule

When changing Home content or navigation, exercise both empty Ask and saved-chat
history, with the Recovery Key reminder visible, including keyboard dismissal,
modal/information return and repeated exits to every sibling tab. Check rendered
content and footer reachability on native iOS and Android; mocked React tests do
not validate native view mounting. Preserve an explicit native tab-content
boundary around elevated/absolute-positioned children and keep the footer outside
it. Do not weaken native renderer assertions as a substitute for regression tests.

## Environment restored

The Android disposable profile's debug preferences were restored and verified,
the task-specific port 8085 reverse was removed, and the emulator was returned to
its original user 0. Disposable QA data and evidence were retained. iOS system
text size was restored to its original setting. Other Metro servers were untouched.
