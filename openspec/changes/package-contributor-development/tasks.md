## 1. Infrastructure and developer workflow
- [x] Package backend pins, local adapters and isolated Compose services.
- [x] Add bootstrap, environment generation, status/stop and Android forwarding commands.
- [x] Separate native setup from the JavaScript install hook.
- [x] Document supported capabilities, data lifecycle and native toolchain steps.
- [x] Add a contributor guide and PR template covering OpenSpec, test evidence and Keeper-owned security review, acceptance, merges and releases.

## 2. Tests
- [x] Pass fresh-source backend API and V3 Server Key checks.
- [x] Pass persistence and configuration boundary checks.
- [x] Pass fresh-checkout dependency install and native development builds.
- [x] Validate OpenSpec and record exact acceptance evidence and limitations.

## 3. Handoff
- [ ] Validate contributor setup and native builds against `sprint`.
- [ ] Make CI execute tests, publish coverage and report analysis failures honestly.
- [ ] Repair or obtain administrator repair of SonarCloud repository access/binding.
- [x] Review and obtain approval for the concrete commit/push before publishing (approved in this task on 26 September 2026).
- [ ] Have a second developer/machine execute the published setup.

No UI/store/storage changes; no migration or new Maestro flow is required.
