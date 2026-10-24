# Exact source for offline contract workflows

Preparation base: `c8c4e22ffc0137f774e533f167ada81aa673b94a`. This bounded
follow-up extends #7108's source checks to the five non-native contract workflows:
native-validation, canonical-provenance, release-origin, release-preparation and
frozen Ruby tooling. It changes no native worker, producer branch, CodeQL upload,
dependency pin, protected-origin admission or release authorization.

All five explicitly check out the pull-request event head or `github.sha`.
Read-only Git receipts verify actual HEAD and clean tracked/nonignored source
before checks, around relevant dependency setup, and in a final `always()` step.
A successful final source receipt cannot clear a previous failed check: no
check is tolerated or replaced, and its original step/log remains failed.
Python commands use `-B` to avoid creating repository bytecode during checks.

The two existing manual routes (release-preparation and Ruby contracts) use the
explicit `--contract-dispatch` option. Only those repository/workflow paths at
branch/tag refs can use manual admission; actual HEAD must equal the explicit
`GITHUB_SHA` and source must remain clean. The default helper still rejects manual
events. Native/canonical/release-plan dispatch, foreign routes and combined paired
Relay/manual options are rejected. These are source receipts, with workflow SHA
recorded separately; they provide no authorization or native/security acceptance.

Actual-Git controls cover PR/push/manual identity, same-tree different commits,
staged/unstaged/added source, finite manual routes and CLI option boundaries.
Workflow controls retain read-only permissions, existing triggers, tool pins,
script-disabled locked installation, final-check placement and original checks.
Hosted behavior on this new source remains unverified until its own runs finish;
previous source-contract/native/security results do not transfer to this SHA.

## Separate CodeQL attribution inspection

CodeQL remains unchanged. Its PR checkout is still the default synthetic-merge
checkout; the Actions run's `head_sha` alone does not prove the analyzed checkout.
Current c8c4 run39847064766/job120063025484 reports the analysis job SUCCESS, but
official analysis and job-log readback returned HTTP403 during this inspection.
The exact analyzed commit and security conclusion are therefore unverified here.

At pinned CodeQL action `9b3254085494b55a0f7c4c2b3d2d52cc712ce370`,
`src/git-utils.ts` reads Git HEAD with a SHA-input/environment fallback and can
rewrite a PR merge ref to its head ref after checkout changes. Explicit SHA/ref
inputs must be paired. A later attribution change needs reviewed checkout,
action ref/SHA mapping, official upload identity and genuine API readback; simply
changing checkout would not establish that design. The current provenance
receipt remains limited to ordinary sprint pushes. No upload, analysis or
security pass is created or reassigned by this package.
