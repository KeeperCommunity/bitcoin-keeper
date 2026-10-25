## 1. UI Components
- [x] 1.1 Preserve existing components, confirmation/cancel/privacy and helper copy against released source.

## 2. Business Logic / Hooks
- [x] 2.1 Capture and validate deletion origin before selection/confirmation, including A → B → A.

## 3. Store (Slice + Saga)
- [x] 3.1 Carry original app/session on delete/archive actions; retain R4 workers/middleware unchanged.

## 4. Storage
- [x] 4.1 Verify no schema/MMKV/store-shape change; no Redux Persist migration bump needed.

## 5. Tests
- [x] 5.1 Add stale account/session/Realm confirmation and retained-card regressions, with failing controls.
- [x] 5.2 Run frozen setup/patches, affected Jest/recovery/security/quality and baseline comparison.
- [x] 5.3 Record exact baseline, R5-only diff, results and unresolved native/genuine gaps.

## 6. E2E Flows (Maestro)
- [x] 6.1 Preserve login flow, document finite deletion/account-switch/native measurements.
- [ ] 6.2 Execute relevant IOS/ANDROID/HARDWARE scenarios when available; retain NOT RUN otherwise.

Native task6.2 remains NOT RUN; no archive or acceptance claim. Ruby-dependent
local checks remain unavailable and are explicitly retained in the validation report.

## 7. Existing startup callback ownership
- [x] 7.1 Reproduce pending-token/delayed-navigation account-session crossings (6 assertion failures /14 passes).
- [x] 7.2 Guard effects/timers by their captured session and rerun focused/full Jest (20 startup, 106 focused, 538 full PASS).
