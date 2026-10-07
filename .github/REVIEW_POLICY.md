# Pull request review policy

## Choose Copilot effort

Repository default: **Lite**. Before requesting the first review or marking the PR ready, verify the Copilot effort in the PR's GitHub Reviewers controls and override it for the change. A remembered PR choice can override the repository default. GitHub controls the underlying review model; the chat model selector does not change it.

- **Lite:** routine UI or styling, noncritical copy, documentation, and isolated changes with known low risk.
- **Balanced:** keys, signing, recovery, backup, authentication, pairing, transactions, migrations, security-critical copy, security dependencies, permissions, complex or cross-service changes, and unknown risk. Use Balanced for mixed changes that include these areas.

Effort is selected explicitly. This document does not implement automatic risk classification or a CI gate for effort selection.

## Review timing and evidence

Finish feasible verification before marking a PR ready. Automatic Copilot review of ready PRs remains enabled; automatic draft reviews and automatic reviews on every push are disabled. Keep work in draft while it is being prepared.

Batch fixes and stabilize checks before requesting another review. Request a new review when changes materially affect correctness or security; avoid repeated reviews for verified routine documentation or metadata changes. Workflow permissions, security dependencies, secrets, and release signing count as material changes.

If a material security change received an automatic Lite review, select Balanced and request one review of the final substantive changes after batching fixes and stabilizing checks. Do not count a Lite review as a Balanced review.

Record these in the PR description:

- Selected effort and the reason for it.
- Actual effort reported by Copilot and the commit SHA it reviewed; distinguish the selected mode from a completed review.
- Real findings and their disposition, including any substantive review-overview concerns. Check feedback against the implementation and verification.
- Pending or unavailable review status when appropriate. A quota response is an unavailable review, not a successful review or evidence of no findings.

## Human approval

Request Ben (`ben-kaufman`), Utkarsh (`cakesoft-utkarsh`), and Parsh (`Parsh`) when they have review access. Record pending invitations accurately; keep review-owner proposals draft until GitHub recognizes the owners and required checks pass.

One independent approval from any one of these developers is required, together with passing required checks and resolution of relevant review concerns. All three approvals are unnecessary. The PR author cannot approve their own change, and Copilot feedback does not satisfy the human approval requirement. Product signoff remains separate. Do not merge automatically.
