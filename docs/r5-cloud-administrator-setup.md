# Cloud release administrator and custodian setup

This is a reviewable setup specification, **not authorization to apply it or run
release workers**. No setup, credential change, signing, upload, merge or
deployment is performed by this document. Use hosted Cloud infrastructure and an
existing authorized custodian; no personal Mac or keychain export is required.
The [operator handoff](r5-protected-release-handoff.md) retains the package ledger
and native/provenance blockers.

The latest successful read-only inventory on 22 October 2026 returned only
`copilot`, `Env` and `keeper-claude-review`. Both proposed release environments
were absent. Earlier secret-name and variable-name API reads returned HTTP403;
custody and credential readiness are **UNKNOWN**, not proven absent. The managed
task has no configured release credentials. Neither an environment name nor a
secret name proves a usable signing/store identity.

## Administrator specification

After separately approved administration, configure exactly
`keeper-release-ios` and `keeper-release-android` in
`KeeperCommunity/bitcoin-keeper`. The current
[gate](../scripts/protected-release-plan.cjs) requires the following metadata for
each environment:

```json
{
  "can_admins_bypass": false,
  "protection_rules": [
    {
      "type": "required_reviewers",
      "prevent_self_review": true,
      "reviewers": ["<actual approved independent user/team metadata>"]
    }
  ],
  "deployment_branch_policy": {
    "protected_branches": true,
    "custom_branch_policies": false
  }
}
```

This is a shape specification, not a GitHub API write payload. Use actual approved
reviewer IDs and verify that the requester cannot approve their own deployment.
The gate expects exactly one required-reviewers rule with at least one reviewer.
Custom branch-name rules alone fail this gate. Protected-branches-only permits
protected branches as a class; it does not prove exact-source authorization.
The driver additionally requires `refs/heads/sprint`, its current protected SHA,
and a protected `release/<version>` ref at the requested source. Signed-build
source must equal the installed canonical driver SHA. Keep those code checks.

Install source only through separately approved review/merge. Read back the
effective rules for `sprint` and the intended `release/<version>` ref, including
actor/bypass scope and force-push/deletion controls. Require `Tests` and
`keeper/local-validation` for `sprint` as AGENTS.md specifies; retain the actual
security/native requirements and applicable review policy. A reported check is
not protected enforcement. Record a secret-free negative-control plan proving
wrong ref/source, absent independent review, self review, and bypass attempts
cannot reach a credential-bearing step. Perform that plan only under its own
approved infrastructure-testing scope. Do not weaken rules to make a test pass.

The canonical producer #7084 additionally reads the nonsecret Actions variable
`KEEPER_CANONICAL_NATIVE_DRIVER_SHA`; its value must be the full reviewed current
protected canonical driver SHA and the selected source must equal it. The
workflow has no environment, so provide this separately approved pin at a scope
visible to that workflow and verify its live read-only API visibility rather than
assuming environment variables supply it. Successor
[#7095](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7095),
`effd9175c00ebbdbaf616813a3ecfa6886bbbf45`, fixes the candidate's default-token
Variables-read incompatibility. Its separate installation requirement is the
repository secret **`KEEPER_CANONICAL_PIN_READ_TOKEN`**: a finite-expiry fine-grained
PAT with resource owner KeeperCommunity, selected repository only `bitcoin-keeper`,
**Variables: Read-only** (`actions_variables=read`) plus automatic Metadata read.
Obtain organization approval if required; no broad classic PAT or write/admin
rights. Require a live GET200 of the exact named variable/reviewed SHA under that
identity. The default token remains for the other read endpoints; no cached pin
or default-token fallback is acceptable. Explicit reusable alias
`canonical_pin_read_token` is step-scoped and removed before subprocesses. During
later authorized rotation revoke the old PAT; replacing the stored secret does
not revoke an already running token. This identity is not provisioned/live-tested
here. Review/adopt #7095 separately; it is not installed or included in this
reconciliation branch. Pin/credential creation or update is not authorized here.
The #7085 consumer is not an authorization integration. Keep B1's
private origin capability unminted and all authorization flags false until
genuine canonical evidence, security linkage and enforcement are established.

## Exact protected names and operation scope

These names come from the current
[workflow](../.github/workflows/keeper-protected-release-workers.yml) and
[adapter README](../release/cloud/README.md). Provisioning or copying values is
outside this task. Record the custodian and approved scope privately; place no
values, private files or key material in issues, PRs, requests, logs or artifacts.

| Environment | Kind | Exact names | Used only for |
| --- | --- | --- | --- |
| Both | Variable | `KEEPER_RELEASE_CERT_SHA256`, `KEEPER_PRODUCTION_CONFIG_SHA256` | Independent lowercase SHA256 identity/config pins; also bound to owner receipt |
| Both | Secret | `KEEPER_PRODUCTION_CONFIG_BASE64` | Signed build's reviewed client-safe dotenv bytes; no signing/store/server secret embedded |
| iOS | Variable | `KEEPER_IOS_TEAM_ID`, `KEEPER_IOS_PROFILE_UUID` | Existing production team/profile binding |
| iOS | Secret | `KEEPER_IOS_P12_BASE64`, `KEEPER_IOS_P12_PASSWORD`, `KEEPER_IOS_PROFILE_BASE64` | `ios-signed-build` only |
| Android | Secret | `KEEPER_ANDROID_KEYSTORE_BASE64`, `STORE_PASSWORD`, `KEY_PASSWORD`, `KEY_ALIAS` | `android-signed-build` only |
| iOS | Secret | `KEEPER_ASC_KEY_ID`, `KEEPER_ASC_ISSUER_ID`, `KEEPER_ASC_KEY_BASE64` | `testflight-upload` only |
| Android | Secret | `KEEPER_PLAY_SERVICE_ACCOUNT` | `play-internal-upload` only |

Signing steps must not load upload credentials; upload steps must not load
signing credentials. Keep the existing step-scoped references, credential-free
frozen dependency setup, and fresh revalidation after environment review,
immediately before secret loading and at adapter entry. Do not use repository or
organization secret fallbacks to bypass an absent/protected environment.

## Custodian metadata acceptance

Use existing vault inventories, public certificates/profile metadata and
authorized read-only store consoles/API reports. This task does not authorize
credential retrieval, private-key export, provider login, certificate issuance,
key rotation, provisioning changes or an upload to test access. Redact account
emails, subject names and unrelated organization details from public evidence.

| Boundary | Safe metadata to verify and record | Current result |
| --- | --- | --- |
| iOS distribution identity | Independent SHA256 of public certificate DER, distribution type, team and expiry/revocation state; custodian confirms matching existing private-key custody without exporting it | UNKNOWN |
| iOS profile | Existing UUID/team, app identifier `TEAM.io.hexawallet.keeper`, App Store distribution type, certificate inclusion, entitlement compatibility, `get-task-allow:false`, no provisioned-device list or enterprise all-device flag; certificate/profile valid beyond the intended operation plus two hours | UNKNOWN |
| Android upload identity | Independent SHA256 of public upload certificate DER, expiry, custodian-confirmed existing authorized keystore/alias custody; match Play Console's **upload** certificate and separately record App Signing certificate continuity | UNKNOWN |
| App Store Connect | Existing app/bundle `io.hexawallet.keeper`, approved team/issuer/key identity and least-privileged app access, active agreements, complete fresh uploaded version/build history including processing/nonpublic builds | UNKNOWN |
| Google Play | Existing package `io.hexawallet.bitcoinkeeper`, approved service-account app/internal-track rights, required API access/agreements, complete fresh version-code/track history including drafts | UNKNOWN |
| Production configuration | Owner-reviewed allowlisted client configuration and independent exact-byte SHA256; no private values in public evidence; full built-binary config readback remains a separate unverified acceptance item | UNKNOWN |

Fingerprint pins must come from independent approved metadata, not solely from
the artifact being checked. Secret existence, successful SDK authentication or a
listed role alone does not prove app/channel authorization or signing readiness.
Current source inputs are 2.6.4 / iOS620 / Android627. Historical store baselines
in `release/version.json` are not fresh store acceptance or allocation of new
counters. The current gate requires fresh complete store/version evidence.

For later operation approval, the owner receipt must bind the exact source and
driver SHA, operation, version/build, artifact/certificate/config digest, expiry
and the 14-day GitHub Actions artifact audience. Signed artifacts in this public
repository can be accessible to authenticated public-repository readers. If that
audience is not approved, a separately reviewed private transport is required.
Do not generate an approval on the owner's behalf.

## Safe readback and durable result

The following GET commands project metadata only. Run with already authorized
Cloud identity and inherited proxy/CA settings. Do not print auth configuration,
tokens, environment dumps or secret files. Treat403/404 as unavailable evidence;
a403 never establishes absence.

```sh
gh api repos/KeeperCommunity/bitcoin-keeper/environments --paginate \
  --jq '{total_count,environments:[.environments[]|{name,can_admins_bypass,protection_rules,deployment_branch_policy}]}'
gh api repos/KeeperCommunity/bitcoin-keeper/environments/keeper-release-ios \
  --jq '{name,can_admins_bypass,protection_rules,deployment_branch_policy}'
gh api repos/KeeperCommunity/bitcoin-keeper/environments/keeper-release-android \
  --jq '{name,can_admins_bypass,protection_rules,deployment_branch_policy}'
gh api repos/KeeperCommunity/bitcoin-keeper/environments/keeper-release-ios/secrets --paginate \
  --jq '{total_count,secrets:[.secrets[]|{name,created_at,updated_at}]}'
gh api repos/KeeperCommunity/bitcoin-keeper/environments/keeper-release-android/secrets --paginate \
  --jq '{total_count,secrets:[.secrets[]|{name,created_at,updated_at}]}'
```

Variable collection endpoints also return nonsecret **values**. If an approved
administrator uses them, project only `name`, `created_at` and `updated_at` before
any output/storage; never retain the raw response or emit the production config.
Use the existing inventory helper for environment metadata with
`execution_allowed:false`. Its collection-level restriction summary does not
verify `can_admins_bypass`, exact allowed source or functioning review enforcement.

Record a bounded readiness receipt: UTC observation time; exact source/driver
SHA; API route and successful/unavailable outcome; effective rule/reviewer
metadata; expected name presence only; custodian-owned identity/expiry/app/channel
checks; store-history freshness; unresolved blockers; and `execution_allowed:
false`. Actual signing/store operations, hosted cleanup, artifact readback and
physical/native acceptance remain **NOT RUN / NOT VERIFIED**. Continue with the
cloud-only operator handoff; never convert this setup receipt into authorization.
