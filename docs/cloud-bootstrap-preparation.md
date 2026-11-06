# Cloud bootstrap preparation

This is an unpublished infrastructure-only preparation from known committed
sources. It carries no native pass, app acceptance, signing or release approval.
No unpublished files from the original task or the owner's Mac were migrated or
backed up. The original task's working-tree state remains unknown.

## Source identities

Fresh branch/PR refs matched these checkpoints on 18 October 2026:

| Source | Commit |
| --- | --- |
| sprint / bootstrap base | `def0d6a90c80287edb4f58ae272cbfc340f00d73` |
| #7060 `codex/7059-hosted-native-validation` | `d865ca9c4f91532a1524443cc6da42d8d7b07e1a` |
| #7062 `codex/7061-cloud-release-phase-a` | `59c821ce195a5c063d99045fd97b5ac605433f62` |
| R5 #7058 | `625435ac26af0304670c993a639626b1117699ba` |
| R4 #7045, excluded | `be89c34473bb6aab253b98325f1fe746ca391c6f` |

#7060 descends from the verified sprint commit; #7062 is stacked on #7060.
The preparation reuses #7060's `.github/` infrastructure and relevant Markdown,
with diagnostic privacy corrections, action-pin regressions and these adoption
notes. Its gate implementation is unchanged from #7060. Original gate contract
cases are retained, with additional skipped-draft/latest-attempt regressions.
Provenance, latest-attempt, explicit-failure and hardware requirements
remain intact. No live protection, permission or credential setting changes.

`package.json`, `yarn.lock`, `ios/Podfile.lock` and
`ios/hexa_keeper/AppDelegate.mm` remain at sprint. R4's assessment document,
source, refs, private fixtures and Mac work are not imported or changed. Phase A
app probes/scenario matrices and Phase B signing/distribution are excluded.

## Diagnostic and action-pin correction

General tool failures and Maestro, Android, Metro and iOS startup collectors
export fixed categories or fixed public startup labels. They never return
arbitrary log excerpts, including unknown errors. The legacy metadata field
`redacted_tool_errors` now contains category identifiers only. Synthetic privacy
regressions exercise unlabelled private text, wallet-like data, spaced secrets,
URLs/paths, encoded text, Unicode/control characters, multiline input and repeated
messages. Collector tests check metadata and console output while retaining
failed command and smoke outcomes. Raw logs remain private to the disposable
runner. Categories indicate observed markers, not a diagnosis or a platform pass.

The emulator action uses upstream commit
`1dcd0090116d15e7c562f8db72807de5e036a4ed`, matching #7062. Read-only verification
of `ReactiveCircus/android-emulator-runner` on 18 October 2026 returned:

```text
refs/tags/v2.34.0     324029e2f414c084d8b15ba075288885e74aef9c
refs/tags/v2.34.0^{}  1dcd0090116d15e7c562f8db72807de5e036a4ed
```

The old #7060 value appended `38` to the tag object's SHA and was malformed.
Host contracts require full 40-character immutable action pins in the two newly
introduced workflows, matching the upstream revisions verified on the same date,
including this exact emulator commit. They reject mutable tags, short/malformed
revisions, unverified actions/SHAs and the annotated tag object. Existing action policy
in unrelated workflows and the inherited gate is unchanged.

Pin inspection parses YAML with the host's existing Python 3 and PyYAML, then
checks every job-level and step-level `uses` value. Quoted/escaped keys, flow
mappings, folded scalars and aliases cannot hide mutable actions alongside valid
pins. Missing parser tooling, invalid YAML, duplicate mapping keys and non-string
action references fail the contract; there is no regex fallback or dependency
installation. Future host-contract environments must provide Python 3 and PyYAML.

## Draft publication behavior

Both hosted native jobs require a `pull_request` event with a literal boolean
`draft: false` before allocating a runner. Drafts and missing/malformed draft
state cannot start either native job. `ready_for_review` starts a new eligible
native run; marking a PR ready therefore requires separate native-run/budget
authorization. `converted_to_draft` triggers a skipped run in the same PR
concurrency group, configured to cancel an older native run. Cancellation is
best effort and cannot undo work already started while the PR was ready.

The existing CI `Tests` install would otherwise invoke `prepare` and CocoaPods.
For draft PRs only, it now uses frozen Yarn with lifecycle scripts disabled.
The normal `Tests` job still runs and any install/Jest failure still fails it.
No app manifest, lock or test changes are included. Ready/non-PR installs retain
their existing behavior, and `ready_for_review` reruns CI so a draft installation
result cannot replace the normal ready-PR test run. Lint's existing install
already disables lifecycle scripts. The frozen dependency blocker is not waived.

Automatic checks for this branch targeting sprint, from the checked-in triggers:

| Event | Automatic behavior |
| --- | --- |
| Push `codex/cloud-bootstrap-privacy` with no PR | No checked-in workflow matches this branch's push event |
| Open/reopen a draft; push new commits to an open draft (`synchronize`) | Linux CodeQL; CI Lint and Tests; Node/Python Native validation contracts; existing trusted local-validation gate. Hosted iOS/Android jobs are skipped before runner allocation |
| Edit the draft PR description | Existing trusted local-validation gate refreshes; no native workflow trigger |
| Mark ready for review | Native jobs become eligible; CI reruns the normal install/tests; trusted gate refreshes. CodeQL and host contracts retain their existing default PR event types |
| Convert back to draft | Hosted-native concurrency cancellation/skip only; no new native runner. Previously started ready-PR CI is not retroactively undone |

The trusted gate's existing docs/`.github` exemption can report success for this
infrastructure PR. That is not native acceptance or installation/merge approval.
For app PRs, skipped jobs/steps, even inside an overall successful workflow, supply
no native pass; a newer skipped run/attempt cannot reuse an older native success.
All provenance, explicit-failure and HARDWARE checks remain unchanged.

This bootstrap contains no `workflow_call`, `workflow_dispatch` or job-level
reusable-workflow call. The entry-path contracts check that boundary. #7062's
`keeper-release-acceptance.yml` callers and `keeper-native-platform.yml` worker
remain outside this patch. Before their separate restack/adoption, add the same
draft guard at both caller jobs and the worker, retaining source/provenance/R4
checks. The reusable worker receives the [caller's GitHub event context](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#github-context); a direct
non-PR caller must not bypass the guard. These future paths are not claimed fixed
or installed by this bootstrap.

The remaining Linux checks consume hosted runner time. Available included minutes
and billing limits have not been verified, so this is not a zero-cost guarantee.
Confirm allowance before publishing under a no-paid-resources restriction; do not
disable required checks or change billing/security settings to bypass it. No
workflow has been dispatched or run as part of this source-only preparation.

## Adoption order and remaining gates

1. Independently review this infrastructure diff and its host contracts. Any
   publication, PR change or merge requires separate owner authorization. Only a
   reviewed installation on protected sprint can establish the workflow/harness
   baseline. Candidate runs cannot authorize their own changed infrastructure.
2. Reconcile the app and dependency changes separately against the approved
   source baseline. This bootstrap deliberately leaves frozen-install blockers
   unresolved. Do not unlock dependency installation, weaken gates or treat host
   contracts as native evidence. R4 work and the owner's Mac remain untouched.
3. Restack #7062's Phase A delta onto the adopted bootstrap in separately
   authorized work. Do not merge its existing #7060 ancestry wholesale: that
   would also import the four excluded app/dependency files. Reconcile
   `hosted_native.py` changes while preserving the fixed-category exports and
   privacy regressions; retain the corrected emulator pin and extend pin/draft
   entry-path contracts and guards to Phase A's callers and worker. Update #7062's bootstrap references to
   the actual adopted source. Phase A requires its own review and protected-base
   installation before it can supply authoritative evidence.
4. After the source baseline and frozen dependencies are reconciled, obtain
   authorization and budget for actual exact-source native runs using unchanged
   reviewed infrastructure. Record source SHA, workflow/run/attempt, each real
   build/UI outcome and safe artifact identities. New source commits invalidate
   old passes. Missing, skipped, cancelled, untrusted or failed evidence does not
   become a pass; explicit local failures and HARDWARE gates still apply. R5's
   feature acceptance remains separate from this startup smoke.

Signing, distribution, uploads, deployment and publication remain separately
approved operations. Phase B is not implemented or verified by this preparation.
The optional private signing follow-up note is not a Phase A prerequisite.

## Validation scope

Use `node --test .github/tests/*.test.cjs` and
`python3 -B -m unittest discover -s .github/tests -p 'test_*.py'`, plus available
workflow lint, syntax and diff checks. The host suite uses synthetic fixtures and
mocked native commands; it requires no app dependency installation, emulator,
native compilation or Actions dispatch. Report actual results in the private
handoff. A missing lint tool is a validation-tool blocker, distinct from a failed
host contract or the setup-reported frozen app dependency installation failure.

Private preparation results on 18 October 2026:

| Check | Result |
| --- | --- |
| Node host contracts | PASS: 53 tests, including gate, shim, action-pin and draft-entry contracts |
| Python host contracts | PASS: 35 tests, including 5 adversarial privacy tests with subcases |
| JavaScript and Python syntax | PASS |
| Changed YAML syntax | PASS: installed PyYAML, 5 files; not workflow semantic lint |
| Staged diff whitespace and scope | PASS: only `.github/` and relevant Markdown; excluded app files unchanged |
| Workflow semantic lint (`actionlint`) | NOT RUN: executable unavailable; nothing installed |
| App dependency installation / app tests | NOT RUN here; setup-reported frozen-install failure remains unresolved |
| Native builds, simulators/emulators, hardware | NOT RUN |
| Actions dispatch, signing/distribution, deployment | NOT RUN |

The privacy regression suite was also applied to the original #7060 harness as a
negative control: all 5 tests failed (168 assertion/subcase failures, no execution
errors), confirming the tests detect the original exports. Those are intentional
baseline failures, not failures of this prepared diff. No live native evidence or
CI run from another SHA is credited to this preparation.
