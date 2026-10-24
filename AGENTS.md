# Bitcoin Keeper: Codex workflow

## Current R5 owner direction (22 October 2026)

R5 and subsequent ordinary development/native validation run in Cloud. Use hosted macOS/Xcode for iOS and hosted Android development/emulator runners; the owner's personal Mac is not a prerequisite. Preserve genuine phone/signer checks separately. The older Local handoff format below remains a compatibility record for the existing gate, not a request for the owner's Mac.

Candidate diagnostics are explicit read-only runs on the exact PR head. Add `keeper/native-diagnostic` only when scheduling the isolated integration candidate; the new workflow serializes iOS then Android and does not cancel active native work. Pre-merge diagnostic success never grants protected-base native acceptance. After approved installation, `Keeper release acceptance` is the default reusable worker route; `keeper/legacy-native` selects the serialized legacy startup fallback instead. New commits invalidate previous source evidence. Missing app feature/UI/backend/physical checks stay explicit and blocking where required.

Never merge, promote a shared branch, release-sign, upload, distribute, deploy or publish without the owner's explicit approval. Draft PR creation and isolated branch pushes are preparation, not release approval. See `docs/r5-cloud-native-reconciliation.md` for source identities and outstanding acceptance.


The default workflow is **Cloud code complete → hosted native validation → authorized physical checks → release review**. Before protected-base installation, run exact-candidate diagnostics and keep trusted acceptance fail-closed. The Local format below remains a compatibility fallback for an available authorized tester; the owner's personal Mac is not a prerequisite. Signing remains a separate approved action. Follow the [bootstrap adoption order](docs/cloud-bootstrap-preparation.md), including the later restacking of Phase A #7062. The GitHub pull request is the durable handoff between stages. Do **not** rely on one agent having access to another agent's conversation, unpushed changes, machine, or installed tools.

Repository: `KeeperCommunity/bitcoin-keeper`. Use `sprint` as the PR base unless the task explicitly specifies another base.

## R5 and future releases: permanent cloud-first default

Follow [the cloud release pipeline](docs/cloud-release-pipeline.md) for R5 and every
subsequent release. Complete code and representative native acceptance on hosted
iOS simulators/Android emulators, then assign remaining real-device checks to a
named authorized tester. The release owner's personal Mac is not the default
handoff destination. Keep the existing Local path below as the safe fallback
until each hosted capability is reviewed, installed and verified; its current
`Codex local handoff` / `State: NEEDS_LOCAL` syntax remains the gate protocol, not
a claim that a Mac session is always required. In that handoff, put hosted work
and run URLs in `Cloud checks`, and set `Local checks requested: NONE` only when
trusted hosted evidence satisfies all requested native checks and no physical
checks remain. Otherwise name the actual remaining checks and who can run them.

Bootstrap depends on reviewed [PR #7060](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7060);
check its current state. The initial Phase A candidate is stacked on that PR.
Its reusable `keeper-native-platform.yml` workflow is called by
`keeper-release-acceptance.yml` automatically for future PRs targeting `sprint`;
there is no R5-only release selector or manual copying step. The active R4 PR
#7045 is excluded. Do not change R4 source, refs, private fixtures, Mac work,
required gate or approval process. Installing #7060 and this infrastructure on
`sprint` requires independent review and owner approval. Diagnostic candidate
runs are not trusted acceptance for R5 or another source SHA.

Record the exact source SHA, workflow run/attempt, both platforms' actual
build/UI outcomes, safe artifact hashes and unresolved feature acceptance.
A startup smoke or representative probe does not prove R5's deletion, recovery,
upgrade or security matrix. Released R4 is already reconciled. Product checks must run on the exact combined
R5 candidate; unresolved high-risk cases remain blocking. Phase B protected
signing and distribution are **NOT IMPLEMENTED / NOT VERIFIED** until their
separate reviewed workflow and exact-artifact controls are proven. Do not merge,
sign, upload a beta, submit to a store or publish without explicit owner approval
for that action and artifact. Passing CI provides none of these approvals.

## Codex Cloud: implement and prepare handoff

1. Work in a task-specific branch; investigate, implement, add or update tests, and run suitable checks (for example, `npm run test` and `npm run lint`). Report actual pass/fail results; do not claim a native simulator was run unless it really was.
2. Open or update a GitHub PR with the code changes. Preserve the user's existing work; never overwrite or silently discard another branch's changes.
3. Before asking for local testing, add a section named **Codex local handoff** to the PR description (or a fresh PR comment), using this format:

   ```text
   ## Codex local handoff
   State: NEEDS_LOCAL
   PR: #<number>
   Base: sprint
   Head branch: <branch>
   Head commit: <full SHA>
   Goal and acceptance criteria: <concise description>
   Changes made: <concise description>
   Cloud checks: <commands and exact pass/fail/not-run outcomes>
   Required local checks: IOS, ANDROID
   Local checks requested: <targeted iOS/Android simulator, native build, and/or physical-device scenarios>
   Risks / known gaps: <known limitations or 'none known'>
   ```

4. For app/code changes, `Required local checks` must list one or more of `IOS`, `ANDROID`, `HARDWARE` (comma-separated). Use both iOS and Android for cross-platform changes; add hardware for signer/device interactions. If a reported native or physical check is unnecessary, explain why, but the GitHub gate exempts only documentation and `.github/` changes. The handoff must name the actual PR head commit SHA after the final cloud push.
5. Return the PR URL/number and actual platform `PASS`/`FAIL`/`NOT RUN` results for the current head. Use `NEEDS_LOCAL` for remaining native or physical requirements; successful trusted hosted evidence may satisfy `IOS`/`ANDROID` without a Mac login. Continue unrelated cloud tasks while remaining native or physical checks are scheduled. Follow [hosted native validation](docs/hosted-native-validation.md) for trust, bootstrap, scope and artifact limitations.
6. If a task needs only code review, explicitly state why local testing is not required rather than silently skipping it.

## Legacy Local validation format (available authorized testers)

When given **"Validate Keeper PR #<number>"**, first read the newest **Codex local handoff** section and inspect the PR head SHA.

1. Fetch the PR branch into a separate worktree or another safe checkout. Never reset, clean, or overwrite uncommitted user changes.
2. Verify the exact tested commit. Perform the **requested** native build and simulator/emulator scenarios using the available local tools. The repo defines an iPhone simulator script (`npm run ios`), Android development script (`npm run androidDevelopmentDebug`), and Jest tests. Do not assume signing credentials, device access, or an emulator are configured.
3. Run relevant regression checks and record outcomes. If hardware-wallet, NFC, USB, camera, or real-device behaviour matters, distinguish physical-device tests actually performed from tests requiring a person/device.
4. If bugs are found, make targeted fixes on the PR branch when permitted, push those changes, and retest the new SHA.
5. Leave a PR comment in this format:

   ```text
   ## Codex local validation
   State: LOCAL_PASSED | LOCAL_FAILED | BLOCKED
   Tested commit: <full SHA>
   iOS build/simulator: <pass/fail/not run + details>
   Android build/emulator: <pass/fail/not run + details>
   Real devices/signers: <pass/fail/not run + details>
   Other checks: <commands and outcomes>
   Open issues / next action: <concise next step>
   Release readiness: <ready for review / not ready>
   ```

6. Report the result and PR link to ChatGPT/the user.

### Owner-directed post-release test scope

Keep `HARDWARE` in the Cloud handoff when signer or real-device interaction matters. If physical phones, cameras, NFC/USB, or hardware signers are unavailable before release, the release owner may defer only those physical checks to a post-release follow-up. Record the decision in a **new** PR comment so the original handoff and validation evidence remain intact:

```text
## Codex local scope decision
State: OWNER_DEFERRED_PHYSICAL
PR: #<number>
Head commit: <full current PR head SHA>
Deferred local checks: HARDWARE
Reason: <why physical checks will occur after release>
Post-release follow-up: <who will test which devices and report the results>
```

For this repository, the gate accepts that decision only from the release-owner GitHub account `antuz123`, with current write access, for the exact PR and head SHA. A newer owner scope decision for the same PR and SHA supersedes an older one. A new commit needs a new scope decision and local report. The decision cannot defer `IOS` or `ANDROID`, and it cannot turn a failed physical test into a pass.

Run all feasible automated, simulator/emulator and disposable checks before public submission. The owner may place inaccessible, noncritical scenarios in post-release testing on the actual installed release, consistent with the release checklist. Record each one explicitly as `NOT RUN / POST-RELEASE` in `Open issues / next action`, with its reason and follow-up. This does not waive a failed check or remove `IOS` or `ANDROID` from the gate; only the exact-SHA decision above can subtract `HARDWARE` from automatic gate requirements.

After every required iOS or Android check actually passes, Codex Local may report `LOCAL_PASSED` for the **tested subset** in a new comment after the scope decision and put `NOT RUN` or `DEFERRED` at the start of `Real devices/signers`. The resulting gate status says which checks passed and that hardware was owner-deferred. `LOCAL_PASSED` must never imply that deferred scenarios ran. Track the owner's post-release results on the PR or release record.

A known critical defect is not eligible for post-release deferral. In particular, suspected loss or misbinding of keys, recovery material, funds or backups, incorrect recipient/amount/policy signing, and a failed required iOS or Android check must be resolved and retested before release. Keep other release evidence and decisions separate, including independent review, fresh store histories and counters, production configuration, signed artifact identity and version correctness, and explicit approval to sign or publish.

## Release safety and coordination

- `LOCAL_PASSED` means only the reported checks passed on the reported commit. It is **not** approval to merge, sign, distribute, upload to TestFlight/Play Store, or publish a release.
- Release operations require **explicit user approval** for the intended build, environment, and distribution channel.
- ChatGPT is the coordinator: when the user shares a PR or asks for a handoff/status, inspect the latest PR details and comments; then provide the next exact copy-and-paste prompt for Cloud or Local Codex. ChatGPT should not claim to know Codex's private session state or that the Mac is currently available.
- `NEEDS_LOCAL` is the legacy status label for outstanding checks; it does not require the owner's personal Mac. Continue hosted native work and name genuine physical-device dependencies explicitly.

## GitHub merge gate

The `.github/workflows/keeper-local-validation.yml` workflow posts commit status `keeper/local-validation` for the current PR head SHA. For code changes, it requires a trusted exact-head Cloud handoff. Each required `IOS`/`ANDROID` platform needs either a genuine successful hosted native build **and** disposable UI smoke from the selected reviewed reusable or legacy hosted route, or a repository collaborator's exact-head `LOCAL_PASSED` report. A hosted run is trusted only when its workflow and complete `.github/native/` harness match the protected current base and the run's original base; PR-authored check names, comments and artifacts alone are not CI evidence. New or changed CI infrastructure must first be reviewed and merged before it can provide authoritative native evidence. The latest run/attempt must contain successful build and smoke steps for that platform; stale, skipped, cancelled, pending, build-only or untrusted evidence supplies no hosted pass. A latest explicit local failure remains blocking. `HARDWARE` still requires the existing local physical result or exact-SHA owner decision and subsequent honest local report above. New commits invalidate previous native evidence, local sign-off and deferral. Documentation and `.github/`-only PRs are exempt from native tests.

This workflow **reports** a status; to **enforce** it, repository administrators must require the `keeper/local-validation` commit status for merges to `sprint` in GitHub Rulesets or branch protection. Require the existing `Tests` CI check as well. This is a review/test gate, not a guarantee that tests were actually executed; agents must report actual results truthfully. Release signing, TestFlight, Play Store, and production deployment remain separate and require explicit user approval.
