## 1. Investigation
- [x] Inspect user screenshot and existing T-066 evidence; inspect Home/Ask/footer code.
- [x] Reproduce the empty Ask tab-switch failure in the unmodified release simulator.
- [x] Identify and verify the smallest native-lifecycle correction.

## 2. UI components
- [x] Implement the verified boundary correction and stable footer selectors.
- [x] Preserve copy, styling, routes and wallet/chat data.

## 3. Business logic, store and storage
- [x] No changes required; no migrations or signing/recovery changes.

## 4. Tests and Maestro
- [x] Run the same regression before/after on iOS, retaining failure evidence.
- [x] Verify repeated tab changes and chat-history return on iOS.
- [x] Check Android and smaller-screen/larger-text behavior; record exact limits.
- [x] Run relevant automated checks and strict OpenSpec validation.
- [x] Record the physical-device follow-up under Office, update T-066 and prepare the local review package.

## 5. T-053 maintenance candidate — authorised 28 September 2026
- [x] Review the prepared local fix for the selected maintenance batch.
- [ ] Allocate new verified version/build numbers; build and test signed artifacts.
- [ ] Optional physical iPhone follow-up; record simulator coverage separately.

Fresh release candidates are requested. Preserve published 2.5.15. See verification.md for earlier evidence and test limits; record fresh-build results separately.
