# Scoped Relay evidence reader

The third private reader needs Actions, Contents and Checks read access to
`KeeperCommunity/bitcoin-keeper-relay` (repository 496119449). GitHub's fine-grained
PAT form offers no Checks permission, and its general token documentation lists
Checks as a limitation. This source supplies the supported GitHub App route.
It does not register/install an App, provision credentials, install release source
or establish native/security/release acceptance.

## Existing readers remain separate

| Reader | Destination holding its credential | Selected resource and permissions |
| --- | --- | --- |
| `KEEPER_CANONICAL_PIN_READ_TOKEN` | Private mobile repository Actions secret | Private mobile Variables/Metadata read; already live-verified |
| `KEEPER_PRIVATE_APP_CONTENTS_READ_TOKEN` | Private Relay repository Actions secret | Private mobile Contents/Metadata read; already live-verified |
| Relay reader App | Private mobile settings below | Private Relay only, Actions/Contents/Checks read plus automatic Metadata read |

Do not change the two existing readers, signing/upload identities, backend keys,
production environment rules or final canonical variables for this setup.
Do not create a broad classic token or put a one-hour installation token into
`KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN` as a permanent secret.

## Authorized local administrator handoff

This is the remaining account action for the existing owner-authenticated local
agent. It uses GitHub App administration, which the Cloud integration cannot
perform. Human release approval gates remain optional; any fresh GitHub identity
verification requested by GitHub itself must be completed by the account owner.

1. In [KeeperCommunity GitHub Apps](https://github.com/organizations/KeeperCommunity/settings/apps/new),
   register a dedicated organization-owned App. Suggested name:
   `Keeper Relay Evidence Reader` (choose another unique name if needed).
   Homepage can be `https://github.com/KeeperCommunity`. Make it available only
   to this account. Disable webhooks; select no events. No OAuth user-authorization
   flow, callback server, device flow, paid feature or subscription is needed.
2. Grant repository permissions **Actions: Read-only**, **Contents: Read-only**,
   **Checks: Read-only** and automatic **Metadata: Read-only**. Grant no other
   repository, organization or account permission. In the App installation, choose
   **Only select repositories**, selecting only `bitcoin-keeper-relay`.
   Read back the complete permission and repository selection in GitHub.
3. Generate the App's private key through GitHub and keep the PEM in existing
   protected custodian storage. Provision these exact settings in
   `KeeperCommunity/bitcoin-keeper-private`, using the actual IDs from GitHub:

   | Kind | Name | Value source |
   | --- | --- | --- |
   | Actions variable | `KEEPER_RELAY_READER_APP_ID` | Numeric App ID from registration |
   | Actions variable | `KEEPER_RELAY_READER_INSTALLATION_ID` | Numeric installation ID for KeeperCommunity's selected Relay installation |
   | Actions secret | `KEEPER_RELAY_READER_PRIVATE_KEY` | Raw PEM from the new App private-key file, supplied directly through protected input/stdin |

   No value belongs in chat, PR text, logs or artifacts. Use CLI stdin for the PEM,
   not a command-line argument. Do not populate either final canonical variable.
   The old third-reader PAT secret must remain absent for this App mode: simultaneous
   PAT and App configuration is rejected rather than silently choosing an identity.
4. Return only App ID, installation ID, selected repository/permission readback and
   confirmation that the three settings were stored. The Cloud agent then performs
   the access-only check below. No app build, native test or release is needed.

App registration/setup is not a claim that this authentication source is installed
on protected sprint. Coordinate its normal reviewed integration with the existing
engineering source owner; do not move a release ref or disrupt the running native
candidate to complete credential provisioning.

## Token issuance and renewal

[`relay_reader_app.cjs`](../.github/native/relay_reader_app.cjs) signs a short-lived
RS256 App JWT in memory. It verifies the installation's App/organization IDs,
selected-repository mode, enabled state and exact read-only permissions. The only
token-issuance POST fixes `repository_ids:[496119449]` and the three required read
permissions. A second API read verifies the issued token can see exactly the private
Relay repository. It never accepts API-supplied destinations.

Installation tokens expire after one hour. Each collector process renews its token
before five minutes remain, coalesces concurrent renewals and permits one new-token
retry for an authenticated GET rejected by the SDK with401. Failed renewal or scope validation
stops the read; it does not reuse the old token or borrow `GITHUB_TOKEN`. Newer long
stateless installation-token formats are supported without assuming 40 characters.
The consumer interface does not export tokens through `auth()` or environment
variables. Existing explicit PAT use remains compatible only when no App settings
are supplied; incomplete or simultaneous identity configuration fails closed.

The scoped SDK admits only GET requests for Relay metadata, contents, Actions and
Checks. Other repositories, administrative/secret/variable endpoints, writes and
unexpected hosts/redirects are rejected. App JWTs, private keys and token-mint
responses never enter native, Git, Python or store child environments. Existing
bounded artifact readers and original Actions/check provenance checks are retained.

Automatic installation-token renewal does not rotate the App private key. Follow
the custodian's private-key rotation policy. Replacing a stored secret does not
revoke the prior App key or already issued installation tokens. Use GitHub's actual
key/installation revocation or the existing live-pin revocation mechanism when
immediate containment is required; do not represent expiry/rotation as completed
without provider readback.

## Access-only verification after setup

The [access workflow](../.github/workflows/keeper-relay-reader-access.yml) reads
actual Relay repository/branch metadata, Actions jobs and an existing linked
Check Run. It checks that unnecessary endpoints are rejected and prints only fixed
booleans plus its source SHA. It uses no production environment or signing/store
identity and grants no native/canonical/release acceptance.

It can be manually run after reviewed installation on sprint. Before that
installation, the Cloud agent can publish a separate private verification branch
named `codex/verify-relay-reader-app-20261027` containing exactly these four files
from the reviewed authentication commit:

- `.github/workflows/keeper-relay-reader-access.yml`
- `.github/native/relay_reader_app.cjs`
- `.github/native/strict_json.cjs`
- `.github/scripts/verify-ci-source.cjs`

Its push triggers only the access workflow, so it starts no app/native campaign.
The pinned source bootstrap verifies the checked-out commit before importing the
reader, with credentials removed from subprocess environments. Record the actual
run/job/source and bounded successful output in the existing administrator
checklist. Missing configuration or unreadable scopes remain BLOCKED, not a pass.

Offline verification includes real disposable RSA/JWT signatures, token renewal,
concurrency, rejection of wrong/broad/suspended installations, malformed/oversize
responses, both token formats, endpoint/write rejection and actual workflow child
credential isolation. The CI contract workflow also executes the new fixture with
the actual pinned GitHub SDK using synthetic HTTP boundaries only.

Provider references:
[App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app),
[installation tokens](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app),
[App JWTs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app),
[fine-grained token limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
