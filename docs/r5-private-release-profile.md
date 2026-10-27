# Private mobile release source profile

This candidate implements a finite alternate route for
`KeeperCommunity/bitcoin-keeper-private` (repository ID `839671816`). The app,
installed controller, workflow execution, source refs, signing/upload
environments and retained artifacts all belong to that private repository.
The public `KeeperCommunity/bitcoin-keeper` route (`470904030`) keeps its existing
identity and custody. A caller cannot add repositories or change profile
visibility through a request, variable, artifact or serialized proof.

The private route is **not installed or release-ready**. Its contract tests use
synthetic official API responses and artifacts. They do not establish a native
pass, store baseline, signed build, upload, review submission or public release.
No settings or credentials were changed to implement this source.

## Exact source and execution

The existing protected worker workflow can run in either finite repository.
In the private route, `sourceSha == driverSha == github.sha` remains mandatory:
both checkouts restore the actual private repository at its current protected
`sprint` commit. The live driver pin, protected `release/<version>` source ref,
raw Git blob/tree verification and production-source checks still apply.
No public context or API response is substituted for a private identity.

The same-process collectors select private API endpoints and verify private
repository ID, full name and positive private visibility. Exact official run,
attempt, actor permissions, workflow, check-suite/check IDs, latest producer,
artifact digest/size/expiry and reread fences remain required. Unknown or false
private visibility fails. The private receipt and artifact route retain the
actual private repository identity. A copied public receipt or JSON proof
cannot supply authority.

Tests, CodeQL/SARIF and all seven native cases remain required for the exact
source. The private profile does not translate diagnostic success into installed
acceptance. Physical checks remain `NOT RUN / NOT WAIVED` until their separately
authorized real evidence exists. Human approval remains optional; configured
optional review rules still apply, and administrator bypass stays disallowed.

## Private native parent source

The committed private parent profile is
`r5-private-mobile-f0-intel-20261026`. Its live manifest uses the existing schema
but binds `app.repository` to `KeeperCommunity/bitcoin-keeper-private`, with that
app's exact SHA/tree and private canonical run/attempt in the `public` field.
That field name is a schema compatibility name for the canonical software
proof; it does not change repository visibility. Both private descriptors must
bind the same private app and the unchanged Relay backend
`29597b27eeeb299205bf7d0555db0a90c38cc4be`.

The native parent producer remains private Relay `496119449`, using the reviewed
f0 producer baseline and serial iOS/Android windows. App commit/tree/content reads
use the private mobile caller's ordinary read-only Actions client. Relay
tooling/runs/artifacts use the distinct
`KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN` client. Neither client is passed to
native, Git, Python or store subprocesses.

For future reviewed Relay producer windows, replace the anonymous public app
fetch step with this exact source transport (substitute the complete private app
commit for `<app-sha>` and bind the same SHA/tree in its policy and marker):

```yaml
      - name: Fetch fixed private app with scoped read identity
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          repository: KeeperCommunity/bitcoin-keeper-private
          ref: <app-sha>
          path: app
          fetch-depth: 0
          persist-credentials: false
          token: ${{ secrets.KEEPER_PRIVATE_APP_CONTENTS_READ_TOKEN }}
```

Full history retains immutable historical `3eb92fc8` source used by the existing
recovery/address-member comparison; the source must be an ancestor of the chosen
private app commit. This adds no historical native acceptance.

The existing raw source checks before dependency installation and after native
execution remain mandatory. The consumer requires this complete pinned step,
the successful source-fetch job step, the private app's official API identity,
and all original raw software receipts. The current private bundle diagnostic
jobs use another source transport and are not admitted by this profile. The
profile does not itself install a Relay producer, generate a window manifest,
or claim those native runs have occurred.

## Reproducible local producer preparation

`scripts/prepare_private_native_parent.py` derives the reviewed f0 control source
from local immutable Git objects and pins the selected app SHA/tree in every
existing consumer and policy. It updates the policy hash, admits only the exact
private checkout secret input, retains the historical-source comparison, and
aligns the workflow and three raw-source guards on Node `22.23.4`. All changed
paths must remain in f0's existing finite control-path list. It changes no
backend runtime source.

The output contains separate `app` and `control` checkouts, no Git remotes, and
local iOS/Android marker commits. The Android commit follows the iOS commit and
their trees differ only at the platform marker. `preparation.private.json`
records the actual source/commit/tree identities with run IDs unset and native
acceptance `NOT_RUN`. These are local source candidates; the generator never
pushes, dispatches, writes settings, reads credentials or installs a live pin.
Existing output directories are rejected. Local object alternates mean the
source repositories must remain present until the prepared commits are copied
through an authorized private transport.

Regenerate against the checked-out combined source after version/native fixes:

```bash
python3 -B scripts/prepare_private_native_parent.py --app-source "$PWD" --app-sha "$(git rev-parse HEAD)" --relay-source /workspace/r4-closeout-20261024/relay --output "/workspace/r5-private-265-intake-20261025/private-release-parent-$(git rev-parse HEAD)"
```

Review the generated source before scheduling. The two prepared commits are
not two completed windows: schedule iOS first and obtain its actual successful
run/attempt and original artifacts, then schedule Android and obtain its own
actual evidence. A current live window manifest must bind those actual records;
the local preparation receipt cannot populate native or release authority.

## Required setup and evidence, not performed

The public environments cannot supply secrets to a run owned by the private
repository. Referencing a public reusable workflow does not transfer that
environment's custody. The minimum direct route therefore needs explicit
custodian setup of `keeper-release-ios` and `keeper-release-android` in private
repository `839671816`, with the same operation-scoped secret/variable names
listed in [the worker runbook](../release/cloud/README.md). Configure protected
source branches and disabled administrator bypass there. No key should be moved,
copied, rotated, fetched from a personal keychain, or used by this preparation.

The private repository also needs its existing live-pin reader selected for its
own Variables, the current `KEEPER_CANONICAL_NATIVE_DRIVER_SHA`, and a genuinely
verified `KEEPER_CANONICAL_PRIVATE_WINDOW_JSON` selecting the private profile.
The Relay Actions/Contents reader stays separate. The direct native source
checkout above additionally requires `KEEPER_PRIVATE_APP_CONTENTS_READ_TOKEN`
in private Relay: an explicitly provisioned identity restricted to read-only
Contents/Metadata on private mobile. It has no production or repository-write
permission, is used only by checkout, and is not persisted. These are technical
installation/custody prerequisites, not a new human release approval ceremony.

The administrator/custodian delta is confined to these private settings:

| Setting | Exact location and scope |
| --- | --- |
| Private CodeQL availability | [Private mobile Code security](https://github.com/KeeperCommunity/bitcoin-keeper-private/settings/security_analysis): enable the repository's CodeQL/code-scanning capability. The actual exact-source scan must succeed; enabling the feature alone is not a security result. |
| `keeper-release-ios` and `keeper-release-android` | [Private mobile environments](https://github.com/KeeperCommunity/bitcoin-keeper-private/settings/environments): create/select these environments, configure protected branches and disabled admin bypass, then explicitly provision the existing operation-scoped identities/configuration named in the worker runbook. The public environments are not a source of automatically inherited credentials. |
| Required protected source checks | [Private mobile rules](https://github.com/KeeperCommunity/bitcoin-keeper-private/settings/rules): protect `sprint` and the selected `release/<version>` source; require the native/security checks, Tests and `Protected backup v3 proof`. |
| Live pin/window Variables and read identity | [Private mobile Actions configuration](https://github.com/KeeperCommunity/bitcoin-keeper-private/settings/variables/actions) and [secrets](https://github.com/KeeperCommunity/bitcoin-keeper-private/settings/secrets/actions): use the existing named pin/window mechanism for this repository's exact installed source; keep the pin reader and Relay Actions reader separately scoped. Do not set a window until its actual evidence exists. |
| Private app source reader for Relay checkout | [Private Relay Actions secrets](https://github.com/KeeperCommunity/bitcoin-keeper-relay/settings/secrets/actions): `KEEPER_PRIVATE_APP_CONTENTS_READ_TOKEN`, restricted to private mobile Contents/Metadata read; no signing, upload, admin or write privilege. |

In private mobile's Actions secrets, `KEEPER_CANONICAL_PIN_READ_TOKEN` needs
Variables read on private mobile, and
`KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN` needs Actions, Contents and Checks
read on private Relay. Select only the repository required by each identity.
The supported alternative for the Relay reader is the
[dedicated reader App](r5-relay-reader-app.md), whose installation tokens renew
automatically. In that mode, provision its two ID variables and private-key secret
instead of the old third-reader PAT secret; do not configure both identities.
Neither existing pin/source reader is replaced or widened.
The source driver SHA and window JSON will be supplied after their actual
source and run identities are established; do not invent provisional values.

Protect private `sprint` with the existing required Tests/security/native gates
and the required **Protected backup v3 proof** check. The private release origin
requires that job's actual whole-source run of all 351 cases and all 295 retained
obligations. The old public-v2 characterization may be skipped in the private
workflow only when this replacement succeeds; it supplies no substitute pass.

After reviewed installation, produce fresh exact-source private Tests/CodeQL and
canonical/native-parent evidence, recheck store histories and production config,
then invoke one authorized worker operation with the existing request schema.
Signing, upload, App Review submission, release after Apple approval, and Play
rollout retain their separate operation/artifact gates. Private logs/artifacts
remain accessible to private-repository readers under the existing retention.

The inspected integration source still declares version `2.6.4`, Android `627`
and iOS `620`. The intended `2.6.5` version/counters require fresh authenticated
store histories and the ordinary release preflight. This change does not invent
those histories or advance counters. Each new source commit invalidates earlier
source-specific evidence.
