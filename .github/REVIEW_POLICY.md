# Pull request review policy

## Review decision: severity and cost

Cloud review is the primary developer-review route when the change warrants it; it replaces a mandatory human developer-approval gate. Human developer review is optional. Choose whether a separate provider review is useful and, if so, its type from the actual severity, uncertainty, scope and cost. Complete feasible deterministic verification first.

| Decision | Use when | Evidence |
| --- | --- | --- |
| Skip provider review | Verified routine documentation, noncritical copy or pure style changes with no behavior, security, permission, dependency or workflow impact; policy/security/agent/workflow documents are excluded | Record the reason and the checks/source inspection supporting the low-risk classification. |
| Lite | Bounded normal changes with understood risk that benefit from cloud review | Record the bounded scope, chosen route, intended effort and cost/allowance. |
| Balanced | Signing, keys, authentication, recovery, backup, pairing, transactions, migrations, workflows, permissions, security-sensitive dependencies/copy, complex or cross-service changes, or unknown risk | Record the risks and coverage needed; use Balanced when categories are mixed or risk is uncertain. |

A filename or a documentation label alone does not justify skipping review. Policy, security, agent and workflow documents are not routine documentation eligible for Skip. Assess their actual effect and choose an adequate Lite or Balanced route. A low-cost check or source inspection may resolve uncertainty without another provider call after valid review coverage; explain that evidence.

Independent cloud review is needed only when the actual risk or a substantive finding requires independence. Record why and what it must cover. Use only an already installed, authorized route whose repository scope, provider access and budget permit that review. Do not add another model, paid review or external executor merely to satisfy a routine checklist. If needed independent coverage is unavailable, record the exact blocker; substantive security concerns remain unresolved until supported by evidence, not waived because review is unavailable.

## Route, effort and budget

When using Copilot, verify the PR's saved effort because an override may differ from the repository default. [GitHub controls Copilot's review model](https://docs.github.com/en/copilot/concepts/agents/code-review); selecting a ChatGPT or Codex model does not select Copilot's model. Lite and Balanced here specify the review choice; do not claim a mode or independent coverage that the selected route cannot provide.

Use the least-cost already authorized route that adequately covers the risk. Reuse valid review receipts for the exact head/base and coverage; do not buy duplicate initial reviews. Complete stable checks before one initial review, batch material fixes before a necessary re-review, and preserve existing spending limits, permanent reservations, deduplication and no-retry controls. Routine reviews within an established scope and allowance do not need repeated owner permission.

Verify installed scope, applicable allowance and expected cost before a provider request. If quota, cap, activation or scope is unavailable, record unavailable and use another already-authorized adequate cloud route or hold the applicable gate. Do not silently downgrade critical review, create paid retries/fallbacks or infer a fresh budget. An uninstalled or disabled reviewer is not an available route, and these files do not install or activate one. Existing Claude limits, where applicable, of $3 reserved per attempt, two attempts per head and three per PR are ceilings, not activation or a fresh allowance. Historical Copilot balances or spending-cap observations are not current-credit proof.

## Timing, automation and evidence

Batch material fixes and stabilize relevant checks before another review. Repeat cloud review only when a change materially alters the reviewed correctness/security scope or a finding needs independent confirmation. Verified routine follow-up edits do not automatically require another provider call. A Lite review of earlier content is not a Balanced review of the final changes.

Blanket automatic ready-PR or every-push review does not implement this conditional decision and may consume allowance for changes classified Skip. Intended automation must honor the recorded decision; otherwise use an explicitly authorized trigger. Keep automatic draft and every-push review off. Inspect and record actual settings before a ready transition or request; these documents do not change GitHub rules, enforce risk classification, grant a budget or prove an installed trigger. Report a settings mismatch rather than claiming it is fixed by Markdown.

Record in the PR:

- Review decision: Skip provider review / Lite / Balanced, with severity, scope, uncertainty, cost and reason.
- Deterministic checks and source evidence; distinguish passed, failed, blocked and not run.
- Selected installed cloud route and intended effort, if used; applicable scope/allowance.
- Actual provider/model/effort, exact reviewed SHA, coverage, link and result, or accurately skipped/pending/unavailable.
- Real findings, including substantive overview concerns, and evidence for each disposition. A skipped or unavailable review is not evidence of no findings.
- Whether independent coverage is needed, why, and its actual status. Do not transfer old-SHA results to new changes.

## Optional human review and required gates

Ben (`ben-kaufman`), Utkarsh (`cakesoft-utkarsh`) and Parsh (`Parsh`) are suggested human reviewers when useful and already eligible. Pending invitations or the absence of human review do not block readiness or merge and do not require an access grant. Record any requested human feedback and its disposition; no human developer approval is required. CODEOWNERS suggestions, where present, do not create a mandatory review assignment.

Required CI/status checks, resolution of substantive findings, security and native/device validation, product signoff and operation-specific signing, deployment and release authorization remain intact. Conditional review is not permission to bypass these gates or to merge a change with unresolved substantive security concerns. Repository protection remains the enforcement mechanism; report any live mismatch separately.

## Native validation and release signoff

Follow [AGENTS.md](../AGENTS.md) for the Cloud → Local handoff and exact-commit validation. Required native checks must pass on the current head before a code PR meets the local-validation gate; a new commit invalidates prior local signoff. Documentation and `.github/`-only changes are exempt from native tests, with the reason recorded in the PR.

Owner phone/Desktop/hardware acceptance may be retrospective, but it does not replace the required Codex Local gate. Product signoff is separate, and release signing, distribution, store upload, deployment and publication require explicit owner approval for the intended operation and channel.
