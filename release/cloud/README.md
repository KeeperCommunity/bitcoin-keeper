# Protected release orchestration — Phase B3 candidate

The [current-installed source bridge](../../docs/r5-current-release-source.md)
connects genuine same-process SDK/native/security authority to the protected
workers. The [existing-build live continuation](LIVE-CONTINUATION.md) adds App
Review submission, separate release after Apple approval, and exact-AAB production
promotion to the same manual workflow. This is implemented candidate source,
not protected installation or live acceptance. Physical acceptance remains
NOT RUN / NOT WAIVED. No store or credential action was performed here.

These are **implemented future worker candidates, NOT EXECUTED / NOT VERIFIED**. They combine separately reviewable preparation #7072, fail-closed origin guard #7074, worker core #7076 and frozen Ruby inputs #7078. Those producer checkpoints and the primary R5 native candidate are unchanged. No workflow was dispatched, credentials provisioned, signed app built, store contacted, binary uploaded, deployment made or paid setup initiated to prepare this package. Host contracts use synthetic data and fake actions only. Do not treat those contracts as successful remote signing/distribution.

The [manual workflow](../../.github/workflows/keeper-protected-release-workers.yml) has seven explicit operations. The original four are listed below; the three existing-build live operations and exact inspect/execute request are in [LIVE-CONTINUATION.md](LIVE-CONTINUATION.md). Each invocation performs exactly one operation:

| Operation | Adapter behavior | Deliberately separate next decision |
| --- | --- | --- |
| `ios-signed-build` | Build/export one manually provisioned production IPA with an existing pinned certificate/profile; verify native metadata, app ID/version/build, signature, team/profile/entitlements and certificate. Retain only IPA and signed-build receipt. | TestFlight upload needs its own exact-artifact runtime authorization; human receipt/review is optional. |
| `android-signed-build` | Build one production AAB using the existing approved upload keystore, with environment-only signing inputs; verify metadata/version/channel and strict JAR signature against the pinned certificate. Retain only AAB and signed-build receipt. | Play internal upload needs its own exact-artifact runtime authorization; human receipt/review is optional. No APK/sideload route is added. |
| `testflight-upload` | Download the exact approved successful canonical signing-run artifact, reject substituted bytes/receipt/provenance, recheck IPA identity/signature, then upload without external distribution or submission. | Physical testing, store-selected build/processing evidence and any further distribution/submission/publication are separate. |
| `play-internal-upload` | Verify the exact successful canonical signing-run artifact and AAB signature, then upload to **internal draft**, skipping metadata/images/screenshots and automatic review submission. | This is not an approved production rollout or proof of tester delivery. Store-selected build/review and later rollout require their own exact evidence and runtime operation scope. |

The standalone [Fastfile](Fastfile) is loaded in a disposable directory without legacy Appfiles, callbacks, Slack or dev/live lanes. It only uploads already verified artifacts. Existing source guards (`release-version.cjs`, `verify-channel-config.cjs`, `verify-release-artifact.py`) are reused. Existing Android signing configuration is consumed only after its release block passes the bounded literal-credential check. Existing iOS automatic certificate/profile acquisition is replaced with pre-provisioned manual signing; no material is created, rotated or fetched from a personal keychain.

TestFlight stops after the binary upload command: `skip_waiting_for_build_processing:true` and no changelog return before pinned Fastlane2.225.0 enters its processing/distribution path. `skip_submission:true` alone is insufficient because that path updates beta metadata first. Processing and store-selected build verification remain separate, unperformed steps. A regression executes the pinned library with fake login/package/transporter boundaries and proves the previous waiting flag reaches that path.

## Trust, authorization and optional human review

The installed driver must run from the **current protected sprint SHA**. A signed build additionally requires candidate SHA = driver SHA, so PR or uninstalled release-branch code cannot execute with production signing material. A protected `release/<version>` ref must point to that exact source. An upload may use an older reviewed protected source, but candidate files are read only as data; only the current installed driver/uploader code executes.

The current source implements the branded SDK bridge and a finite native parent profile; neither is installed merely by preparing this candidate. API JSON, status names, actor assertions and copied proofs cannot create authority. Real operations still require current protected installation and genuine native/security/parent evidence. No worker operation has run.

Human receipt comments and environment reviewers are **optional** under the owner's standing direction. Repository authorization remains mandatory: the SDK checks the official current workflow run's original and rerun actors against live write/maintain/admin permissions, and rechecks them after evidence collection. Its execution authority expires four hours after the official run start. A supplied optional exact owner receipt can shorten but never extend that window. An enabled optional environment review rule must remain valid and prevent self-review; unknown/allowed administrator bypass remains blocking.

Before the environment job, the gate requires authentic exact successful Tests/CodeQL/native evidence, fresh store/build baselines, consistent native versions and authenticated dispatcher authority. The installed SDK verifies required producers directly; selected-route skips and PR-head passes supply no native credit. Absent dedicated environments, unknown administrative bypass policy and unverified protected-branch restrictions remain blocking. No automated security/native requirement is removed by optional human review.

The worker's own in-progress authorization/operation checks are excluded only after proving their exact current Actions run, current attempt, trusted workflow path/repository/driver SHA, job check IDs/names and check-suite ID. Complete bounded pagination is required before filtering. Unrelated pending/failed checks, other attempts and required independent checks remain blocking; the preparation workflow is not accepted as native or security evidence.

After any optional environment review, the worker repeats those read-only checks **before any operation credentials are referenced**. Dependency setup runs without production credentials and without caches. It then repeats the checks immediately before the step-scoped signing/upload secrets, and again at entry to execution. Uploads repeat live authorization after artifact download. The request/receipt also binds independently approved certificate and production-config SHA256 values, matched against protected environment variables. A received preparation plan cannot authorize execution. Signing and upload are not chained.

Execution authority, and any supplied optional receipt, must remain valid for at least two hours at adapter entry; jobs time out after100minutes. Profiles/certificates also need at least two hours of validity. An expired, revoked, moved or newly failing candidate is rejected by fresh checks. No approval is generated or posted on behalf of the owner.

## Exact request and optional owner receipt

The single `request_json` dispatch input contains only these ten string fields (no credentials or configuration values):

```json
{
  "source_sha": "<40 lowercase hex>",
  "release_ref": "release/<version>",
  "operation": "ios-signed-build",
  "version": "<version>",
  "build": "<platform counter>",
  "artifact_sha256": "pending",
  "approval_comment_id": "none",
  "certificate_sha256": "<64 lowercase hex independently verified fingerprint>",
  "config_sha256": "<64 lowercase hex approved client-config digest>",
  "artifact_id": "none"
}
```

The `approval_comment_id` field may be omitted or set to `none`; no owner comment is fetched in that case. For an upload, select its upload operation, supply the actual app-file SHA256 and the successful signing run's numeric GitHub artifact ID. If an optional human receipt is supplied, it retains the exact #7072 fields, plus these lines between `Workflow commit` and `Expires at`:

```text
Signing identity SHA256: <certificate_sha256>
Production config SHA256: <config_sha256>
Artifact storage: GitHub Actions public-repository readers (14 days)
```

**Artifact retention is explicitly part of this future approval.** Signed binaries stored as Actions artifacts in this public repository can be accessible to authenticated readers of the public repository; do not treat them as a private beta channel. If that audience is not approved, do not use this worker: implement/review a private artifact transport first. Upload receipts contain no binary; signed-build artifacts contain only the approved IPA/AAB and bounded receipt. Native logs, `.env.production`, profiles, private keys, keychains, service-account JSON and API key content are never retained as artifacts.

The receipt binds operation, source/driver SHA, marketing version/platform build, artifact/certificate/config digests, run/attempt, approval comment/expiry and source artifact lineage. `storeUploaded` means only that the upload adapter command completed. `storeProcessingVerified` remains false: it does not establish a store-selected build, external distribution, review submission, public release or readiness. Verify those separately before further action.

## One-time protected setup — not performed

Use separately approved administrator/custodian setup; never put credential values in a PR, dispatch request, task sheet or command log. #7072's HTTP403 secret-name reads do not prove credentials absent. No personal Mac is required; use an existing approved credential vault/custodian or signing service, not an automatic export/copy of the owner's keychain.

| Scope | Required names/conditions |
| --- | --- |
| Both protected environments | Existing `keeper-release-ios` / `keeper-release-android`; human reviewers optional, self-review prevented if configured, administrative bypass disabled, protected-branch restriction. Confirm actual rejection/enforcement before any secret-enabled trial. |
| Both environments' variables | `KEEPER_RELEASE_CERT_SHA256`, `KEEPER_PRODUCTION_CONFIG_SHA256`: independently verified64-character lowercase digests, also bound to owner receipt. No certificate fingerprint is guessed from the artifact alone. |
| Signed builds' shared secret | `KEEPER_PRODUCTION_CONFIG_BASE64`: exact owner-reviewed client-safe dotenv bytes. The adapter requires its approved digest, rejects unknown/duplicate keys and reuses production channel/service guards. Known client keys are allowlisted; secret signing/upload/server credentials are not permitted in this embedded configuration. |
| iOS signing secrets | `KEEPER_IOS_P12_BASE64`, `KEEPER_IOS_P12_PASSWORD`, `KEEPER_IOS_PROFILE_BASE64`: existing approved distribution identity/profile, not a new certificate. Protected variables `KEEPER_IOS_TEAM_ID` and `KEEPER_IOS_PROFILE_UUID` must match actual production app/team/profile and pinned certificate. |
| Android signing secrets | `KEEPER_ANDROID_KEYSTORE_BASE64`, `STORE_PASSWORD`, `KEY_PASSWORD`, `KEY_ALIAS`: existing authorized upload identity. Verify continuity independently; the Play App Signing certificate and upload certificate are distinct. AAB-only output avoids claiming that an upload-key APK is suitable for existing sideload users. |
| TestFlight upload secrets | `KEEPER_ASC_KEY_ID`, `KEEPER_ASC_ISSUER_ID`, `KEEPER_ASC_KEY_BASE64`: least-privileged approved App Store Connect API identity with intended app/channel access. These are not loaded during signing. |
| Play internal upload secret | `KEEPER_PLAY_SERVICE_ACCOUNT`: least-privileged approved JSON API identity for the existing app/internal draft upload. It is not loaded during signing. |

Dependencies must already be reviewed/installed on canonical source: Phase A's `.github/native/nodeify.cjs`, frozen Yarn/Pod/Gem inputs and compatible native source. Missing helper/lock inputs fail rather than invent a dependency workaround. No production-secrets caches are used. The workflow uses hosted macOS15/Xcode16.4/Ruby3.3.8/Node22.23.4 and Linux/Java17/SDK36/build-tools35/NDK27.1.12297006; these are reviewed development-route pins, **not new proof of production signing compatibility**. At least16GiB free disk is required; the worker serializes its own operations and must be scheduled in an exclusive native-build window alongside other release work.

**Exact-canonical native proof remains a separate readiness dependency.** A normal merge/squash creates a new canonical SHA, while current hosted native/keeper-local evidence is scoped to a PR head. The signing worker refuses to inherit those passes. Install/review an exact-canonical native attestation entry point and produce its genuine required checks on the protected canonical SHA before this worker can operate. Ordinary merge alone does not make signing ready; this package does not weaken source trust, manufacture status or execute post-merge release operations.

Nodeify's three module-mapping fields (`browser`, `react-native`, `browserify`) are a recorded build overlay, not a source promotion. A trusted setup step records canonical source SHA and before/after package hashes; all other manifest fields and tracked source, including staged changes, must match HEAD. The same exact overlay is rechecked before native execution and before receipts. The canonical clean driver still runs the ordinary release-version preflight. Separate Ruby package #7078 pins CocoaPods1.16.2/Xcodeproj1.27.0 and completed an actual frozen118-gem install/load/project parse under portable Ruby3.3.8. This orchestration inherits those reviewed inputs, while its inherited base Podfile.lock still records CocoaPods1.15.2. Pair the adopted native foundation’s reviewed CocoaPods1.16.2 Podfile.lock during future integration; the worker rejects a mismatch before credentials. No Podfile lock is silently regenerated here, and actual combined hosted frozen Pod/native acceptance remains required.

Bundletool1.18.1 is pinned to observed SHA256 `675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c`,32,505,571bytes downloaded through official GitHub release HTTPS during preparation. Upstream release metadata supplied no digest. This is an observed source pin, not independently publisher-authenticated proof; independent review of that tool/input remains required before approving actual execution.

Private signing files use exclusive0600 files in a0700 temporary directory. iOS uses a transient unlocked keychain, explicit manual provisioning and signing identity; its previous profile/search-list state is restored and its keychain deleted in failure/success cleanup. The candidate dotenv is created exclusively and removed only when this worker created it. Raw build/provider output is captured privately and discarded; public failure evidence contains only fixed stage categories. No unrelated files/caches/worktrees are deleted.

Keychain restoration/deletion each has a bounded30second check. An otherwise successful build fails before any success receipt when cleanup fails; if the build already failed, its primary stage is preserved and cleanup failure is additionally reported. Fake-action controls exercise both cleanup failures and the combined primary/cleanup failure. No real keychain was created or modified by these tests.

## Validation and remaining acceptance

Run only the fake-action contracts for review:

```sh
node --test scripts/protected-release-plan.test.cjs scripts/protected-release-worker.test.cjs
python3 -B -m unittest discover -s scripts -p 'test_cloud_release_worker.py'
ruby scripts/test_cloud_upload_adapters.rb
bundle exec ruby scripts/test_cloud_upload_fastlane.rb
```

Actual protected-rule enforcement, certificate/profile compatibility, hosted signed build, signature/provenance, upload/provider receipt and artifact transport remain **NOT RUN / NOT VERIFIED**. Apply the latest owner instructions and [conditional review policy #7034](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7034): this signing/workflow package needs adequate Balanced review; record the actual route, exact-source coverage and findings. Claude is unavailable/uninstalled for this task and no fresh paid activation is authorized; do not invent a completed provider review or a blanket human-review requirement. Approved capacity/custody setup and a later explicitly authorized disposable/approved-channel trial must exercise failure cleanup and exact artifacts before capability is called verified. No physical-device or native feature acceptance is established by this package. The existing-build continuation now implements those separate operations; they remain unexecuted and require their actual technical inputs. See the [current package handoff](../../docs/r5-protected-release-handoff.md) for cross-package dependencies and observed setup.

The later isolated dependency reconciliation pairs #7078's Ruby inputs with
#7082's reviewed Pod/Nitro inputs, without changing either producer. The old
mismatch described above remains a historical failure on the producer heads.
Run `python3 -B scripts/check_cloud_release_inputs.py --root .` for a read-only
alignment report on any proposed assembled source; never update locks to make
the check pass. Alignment does not install missing native helpers or transfer
native acceptance from #7082. Follow the current package handoff and
[exact administrator/custodian specification](../../docs/r5-cloud-administrator-setup.md)
before any separately approved installation. Installation and genuine automated acceptance remain unverified.
