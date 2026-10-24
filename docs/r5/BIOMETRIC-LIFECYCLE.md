# R5 biometric callback correction and bounded triage

Source baseline: `c1c4b803039b61b940373c4dc9d08473cf25e042` (R5 core plus the
5.1 protected-backup and Version History corrections). This is a separate narrow
follow-up, estimated at 1k–3k changed code/test tokens. It does not change
credentials, signature verification, PIN attempt rules, storage or native inputs.

## Independent review follow-up

Review of the initial callback correction at
`257fbe17e1a85d0e5d7e5d8ab97e1a69edbd9628` found that its new `loggingIn`
dependency reopened native biometrics after an authentication failure. The
failure handler sets `loggingIn` back to false, so a failed biometric credential
check, or an incorrect PIN after cancelling biometrics, scheduled another prompt
and interrupted the PIN fallback. A batched A → B → A account transition also
left a queued/pending callback active if React only rendered the final A. The
downstream authentication worker captures its epoch after dispatch, so it could
not reject that callback on the basis of its earlier prompt epoch. These are
component reproduction results, not proof of a successful native unlock or an
authentication bypass.

The narrow follow-up retains effect cleanup and allows one automatic prompt per
eligible principal/session. A PIN submission consumes that scope's automatic
attempt. Cancellation or authentication failure leaves PIN fallback available;
ordinary logging state changes cannot open another prompt. A real principal or
login-method change and a completed cooldown may permit a fresh prompt. The
queued callback checks the existing live backup-account epoch before invoking
native biometrics and again before dispatching its result. No authentication
protocol or signature verification rule changed.

Six added component controls preserve a failing-before comparison against the
initial correction: **4 FAIL / 13 PASS** before, **17 PASS / 0 FAIL / 0 SKIP**
after. They cover biometric-authentication failure, cancelled-prompt → incorrect
PIN fallback, queued and pending batched account cycles, a new principal, and a
completed cooldown. The existing initial-correction and PIN cases also pass.
Focused Login ESLint remains **FAIL: 12 errors / 4 warnings** on both sources,
with zero added/removed findings after line-offset normalization. Modified-test
ESLint, formatting and whitespace checks pass. Whole TypeScript and native
checks were not rerun by this follow-up; the initial patch's 943-diagnostic
TypeScript comparison below remains historical until the combined candidate is
checked. The new source/test delta remains within approximately 1k–3k changed
tokens and is kept as a separate review commit.

## Demonstrated login defect

The prior login function placed an asynchronous native biometric request inside
a delayed callback, with a `try/catch` around timer scheduling. A rejected native
promise therefore escaped that catch. The timer and pending result also survived
the login screen's unmount, account changes and successful PIN authentication.

Six new component cases invoke the actual production timer callback with a
controlled native boundary. With the baseline login source, five fail and six
pass (including the five existing PIN regressions). The failures demonstrate an
unhandled native rejection, a queued prompt after unmount, and an authentication
dispatch from a late successful prompt after unmount, account change or PIN
authentication. They do not establish a native-device failure or an account
isolation exploit; the downstream authentication checks remain separate.

The correction owns the delay and pending-result lifetime in one React effect.
Cleanup cancels the delay and makes an outstanding result inactive. Native
rejection is caught inside the asynchronous callback; PIN login remains
available. Only a successful active prompt dispatches authentication, using its
captured originating account. A login already in progress or authenticated does
not schedule a new prompt. The native cancellation/error object is not logged.

Actual check: `jest tests/screens/PinEntry.test.tsx --runInBand --coverage=false`
passes **11/11**, including the successful-current-prompt control and all existing
rapid-entry, deletion, confirmation and navigation cases. This uses mocked
native biometric/Firebase/storage boundaries, not real biometric evidence.

Focused Login ESLint remains **FAIL: 12 errors / 4 warnings**, with the same
rules/messages as the baseline after normalizing line offsets. Explicit
`eslint --no-ignore` on the modified test is **PASS: 0 errors / 0 warnings**.
Whole TypeScript remains **FAIL: 943 diagnostics** both before and after, with
zero added/removed normalized diagnostics. Formatting and whitespace checks pass.
These comparisons use the same installed dependencies; no clean whole-lint or
typecheck claim is made.

## Other approved app investigations

- **#7055 navigation: unresolved / no speculative fix.** The current footer uses
  `home_tab_wallets`, `home_tab_keys`, `home_tab_ask` and `home_tab_more` test IDs.
  Its Home callback navigates to `Home` with `selectedOption`; the tab content has
  a keyed, non-collapsable native parent inherited from R4. Neither module calls
  BackHandler/exitApp or finishes an activity. The preserved Android 17/API 37
  multiuser failure is not dismissed by this source trace. The native matrix must
  still exercise ordinary single-user Wallets → More → Wallets after explicit
  backup opt-in/Delete, cold launch and account changes, preserving wallets,
  labels and the disabled/deleted backup state. No navigation runtime pass is
  claimed here.
- **#6991 timezone: not reproduced / no speculative fix.** Production transaction
  rows use local `moment(date)` formatting; transaction details also use local
  `moment(transaction.date)`. Existing four-process UTC/Kolkata/New York/London
  tests cover confirmed, pending and cached rows plus DST/rollover vectors.
  Those Node results do not prove Android/Hermes behavior, device-timezone changes
  while the app runs, or correct persisted source timestamps. Native list/details
  reproduction remains open.
- **#7007 PIN: shipped correction retained.** The issue's current owner evidence
  records the core rapid-entry and fixed-Proceed correction as shipped in 2.5.17.
  The five existing component cases still pass alongside this patch. Current
  exact-candidate native PIN/login and physical biometric/accessibility checks
  remain required. No shipped PIN rewrite was introduced.
- **Emergency Key copy: existing correction retained.** Both EN and ES resources
  have a distinct `resetEKDesc` naming Emergency Key and `resetIKDesc` naming
  Inheritance Key; the corresponding reset screens select the matching helper.
  Fresh JSON distinction assertions pass for both resources. This verifies
  identifiers and the scoped distinction, not translation quality or native
  layout. Timelock calculations are unchanged.
- **#6840 backup naming: 5.1 retained.** Protected-backup terminology, status and
  consent/delete explanations are already in the 5.1 package and its evidence
  document. No availability or successful live-backup claim is added here.

## Remaining acceptance

Hosted iOS/Android feature acceptance must test the final combined candidate,
including native prompt failure/cancel → PIN fallback, account switch/relock,
and no second authentication from a late result. Actual physical biometrics
require actual devices and an authorized tester. These checks are **NOT RUN** by
this package; emulator evidence cannot replace physical evidence. The owner's
personal Mac is not a prerequisite for the Cloud route.

The separate 5.2 producer/handoff must be identified and reviewed for overlap
before integration. No 5.2 completion or combined native acceptance is inferred
from these tests. No merge, signing, upload, distribution or deployment occurred.
