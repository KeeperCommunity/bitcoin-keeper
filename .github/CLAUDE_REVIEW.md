# Independent Claude reviewer — deployment blocked

This lightweight, advisory reviewer uses `claude-sonnet-5-5` independently of
OpenAI Codex. It has no tools, shell, approval or merge authority. Copilot remains
enabled. The workflow defaults off: Repository variable `KEEPER_CLAUDE_REVIEW_ENABLED` must equal
`true`, and a signed ledger must attest completed production security checks.
Neither setting has been activated by this change. Do not merge or release.

## Confirmed findings and corrected spending state

The remaining Sonnet review of infrastructure commit
`bec965afc8f388429e4080625dfebf8fea09cd52` identified two real issues. Offline
reproduction bought four simulated Messages calls using four manual retry
comments for the same incomplete head, and deleting old marker comments allowed
a second automatic call. The corrected implementation makes comments request
and display data only; a separate protected repository holds payment authority.

Every attempt permanently reserves **$3.00**, even if actual cost is lower, the
result is incomplete/stale, the process times out, or publication fails. There
are no refunds or automatic paid retries. The ledger atomically enforces **two attempts
per exact head ($6)**, counting changed bases together, and **three attempts per
PR ($9)** across all heads. Only one automatic attempt is allowed per PR. A
completed exact head/base pair and repeated request ID are reused. New manual
comments cannot override these limits. Preparation failures consume no paid
attempt. Exhaustion requires a separately reviewed administrator decision; this
runner has no reset, grant or cap-override path.

Payment history is HMAC-signed, epoch-bound `ledger.json` on the fixed orphan
branch `keeper-claude-review-state` in public repository
`KeeperCommunity/KeeperCommunity-keeper-review-ledger`. It records request, head/base, run,
status, claim ID and full reservation. The Contents API's old file SHA provides
compare-and-swap; the runner verifies the resulting immutable commit and file
before Messages. A race, uncertain write or failed acknowledgement blocks
payment without retry. Authenticated parent-commit binding prevents copying an
old signed file into a new commit to roll back counters. Missing, malformed,
wrong-generation or inaccessible history fails closed; runtime never initializes
an empty ledger. Completion is persisted after successful result publication.
Deleting a review or request comment cannot erase a paid reservation.

Schema version 2 preserves uncertain historical attempts as explicit
`legacy: true`, permanently `started` reservations. Unknown historical head or
base is `null`; current PR metadata must never fill a missing historical snapshot.
Unknown-head debt counts against every head's limit, and every legacy record
counts against its PR's limit. Runtime cannot create these records, complete
them, or migrate version 1 automatically. An imported orphan starts populated
and inactive; copying it into a later commit fails parent/counter validation.

The state App can append state but cannot delete or force-reset the protected
branch. Two active rulesets are mandatory: creation/update restricted to this
App; deletion/non-fast-forward blocked for everyone, including this App.
Administrators can still change repository policy, so administrator access and
policy audit are part of the trust boundary. Runtime verifies effective rules
and fails closed if either restriction is missing or weakened.

## Public metadata ledger on GitHub Free

Public repository rulesets are available on GitHub Free; private organization
repositories require Team/Enterprise for these protections. The public ledger
therefore avoids an organization subscription while retaining both mandatory
rulesets. Public access grants no write access, signing authority or paid-review
permission. Restrict ledger administrators and writers, disable unused Issues,
Projects and Wiki features, and avoid adding application collaborators as writers.

Anyone can read PR numbers, head/base SHAs, request/run IDs, statuses, $3
reservations, counters, epoch, parent commit, verification flag and HMAC signatures,
plus Git commit metadata. These values are bookkeeping for already-public PRs;
signatures and epoch are not signing secrets. The ledger schema accepts no source,
prompts, review text, wallet data or credentials. Actual Claude findings remain
public comments on the application PR. Administrator commit messages and author
identity are public too; never place confidential incident details there.

Runtime pins ledger repository ID `1416741877` as well as its name and requires
both repositories to be explicitly public. It checks source visibility before
state writes, token counting, Messages and publishing
findings. Inaccessible/private/unknown metadata fails closed, preserving any
existing reservation. Before making the application repository private, disable
the reviewer and drain running jobs; visibility changes cannot erase metadata
already public or be made atomic with a GitHub comment/API request. A private
source would require a separately reviewed private-state design.

The State App identity is pinned to Integration ID `5313951` in runtime and
both token-minting steps. The environment App ID must match it exactly;
substituting another positive ID together with matching rules cannot change
payment authority. Changing this App requires a reviewed code/policy migration.

GitHub may omit `bypass_actors` from rule details for callers without sufficient
access. Missing is unknown and fails closed. Verify that the **actual State App
token** returns full actor lists for both rulesets, not only their rule types.
Never grant Administration write or weaken either ruleset to satisfy this check.
If this token cannot prove the bypass lists, remain disabled and resolve the read
boundary independently before production use.

[GitHub ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
and [ruleset detail access](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset).

## Required administrator actions

These are deployment prerequisites, not actions performed by this PR.

1. Leave `KEEPER_CLAUDE_REVIEW_ENABLED` unset or `false`. Keep Copilot and required
   `Tests` / `keeper/local-validation` checks enabled. Confirm `sprint` remains
   the default branch. Review the exact candidate SHA and pinned actions before
   any trusted production installation; this request authorizes no merge.
2. Create environment `keeper-claude-review` with custom deployment policies:
   exactly **branch `sprint`**, no tags/wildcards/other branches. Required human
   approval is an optional additional control; the branch restriction is
   mandatory. Verify its metadata endpoints work with the workflow token.
3. Audit repository and organization secret **names, scopes and consumers**.
   Revoke the old Anthropic key at Anthropic, including any legacy
   `ANTHROPIC_API_KEY` used by earlier agent-action smoke tests. Remove repo/org
   fallbacks exposing that key or any of the three new secret names below to
   this repository. Do not merely rename an exposed key. Create a fresh key in a
   dedicated low-spend Anthropic workspace; configure workspace spending/rate
   backstops and verify Sonnet 5.5 standard pricing. Store it only in the protected
   environment as `KEEPER_CLAUDE_API_KEY`. Never paste keys into PRs/logs/source.
4. Use the existing `KeeperCommunity/KeeperCommunity-keeper-review-ledger`
   repository; inspect its entire history before making it **public**. It currently
   contains a non-secret README only; no duplicate repository or rename is needed.
   Keep ordinary application PR writers out of ledger write/admin access. Create
   a dedicated GitHub App installed only there, with
   Contents **write**, Administration **read** for branch-rule inspection,
   and implicit Metadata read. Grant no Actions, Workflows, Secrets or
   Administration write permission, and no access to the application repository.
   Store its private key only in the protected environment as
   `KEEPER_CLAUDE_LEDGER_APP_PRIVATE_KEY`; set environment variable
   `KEEPER_CLAUDE_LEDGER_APP_ID` to its positive numeric App/Integration ID.
   The pinned token action requests only this repository and these permissions,
   revokes the installation token after the job, and runtime verifies that the
   token is an installation token scoped to exactly this one public repository.
   Verify the actual App token can read public source metadata without an
   installation on the application repository; a denied read keeps it disabled.
5. Generate an independent random signing secret (at least 32 characters) and
   random 32-lowercase-hex epoch. Store secret `KEEPER_CLAUDE_STATE_KEY` and
   environment variable `KEEPER_CLAUDE_LEDGER_EPOCH`. Keep their recovery copies
   in an administrator-controlled secret manager; API-key rotation preserves them.
6. With the workflow still disabled, prepare a populated inactive orphan using
   `imported_document(...)`, never a fresh empty allowance. The fixed
   [legacy manifest](scripts/claude_review_legacy.json) preserves seven known
   charged/uncertain runs for PR #7049, each permanently reserving $3. Three old
   tool-enabled runs have unknown snapshots; four later snapshot claims are
   corroborated by immutable harnesses but are not authenticated completion or
   billing evidence. Run `38214836557` is excluded because its successful
   immutable harness rejects every Anthropic call and asserts reuse of a prior
   review. Do not treat it as another paid attempt. Old signatures used the
   retired Anthropic key, not the new independent signing secret.

   Seven reservations are a conservative known minimum, not proof of the
   original agent's request/turn count or historical $3 compliance. Reconcile
   **all** billing, immutable runs and administrator-held evidence before
   production verification; retain additional charged/uncertain calls if found.
   Never invent missing SHAs or discard debt. Version 2 imports stay `started`,
   with revision equal to record count, no parent and
   `production_verified: false`. Historical over-cap records remain readable
   and block further spending for that PR. Each subsequent signed migration
   binds its real single parent, preserves the epoch and computes revision as
   attempts + terminal updates + verification flag. Do not expose signing
   secrets on command lines, in logs, or through shell tracing.
7. Configure two **repository-local, active branch rulesets**, each targeting
   exactly `refs/heads/keeper-claude-review-state` with empty exclusions:
   (a) `creation`, `update`, bypass actors exactly the State App Integration ID,
   `bypass_mode: always`; (b) `deletion`, `non_fast_forward`, **no bypass actors**.
   Confirm effective branch-rules endpoints contain both rulesets and the actual
   State App token sees explicit complete bypass lists. No normal
   user/admin role has a configured bypass; protect repository-admin membership.
8. Record exact-SHA negative verification: ordinary internal PR/branch jobs
   cannot obtain any protected key; source/path/title/comment injection reaches
   no shell; the App cannot write the application repo or access protected/private
   resources there, delete/force-reset state
   or alter rulesets; missing ledger, invalid signature/epoch/parent, weakened
   rules, omitted bypass lists, private/inaccessible source, extra installation
   repository, unauthorized/stale requests, comment
   deletion, retry-limit exhaustion and CAS conflict produce **zero Messages**.
   Check trusted checkout, default-branch event provenance, no PR-code execution,
   narrow token scope/revocation and full historical migration. Use offline fakes
   for payment-failure cases and a zero-secret probe for credential-denial tests.
9. Obtain independent security review of the final installed candidate and
   collect production-boundary evidence. These changes have offline/Codex peer
   checks only; the earlier Sonnet review applies to the old SHA. Production
   triggers and credential isolation are **not verified** while this PR remains
   unmerged and the protected checks have not run. Do not use legacy keys as a shortcut.
   Once production security is verified and activation is separately authorized,
   an administrator may sign the one verification transition: preserve every
   record/epoch, set `production_verified: true`, bind the current real parent,
   and set revision to attempts + terminal updates + 1. Then enable the repository
   feature variable. Keep Copilot until real exact-head trigger/delivery/dedupe
   checks pass and the user explicitly approves its switch.

## Saved setup and protected administrator check

The owner reports all three environment secrets and both environment variables
saved, including the independent signing key and epoch
`fd24ddf2e3336ed75c3ef376a8a14f8c`. The API-secret row and App ID `5313951`
were visible in owner screenshots; secret values were never read. Live public
metadata confirms repository ID `1416741877`, App-only ruleset `25288469`,
no-bypass history ruleset `25288495`, and all four effective restrictions.
The protected environment permits exactly branch `sprint`, with no tags.
These observations do not establish actual key validity, installation scope,
rotation, billing reconciliation or production credential isolation.

The [manual administrator workflow](workflows/keeper-claude-admin.yml) prepares
the remaining checks using GitHub-held credentials. It is dormant in this PR;
it cannot run until separately approved trusted installation on `sprint`.
Do not install or merge it merely to bypass this deployment boundary.

- `preflight` makes no writes and no Anthropic requests. It checks current
  administrator rights for both the original actor and rerun caller before
  environment access and again before the App key is used, requires the event
  SHA still be the actual `sprint` tip, rejects repository/org secret fallbacks,
  checks the environment policy, and verifies the minted installation token,
  source visibility and full ledger rules. A missing state branch is reported
  as uninitialized, never as production readiness.
- `initialize` additionally creates the fixed seven-record signed orphan,
  verifies immutable contents and records a nonsecret bootstrap checkpoint on
  ledger `main`. It never creates an empty allowance, modifies existing payment
  state, grants retries, sets production verification or activates the feature.
  It requires the original README-only `main` SHA
  `a330fe03b8169c31e05dabf3401a2a0c41cf17ab`; concurrent main advancement is
  rejected. If interrupted after creating state, a rerun can only seal the
  identical inactive imported root. Uncertain writes stop without automatic
  replay. Changed, progressed, corrupt or absent-after-checkpoint state requires
  separately reviewed recovery.

The main checkpoint is administrator-controlled setup bookkeeping, not immutable
anti-reset authority: an administrator or compromised ledger writer could
rewind unprotected `main`. The runtime's signed state, exact rulesets and
fail-closed behavior remain the payment boundary; policy administrators can
change that boundary and must be trusted and audited. The initializer remains
admin-only and inactive even if its checkpoint is tampered with.

The Anthropic key enters this administrator workflow only as a **presence
boolean**; presence proves neither validity nor workspace limits. The private
App key goes only to the pinned token action, and the signing key only to trusted
Python. Successful checks prove the **minted token's** one-repository scope,
not the complete App registration/installation's absence of extra grants.
Owner installation/permission evidence, legacy-key revocation and provider
workspace limits, controlled live isolation/forbidden-operation tests, full
historical reconciliation and independent installed-candidate review remain
required. Do not test destructive operations against authoritative state.
No administrator-check result authorizes payment or a Copilot switch.

## Rotation, incident response and recovery

- **Anthropic key:** disable the feature flag, let an in-flight paid request finish
  or retain its uncertain reservation, revoke the old key, create a new dedicated
  workspace key, replace only the environment secret, and repeat isolation
  verification. Do not change signing key, epoch or any paid history.
- **State App key:** disable the feature flag, revoke any active installation
  tokens, replace the environment private key and delete the old App private
  key. Verify exact installation scope, read-only administration permission and
  both rulesets again. Preserve the ledger signing key and all reservations.
- **Signing key:** disable the flag and coordinate an audited offline re-signing
  migration of the complete ledger. Preserve attempts, $3 reservations, epoch
  and production evidence; authenticate the actual new commit parent and keep
  counters consistent. Never deploy a new signing key against old signatures
  or delete/reinitialize history. If the key may be compromised, independently
  reconcile immutable runs/billing before trusting the migrated ledger.
- **State missing/corrupt/exhausted:** remain disabled; restore verified full
  history using administrator-approved recovery without resetting debt. Required
  policy must still prohibit deletion/force pushes. Do not add permissive App
  bypasses or return to comment markers. Every uncertain paid call counts as spent.

## Trusted execution and review coverage

Automatic requests use trusted `pull_request_target` code; maintainer commands
use default-branch `issue_comment` code. Checkout is an immutable trusted
branch event `github.sha`, never a PR head, merge ref or cached PR `base.sha`.
PR `base.sha` can remain stale after `sprint` advances. Snapshot collection,
deduplication and every prepayment/publication recheck instead resolve and
validate the actual current `refs/heads/sprint` commit; an unavailable/malformed
ref stops safely and a moved base invalidates the earlier snapshot.
A credential-free read-only job
reconciles current maintainer permissions before protected environment access;
those permissions and PR eligibility are rechecked after acquiring the PR lock.
Only pinned checkout/token actions and Python stdlib run. No package installation,
PR scripts, agent configuration, shell/model tools or external MCP server runs.
Authenticated requests refuse redirects. Error bodies and model/source text do
not enter workflow command logs; the publisher escapes text in a `<pre>` block.
The model receives data only, never keys or environment access.

Requests are `/claude-review FULL_HEAD_SHA` from a current write/maintain/admin
collaborator. Event coalescing recovers the newest authorized current-head
command from comments; spent request IDs remain in protected state even if that
comment is removed. A collaborator-permission HTTP 404 means that command is
ignored; it cannot suppress automatic review or an older authorized command.
Other permission/API errors still stop the review before payment.
Docs-only Markdown/MDX consumes no paid attempt; agent-policy
and `.github/` files always count as reviewable. Later code pushes can receive
an unused first automatic attempt. Automatic events never repay an earlier call.

The review reports captured head, base tip and merge-base diff origin, fetching
source by immutable blob SHA and checking the live PR before payment/publication.
Missing/binary/truncated/empty patches, >200 files, >250 commits, incomplete
comparisons and oversized inputs fail unpaid with an incomplete diagnostic.
Optional changed-file source is limited to 100KB/file and remaining input space;
immutable tree sizes prevent unnecessary blob downloads. Source omissions are
explicit; unchanged neighboring files are not inspected. Each API instance caps
cumulative GitHub response transfer at 8MB.

## $3 per-run envelope and safe tests

One Messages request, model `claude-sonnet-5-5`, max 8192 output/thinking tokens,
standard-only service and global inference. No cache, paid retries, model fallback,
tools or extra turns. The free count uses the exact system/messages. Total input
is at most 400,000 UTF-8 bytes; reserve the larger of bytes + 10,000 tokens or
2 × count + 10,000, priced conservatively at $5/M input and $25/M output. Reject
above $3 before payment and validate returned usage. At the byte limit this is
$2.2548; the protected spending ledger nevertheless retains the full $3 allowance.

Sonnet 5.5 documented standard pricing is $2/M input and $10/M output. Messages
has no provider-enforced per-call dollar parameter; this conservative envelope
and dedicated workspace limits supply complementary controls. Recheck pricing
before changing model or routing.
Sonnet 5.5 supports `thinking: {type: between_tools}` at medium effort even without
tools; its response then contains only text. This avoids up-front thinking while
preserving the bounded single-call request. See the model-specific
[thinking documentation](https://platform.claude.com/docs/en/build-with-claude/thinking#turning-thinking-off)
and [Messages schema](https://platform.claude.com/docs/en/api/messages/create).
[Model/versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions),
[pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting),
[Messages API](https://platform.claude.com/docs/en/api/messages/create).

Run `python3 -I -m unittest discover -s .github/scripts -p 'test_claude_review*.py' -v`
without real credentials. CI runs hostile-data, spending, ledger-policy, replay
and atomic-write fakes with read-only permissions and no Anthropic key. These
checks establish code behavior; they do not prove live administrator setup.

## R4 PR #7045 remains gated

R4 head `b78b480eb4223390b2d17073387f9887d2e35f95` is a draft with 269 changed
files and about 1.32MB of full diff input. The current reviewer correctly rejects
it; a command or ready transition cannot provide complete bounded coverage.
The [fixed-head seven-batch proposal](review-plans/r4-7045-b78b480e.json) assigns
every patch exactly once, names immutable blobs/patch hashes and context limits,
and remains blocked. Its $21 first-pass planning ceiling is **not spending
authorization** and exceeds the normal three-attempt PR allowance. A separately
reviewed trusted session/batch runner and an explicit immutable, cumulative-budget
grant are required after activation; none exists or is enabled by this PR.

After production verification/activation, independently review the exact R4
snapshot using that approved bounded path, record full coverage and dispositions,
fix significant findings, and refresh Cloud checks and independent coverage for
any changed SHA. Only then issue another Local handoff for IOS, ANDROID, HARDWARE.
Current local validation is BLOCKED; no new local attempt, merge or release is
requested now.
