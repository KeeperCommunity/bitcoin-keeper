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

- [x] Update backend pins/adapters to the reviewed cleanup candidates and repeat fresh Docker API, V3/2FA, persistence and configuration-boundary checks; final security acceptance remains open.

- [x] Rebuild iOS/Android for updated backend ports and verify disposable onboarding, native app records, Wallets and More Options; distinguish automated assertion failures and visual continuation.

## 3. Handoff
- [ ] Complete backend source/history credential hygiene, security/dependency review and reproducible setup before granting broader private access; private visibility does not waive readiness.
- [x] Document approved contributor access, GitHub profile/context review, resource grants and invitation/setup confirmation; no per-local-change permission.
- [x] Keep access/admin intake internal and remove the public contributor-access issue template; retain public issues for user-facing features and bugs.
- [ ] Provision and verify private backend CI access without exposing credentials to fork code; retain the honest failing check until resolved.
- [x] Validate native builds and authorized local backend setup against `sprint`.
- [x] Make CI execute tests and publish coverage; backend source access remains a failure. SonarCloud is explicitly deferred, not reported as passing.
- [x] Review and obtain approval for the concrete commit/push before publishing (approved in this task on 26 September 2026).
- [ ] Have a second developer/machine execute the published setup.
- [x] Prepare an independent-machine checklist and private results template, distinguishing passed, failed/blocked and untested checks.

## 4. Deferred by the project owner
- [ ] Restore SonarCloud after administrator verification/repair of binding and access; review actual analysis and quality-gate findings. This is outside the current handoff scope.

No UI/store/storage changes; no migration or new Maestro flow is required.
