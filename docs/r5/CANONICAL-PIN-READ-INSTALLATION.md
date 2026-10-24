# Canonical pin-reader correction and installation handoff

Preparation only. This patch is based on #7084 at
`29a73faaf4312f3536db9aad1d5b6795042aef7d`; that producer branch is preserved.
Latest remote refs, PR metadata/discussion, recent PRs, local reflogs and
unreachable commits were inspected before editing. No newer canonical successor
or uncommitted local successor was found. The separate #7085 consumer remains a
separate package. Neither package is installed on `sprint` here.

## Verified blocker

All three canonical verification contexts (admission, reusable platform worker,
collector) used `actions/github-script` without a `github-token` override. The
pinned action constructs its client from its default `GITHUB_TOKEN`. Workflow
permissions `contents: read`, `actions: read`, `checks: read` do not grant
repository Variables access, and workflow permissions have no Variables knob.
Consequently `actions.getRepoVariable` could prevent every installed admission.

On 22 October 2026, the current cloud integration identity returned:

| Read-only request | Result | Required permission reported by GitHub |
| --- | --- | --- |
| `GET /repos/KeeperCommunity/bitcoin-keeper/actions/variables/KEEPER_CANONICAL_NATIVE_DRIVER_SHA` | HTTP 403, `Resource not accessible by integration` | `actions_variables=read` |
| `GET /repos/KeeperCommunity/bitcoin-keeper/git/ref/heads/sprint` | HTTP 200 | `contents=read` |

These probes establish this integration's access, not an executed hosted
`GITHUB_TOKEN` test. The default-token incompatibility is also established from
the pinned action and GitHub's Variables permission model. A live Git pin was
considered but would broaden revocation authority to Contents writers unless
additional tag restrictions were installed; this patch retains Variables as the
live authority and requires no protection changes.

## Credential and data flow

An installer must provide a dedicated fine-grained PAT with resource owner
`KeeperCommunity`, selected repository **only** `bitcoin-keeper`, repository
**Variables: Read-only**, automatic Metadata read only, and a finite expiration.
Honor organization approval requirements. Do not use a classic broad `repo`
token or add Contents/Actions/Checks write, administration or release rights.
Rotation and expiration are operational responsibilities; a credential that
expires during execution makes the collector fail closed. Rotation must revoke
the old PAT explicitly: replacing the stored secret alone cannot revoke a token
already captured by a running job. Changing/deleting the live driver variable
continues to revoke the pinned source independently of credential rotation.

Store it under repository secret `KEEPER_CANONICAL_PIN_READ_TOKEN` only after
the installation is independently reviewed and approved. This task creates no
identity or secret and does not inspect credential values. A separately managed
read-only token with equivalent repository/Variables scope can satisfy the same
interface, but it must remain valid for each independent verification step.

The caller forwards exactly `canonical_pin_read_token` to its reusable worker;
there is no `secrets: inherit`. Admission, each platform's initial verification,
and collection receive it only in the github-script step environment. The helper
immediately removes the environment key and creates a separate Octokit client.
Only `getRepoVariable` uses that client. Actions/check/artifact/source reads keep
the default workflow client; native build, dependency tools and the ZIP subprocess
receive no credential environment entry. No credential is written to disk,
outputs or artifacts. Workflow permissions and serial iOS then Android scheduling
remain unchanged.

The initial `vars.KEEPER_CANONICAL_NATIVE_DRIVER_SHA` snapshot remains mandatory.
Every `origin()` call also fetches the live variable with a no-cache request,
including both collector reads before and after artifact downloads. Pin name and
value must match the exact reviewed source and initial snapshot. Missing reader,
missing secret, denial, deletion, token revocation/expiration, malformed response or pin
change fails closed. There is no default-client or snapshot-only fallback.

## Installation sequence for the authorized operator

1. Review the patch-only comparison and upstream #7084 source, plus the separate
   #7085 linkage/credential changes. Keep their original branches intact.
2. Obtain explicit owner approval for protected-base installation. That approval
   is outstanding. This patch does not merge/install or alter protections.
3. Provision the repository-selected Variables reader and secret as above. Using
   that identity, preflight the Variables GET in the table and require HTTP 200,
   the exact variable name and the reviewed canonical source SHA. Separately
   preflight the default reader's repository/branch, Actions run/attempt, checks
   and artifact reads. A 403 or missing pin is a blocker, never a waiver.
4. Install the reviewed workflows/harness and set the nonsecret driver-pin
   variable to the exact reviewed protected `sprint` head. Record the installed
   source and reader expiration. Only an independently approved operator performs
   these steps; nothing here automatically installs into `sprint`.
5. Coordinate existing native routes before separately authorizing **one**
   canonical hosted execution. No duplicate dispatch or personal Mac is needed.
   Read-only capacity admission is not an atomic lock across legacy routes.
6. Record source/run/current attempt and original platform/check/artifact IDs.
   A revoked pin or reader after download must prevent collection. The current
   incomplete parent feature matrix still blocks a positive attestation even
   when all implemented native subsets pass. Physical acceptance and release
   approval remain independent; B1 authorization stays disabled.

## Targeted controls and remaining verification

Offline controls require separate-reader success while the default Variables
client throws, reject absent identity and API 401/403/404/500, reject malformed
and changed pins, and reject credential or pin revocation after downloads. They
check repeated live reads, removal of the credential environment key, explicit
secret forwarding, read-only workflow permissions and absence of credentials in
build/tooling steps. Existing source/run/attempt/check/artifact/matrix and ZIP
controls are retained. Exact command outcomes are recorded in the patch PR.

Checks on this patch: Node 22.23.3 full infrastructure suite **119 PASS**;
Python 3.12.14 full infrastructure suite **82 PASS**; actionlint 1.7.12 on the
three canonical workflows **PASS** (shellcheck/pyflakes integration disabled);
whitespace **PASS**. An independent reader also ran the 25 targeted
canonical/policy controls successfully on Node 24.19.0. These are cloud contract
checks, not native execution or installed-reader verification.

The dedicated identity is **not provisioned or live-tested** in this task.
Hosted native execution, full parent matrix and official security clearance are
**NOT VERIFIED**. No workflow dispatch, shared/producer branch change,
installation, protection mutation, release authorization, signing or upload is
performed by this patch.
