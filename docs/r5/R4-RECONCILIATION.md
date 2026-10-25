# R5 reconciliation against released R4 / 2.6.4

The owner explicitly confirmed on 22 October 2026 that 2.6.4 is live on the app
stores. That confirmation resolves the earlier stale-record discrepancy; GitHub
PR/tag status and regional store caches are not prerequisites for R5 work.

## Baseline and history

Released artifact source: `1d8a86a7462d935cbd0e28b857934b5718c152fc` (R4 / 2.6.4,
iOS620, Android627). The recorded signed-artifact/source checkpoint identifies
this exact source. The source is now an ancestor of the isolated R5 branch through
reconciliation commit `a8947c867562b6148f328289069785b18053b944`.
The earlier R5 head5954 and its history are also preserved. No R4/sprint/other
workstream ref was changed, no force push occurred and no GitHub PR was merged.

The single yarn.lock conflict was resolved to the **exact released R4 lockfile**.
That file already includes both missing ESLint selectors repaired earlier in R5,
so retaining the obsolete R5 resolution would have been incorrect. package.json,
yarn.lock, Podfile.lock, Android/iOS native inputs, version metadata and existing
backup/backend/store/worker modules remain byte-identical to the released source.

The PR remains based on sprint per repository guidance. Until released history is
carried to sprint by its owner, its ordinary diff includes inherited R4 history.
Review R5's own scope as `git diff 1d8a86a...<R5-head>` (the PR handoff links that
range). This inherited history is not new R5 scope or permission to merge R4.

## Combined-source changes and findings

- R4's local transaction checks **all retained Vault signer references** before
  deleting a Signer. R5 retains that guard, its current-reference UI checks,
  archived retention, protected-key exclusions and one-use passcode intent.
- R4 stamps action origin at dispatch. Eleven new screen regressions demonstrated
  that an earlier R5 confirmation could reach that boundary after an account
  switch or A → B → A round trip. Selection/confirmation now compare their original
  app/session with current Redux and Realm ownership. Delete/archive actions carry
  the original app/session explicitly, preventing dispatch-time rebinding. These
  tests use production transport-session tracking, identity and action creators;
  native UI, Realm access and the Redux state getter are modeled boundaries.
- R5's Keys entry uses the released navigation dispatch pattern; this removes the
  TypeScript overload mismatch exposed by integration. No shared PIN/navigation
  implementation, transaction formatting or timelock calculation changed.
- Six additional startup regressions reproduced token completion and delayed
  navigation crossing an A → B → A session change. The existing effects/timers
  now retain their originating session, including a retained Next callback.
  Setup and notification workers are unchanged; native persistence remains unrun.
- Emergency reset uses its Emergency-specific helper; Inheritance retains its
  own helper. Native display checks remain open.
- Existing R5 frozen JavaScript CI preparation is retained. Its recovery lane now
  explicitly installs the released Realm N-API binary, and existing Ruby setup
  precedes all Ruby-dependent guards. No dependency version or workflow gate was
  changed. The existing public-v2 genuine backend fixture remains baseline debt;
  no protocol, readiness, pin, backend deployment or scanner waiver was introduced.

Repository OpenSpec planning artifacts for this reconciliation were committed with
the baseline integration before the new ownership guard was implemented. DESIGN.md
was reviewed; existing components, layout, theme and critical controls are retained.

## Executed Cloud checks

Node22.23.3 / Yarn1.22.22:

- Frozen install PASS; all six explicit dependency patches PASS. Released
  package/lock/Pod/native/version input-immutability checks PASS.
- Final full Jest **47 suites /538 tests PASS**, zero failures/skips, including
  the released loopback Electrum fixtures. Final R5-focused run **5 suites /106
  tests PASS**, including 53 deletion and 20 first-use screen cases.
- New guard controls before implementation: **11 assertion failures**, with the
  other42 deletion tests deliberately deselected (not execution passes). All53
  deletion tests pass after the fix. Real account-round-trip session tracking is
  used; this does not prove actual native authentication/Realm provenance.
- Startup session controls before implementation: **6 assertion failures /14
  passes**. All 20 pass after the fix, including original-session navigation and
  the existing retry, duplicate-attempt and unmount cases.
- Full recovery **480/480 PASS**, zero skips. Initial execution had470 passes and
  one file-load failure because the Realm N-API binary was absent. The exact
  released binary was installed with prebuild-install; the10 encrypted Realm
  cases then passed and the complete recovery rerun passed. These are Linux Realm
  tests, not iOS/Android app-native acceptance.
- Gate contracts **11/11 PASS**. Static Android16KB/reproducibility checks **31 PASS**.
  Version consistency, JSON/YAML/prerequisite ordering, formatting, OpenSpec strict
  validation and diff checks PASS.
- Release-tool Node **28 PASS** and Python **7 PASS**. Local Ruby is unavailable:
  the combined release command stops at Ruby. A related guard run recorded30 PASS
  and11 failures from its missing Ruby runner; those failures are preserved and
  not reported as app regressions or passes. Hosted CI now sets up the existing
  Ruby3.3.8 prerequisite before these unchanged checks.
- Focused lint remains **FAIL82 errors/25 warnings**, versus85/25 on released R4
  for the same six modules/dependencies; normalized0 added,3 removed.
- Whole TypeScript remains **FAIL943 diagnostics**, versus944 on released R4 with
  the same dependencies; normalized0 added,1 removed. The transient new navigation
  overload finding was fixed before this comparison. Neither check is clean.

The exact final SHA and hosted checks are recorded in the PR handoff. A full
app-native build/install/UI, performance measurement or physical-device result
must not be inferred from any JavaScript or Linux Realm result.
The R5-only changed code/test estimate is approximately 18.1k tokens using changed
characters/4, at the upper edge of the original 13k–18k estimate. Scope remains two
substantial features; no additional investigation fix or infrastructure is added.

## Finite native handoff

Use the final PR head, reuse compatible released-R4 caches and preserve all data.
Cloud development remains primary; optional Linux setup is not a prerequisite.
The separate hosted-native infrastructure PR is not imported as another R5 feature.
Where that approved route is available, run its exact-head development startup
build/smoke; use the Mac only for remaining platform/feature/device checks.

Before any Mac work, read its actual local guidance, measure free disk and use the
larger actual build forecast (approximately6GiB is only a planning floor), one
native build at a time. Never delete other worktrees, simulators/AVD users,
wallets/databases, caches, artifacts or evidence without approval.

1. IOS and ANDROID: new development artifacts from the exact head; cold/warm/resume,
   theme/network/Tor, credential error/retry, deep-link/auth and small display cases.
2. Disposable account only: unused visible/hidden key cancellation/deletion, active/
   hidden/canary/multi-wallet blocks, archived retention, new references during
   confirmation and same-key account/session changes (including A → B → A). Preserve
   real wallets; test against an approved disposable fixture, not production data.
3. Setup offline/failure/repeated Retry/Next, success/relaunch and persistent wallet
   counts; measure at least five raw first-wallet/startup samples with exact build,
   device/OS/network configuration. Do not substitute the animation duration or
   unit-test wall time for native performance.
4. Bounded #7055 More→Wallets and #6991 device timezone/DST/history/details checks;
   no speculative patch. Verify Emergency/Inheritance helper and shipped Assisted
   Server Backup copy. Owner-parked #7056/#7057 remain excluded.
5. HARDWARE: actual physical PIN/biometric/device scenarios remain explicit. R4's
   physical deferral is not an R5 pass or automatically transferable scope decision.

No PR merge, signing, store action, deployment or release is authorized by passing
these checks. R5 remains a draft with unrun native acceptance and review visible.
