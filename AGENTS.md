# Bitcoin Keeper: Codex workflow

This repository uses a **ChatGPT → Codex Cloud → Codex Local (Mac)** workflow for coding tasks. The GitHub pull request is the durable handoff between stages. **Claude Sonnet 5.5 performs one independent, advisory code review after Cloud Codex finishes and before the local validation handoff.** Do **not** rely on one agent having access to another agent's conversation, unpushed changes, machine, or installed tools.

Repository: `KeeperCommunity/bitcoin-keeper`. Use `sprint` as the PR base unless the task explicitly specifies another base.

## Codex Cloud: implement and prepare handoff

1. Work in a task-specific branch; investigate, implement, add or update tests, and run suitable checks (for example, `npm run test` and `npm run lint`). Report actual pass/fail results; do not claim a native simulator was run unless it really was.
2. Create the PR as **draft** while coding, review, and tests are still underway. After the final Cloud changes and tests, update the handoff with the exact PR head SHA and mark the PR **ready for review**. This triggers the budget-limited Claude review's first automatic attempt. Reopening or repeating draft/ready transitions does not buy another review. Preserve the user's existing work; never overwrite or silently discard another branch's changes.
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

4. For app/code changes, `Required local checks` must list one or more of `IOS`, `ANDROID`, `HARDWARE` (comma-separated). Use both iOS and Android for cross-platform changes; add hardware for signer/device interactions. If no Mac tests are necessary, explain why, but the GitHub gate exempts only documentation and `.github/` changes. The handoff must name the actual PR head commit SHA after the final cloud push.
5. After the PR is ready, check its latest **Independent Claude review** comment: it must say `COMPLETE` and identify the current full head SHA and base tip. Treat findings as actionable input, not as human or merge approval. Fix significant issues before Mac handoff, or clearly flag unresolved concerns. After significant fixes, a collaborator with write/maintain/admin access requests a fresh review by commenting `/claude-review <current full head SHA>` once, after fixes and tests are complete. A completed review of that same head/base pair is reused. A new comment cannot exceed the permanent two-attempt/head and three-attempt/PR limits. Stale, incomplete, failed or uncertain paid attempts require an explicit new maintainer comment; automatic events never silently retry them. Report failures or missing results honestly.
6. Return the PR URL/number and state `NEEDS_LOCAL` to the user so ChatGPT can generate the exact local handoff prompt. Continue unrelated cloud tasks while waiting for a Mac.
7. If a task needs only code review, explicitly state why local testing is not required rather than silently skipping it.

## Codex Local (Mac): validate the PR

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
- ChatGPT is the coordinator: when the user shares a PR or asks for a handoff/status, inspect the latest PR details, independent Claude review comment, and local validation comments; then provide the next exact copy-and-paste prompt for Cloud or Local Codex. ChatGPT should not claim to know Codex's private session state or that the Mac is currently available.
- If the Mac is offline, the state remains `NEEDS_LOCAL`; cloud work does not have to stop.

## GitHub merge gate

The `.github/workflows/keeper-local-validation.yml` workflow posts commit status `keeper/local-validation` for the current PR head SHA. For code changes, it remains failing until a repository collaborator posts a `Codex local validation` comment with `State: LOCAL_PASSED`, the **exact current commit SHA**, and `pass` for every platform named by `Required local checks`, except `HARDWARE` when the exact-SHA owner decision above defers unrun physical checks. New commits invalidate previous local sign-off and deferral. Documentation and `.github/`-only PRs are exempt from Mac tests.

This workflow **reports** a status; to **enforce** it, repository administrators must require the `keeper/local-validation` commit status for merges to `sprint` in GitHub Rulesets or branch protection. Require the existing `Tests` CI check as well. This is a review/test gate, not a guarantee that tests were actually executed; agents must report actual results truthfully. Release signing, TestFlight, Play Store, and production deployment remain separate and require explicit user approval.

## Independent AI code review

The `Keeper independent Claude review` workflow uses Anthropic Claude Sonnet 5.5 on **ready, same-repository PRs targeting `sprint`**. It is advisory and independent of OpenAI Codex, with no model tools, shell access, approvals or merge authority. Trusted `pull_request_target`/`issue_comment` code fetches immutable PR data without checking out or executing it. The protected `keeper-claude-review` environment must allow only the `sprint` branch and contain `KEEPER_CLAUDE_API_KEY`; never leave an Anthropic key in repository secrets.

Each PR gets at most one automatic paid attempt. Documentation-only changes consume no attempt; `synchronize` checks allow the first later code change to receive review. Subsequent pushes, reopen and draft/ready cycles reuse protected payment history, independent of deletable PR comments. Completed reviews describe an exact head/base pair; new code requires the explicit maintainer command above. Each attempt sends one bounded request to `claude-sonnet-5-5`, with an enforced conservative $3 reservation and no retries, fallback models or agents. Truncated, stale and incomplete results are not passed reviews. Every charged or uncertain call permanently reserves $3 in a separate protected public metadata-only ledger: at most two attempts per head and three per PR, including explicit retries. The source repository must remain public; the ledger contains no prompts, source, model output or secrets. API-key rotation preserves the stable state signing key and epoch. The reviewer defaults off and also requires signed production-security verification before payment. See [.github/CLAUDE_REVIEW.md](.github/CLAUDE_REVIEW.md) for administrator setup, rotation, safe verification and the blocked R4 review plan.

Keep automatic GitHub Copilot review enabled until the replacement has been verified and the user explicitly approves the switch. Do not merge the infrastructure PR or disable the Copilot ruleset without that approval.
