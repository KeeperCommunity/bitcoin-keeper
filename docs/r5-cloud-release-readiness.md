# R5 protected cloud release preparation

Current continuation: this document preserves the original #7072 preparation
inventory and design. The worker and orchestration source described below was
subsequently prepared separately in #7076, #7080 and #7086, with frozen Ruby/input
alignment in #7078/#7096. See the [current package ledger](r5/DELIVERY-CONTINUATION.md)
and [prepared worker boundaries](../release/cloud/README.md) for exact commits,
checks and remaining setup. Source preparation does not establish installed or
operational signing/distribution; authorization remains disabled and no release
operation has run. The historical implementation list below is not a request to
duplicate those completed packages.

This is the separate Phase B preparation package for [#7061](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7061), following [#7065](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7065). It does not install or execute signing or distribution. **Hosted signing/distribution: NOT IMPLEMENTED / NOT VERIFIED.** The personal Mac is not a prerequisite in the proposed route. Existing app, native acceptance, exact-head gate and physical-device requirements remain separate.

Source inspected: R5 core `77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238` and 5.1 `c1c4b803039b61b940373c4dc9d08473cf25e042`, containing released R4 `1d8a86a7462d935cbd0e28b857934b5718c152fc`. This package does not establish whether 5.2 is complete or integrated. App inputs are still 2.6.4 / Android627 / iOS620; no R5 version/build counters are assigned here. Work-package names 5.1 and 5.2 are not versions.

## Verified inventory, 22 October 2026

| Existing source/capability | Evidence and consequence |
| --- | --- |
| iOS `build_only` | Calls `get_certificates`, `get_provisioning_profile`, project provisioning and `build_app`; this is a **signed build**, requiring approval before invocation. It is not a safe unsigned preflight. |
| iOS `live` / `dev` | Invoke TestFlight upload. `dev` also downloads environment configuration and increments a build number. Do not use either as a native test command. |
| Android `build_only` | Builds signed production AAB/APK using keystore/password inputs and verifies resulting artifact versions. Requires signing approval. |
| Android `live` | Calls `upload_to_play_store` for the internal track after its build. Internal upload is distribution and requires separate explicit approval. |
| Android release signing block | Reads keystore/password/alias from environment. No literal production password/alias was found in the inspected release block. Android public debug credentials remain separate. This bounded review is not proof that every historical credential is safe or current. |
| Protected GitHub environments | Read-only environment API returned `copilot`, `Env`, `keeper-claude-review`. No dedicated iOS/Android release environment was present. No environments or rules were changed. |
| Secret/variable inventory | Repository secret-name and variable-name API reads returned HTTP403. Contents were never requested. Existing values, owners, scope and usability are **UNKNOWN**, not proven absent. Managed task runtime reports no configured secrets/identities; that does not describe store or repository credentials. |
| Reviewer route | `keeper-claude-review` exists with a branch policy. This does not prove Claude is enabled, paid capacity approved, review executed or findings resolved. Existing independent/Claude review requirement remains open; no paid request was initiated. |

The read-only helper can refresh bounded source/configuration evidence without reading keys or secret values:

```sh
python3 scripts/cloud_release_inventory.py --root .
gh api repos/KeeperCommunity/bitcoin-keeper/environments > /tmp/keeper-environments.json
python3 scripts/cloud_release_inventory.py --root . --environment-metadata /tmp/keeper-environments.json
python3 -B -m unittest discover -s scripts -p 'test_cloud_release_inventory.py'
```

The helper never invokes Fastlane, builds, signs, logs in, uploads, changes configuration or grants permission. Its JSON always has `execution_allowed: false`; a named environment and a reviewer rule cannot prove exact source restriction, credential custody or functioning enforcement. Missing environment metadata stays UNKNOWN. Literal-credential findings include only field/line, never values; investigate any finding through [private vulnerability reporting](../SECURITY.md). This is a narrow source inventory, not a secret scanner or release gate.

## Prepared reusable authorization workflow

The candidate [protected preparation workflow](../.github/workflows/keeper-protected-release-plan.yml) implements manual dispatch, a secret-free trusted-driver authorization job, and a protected environment review boundary. It is **not installed on sprint and was not dispatched**. It has no signing or upload command and passes no production secrets to either job.

The executable [gate](../scripts/protected-release-plan.cjs) requires all of:

- Execution from the current protected `sprint` driver commit; no PR/mutable driver acceptance.
- An exact immutable candidate SHA at the current protected `release/<version>` head; candidate files are read as data and no candidate script executes.
- Fresh authenticated-store baseline metadata and consistent package, Android and iOS versions/builds using the existing release-version validator.
- A current writer-authorized release-owner (`antuz123`) approval comment binding driver SHA, candidate SHA, version/build, specific operation and artifact digest (or `pending` for build preparation), expiring within24hours. An approval for one operation cannot authorize another.
- The matching protected release environment already configured with independent reviewers, prevented self review, no administrative bypass, and protected-branch restriction. An absent/unreadable environment blocks before the environment job; no implicit unprotected environment is created by a successful path.
- Exact-head `Tests`, `CodeQL` and `keeper/local-validation` success, with no failed/skipped/in-progress/wrong-SHA check, and complete bounded check evidence. These fixed required names need confirmation against the final installed acceptance route; an unmatched name fails closed.

**Security correction: authorization planning is disabled fail-closed until trusted CI origin is implemented and verified.** A check/status name or bot/app creator alone does not prove the installed workflow ran; same-repository PR workflows may produce misleading status names. The collector currently cannot mint the module-private verified-origin capability, so even otherwise complete synthetic or name-matching evidence cannot produce an authorization plan. No plan or release operation is claimed verified. A separately reviewed exact-canonical/selected-route attestation must bind genuine workflow/run/attempt/source evidence before this boundary can be enabled. Existing failed/security/native checks remain intact; no PR pass transfers to a merge SHA.

The final protected job records the preparation boundary only. Its result always reports `execution_allowed: false`, `release_worker_implemented: false` and `artifact_bytes_and_signature_verified: false`. The artifact approval digest is bound to the request; this preparation package does not download/verify actual release bytes or signatures. Environment selection and shape-valid metadata alone never produce a release pass.

**Future execution workers must revalidate after the protected environment approval**, immediately before any signing or upload: refresh driver/source ref identity, exact-head check and review state, approval author/scope/expiry, fresh store/version baseline, and the actual immutable artifact bytes/digest/signature/provenance. A source movement, new failure, expired/revoked approval or artifact mismatch while waiting blocks execution. The earlier preparation result cannot serve as final execution authorization, and a successful environment review cannot bypass this fresh validation. Artifact verification must use trusted driver code and must not run artifact-provided code.

The owner approval receipt has this exact form (use actual reviewed identities; no receipt is created or requested by this package):

```text
## Keeper protected release approval
State: APPROVED
Source commit: <full SHA>
Version: <marketing version>
Build: <platform build counter>
Operation: <ios-signed-build|android-signed-build|testflight-upload|play-internal-upload>
Artifact SHA256: <64-character digest, or pending for signed-build preparation>
Workflow commit: <current protected sprint driver SHA>
Expires at: <UTC timestamp YYYY-MM-DDTHH:MM:SSZ>
```

This template is not owner approval. Do not post it on the owner's behalf. Tests use synthetic receipts and perform no remote action. Run the offline contracts with `node --test scripts/protected-release-plan.test.cjs`.

## Remaining execution worker implementation

Implement the actual Phase B signing/artifact/distribution workers in a further separate PR, estimated 5k–10k changed code/test tokens plus platform integration fixes. Trim/split if it approaches 20k or adds another substantial capability. Native acceptance belongs to Phase A. No workflow that can reach signing or stores is installed by this preparation package.

1. A reusable manual release driver, installed on reviewed trusted source, accepts an immutable full source SHA, the approved operation/channel, version/build tuple, and exact evidence/artifact identities. Its initial job has read-only repository permissions and no signing/store secrets. Resolve and compare the source against the reviewed candidate; reject PR merge refs, mutable refs, wrong repositories, stale head/evidence, missing required tests/security/review, and changed inputs. Verify that the workflow driver itself is the installed trusted revision. Do not accept a PR-authored JSON assertion as trusted CI evidence.
2. Build/test with development/disposable configuration first on hosted macOS/Xcode and Linux Android runners, one native build at a time. Retain source/tree/input identities, exact test run/attempt, platform/tool versions and artifact hashes. Rerun candidate acceptance when source changes. An infrastructure smoke cannot satisfy R5 feature acceptance.
3. Proposed environments `keeper-release-ios` and `keeper-release-android` restrict deployment source to explicitly reviewed release refs, require an independent named approver, prevent self approval and review administrative bypass policy. Configure least-privileged secrets only after a credential custodian and owner approve provisioning. Test rejection of wrong source and absent approval without secrets before testing signing. Environment creation or selection alone does not establish enforcement.
4. Sign only after owner approval naming source, version/build, platform and operation. Prefer separate short-lived signing workers with narrowly scoped credentials and transient keychain/keystore storage. Do not run unreviewed PR/dependency scripts with production secrets. Current `build_only` lanes need adaptation and actual hosted verification; iOS automatic certificate/profile acquisition must not create or rotate material implicitly. Preserve Android upload-key and signing-certificate continuity. Do not regenerate keys.
5. Verify signed artifacts before any upload: source/build manifest, application ID, version/build, SHA256, iOS signing team/profile/entitlements and Android certificate/signature/16KB evidence. Retain provenance and safe receipts. Secret files, recovery data and unredacted native logs must never enter public artifacts or caches. Clean transient signing material as part of the same job, including failure paths, without deleting unrelated caches or owner artifacts.
6. Upload the verified immutable artifact only after a separate approval for TestFlight or Play internal. An upload worker uses least-privileged channel-specific credentials and the approved artifact digest; it never rebuilds from a moving branch. Compare the returned store-selected version/build/artifact receipt. No production rollout, review submission or public release follows automatically. Each remains a separate explicitly approved operation.

This is a concrete proposed boundary, not proven remote signing capability. Required native/security failures remain blocking; physical-device results must come from actual testers/devices tied to the distributed artifact. No personal Mac session is needed for build, certificate custody service, store API or tester installation in this route.

## One-time setup and custody inventory

All entries below need a named maintainer/custodian and evidence of actual readiness. Do not place values in PRs, task sheets, job inputs or this document.

| Capability | Required input/setup | Observed state / next action |
| --- | --- | --- |
| Trusted release source/driver | Approved release ref policy, protected environments, independent approval, exact-SHA evidence/check enforcement | Dedicated environments absent at read; authorization workflow is a candidate, uninstalled/unrun; execution workers unimplemented. Review/approve separate worker PR and administrative rules. No shared-branch promotion authorized. |
| Apple signing | Existing authorized signing certificate/private-key custody, matching profile and team/entitlements; approve hosted secret/signing-service scope | UNKNOWN. Existing Fastlane acquisition is not proof of authorized custody. Provision through authorized custodian; do not copy a personal keychain or create a new certificate by default. |
| Apple upload | App Store Connect identity/API key with app/channel privileges, existing app identity and agreements | UNKNOWN. API upload authorization is distinct from code signing. Inventory and test via approved operation; no interactive owner-Mac dependency. |
| Android signing | Existing upload keystore/service and alias, `STORE_PASSWORD`, `KEY_PASSWORD`, `KEEPER_ANDROID_KEYSTORE`; verify expected certificate fingerprint | UNKNOWN. Current code consumes these names; existence/current validity is unverified. Preserve existing-user update continuity. Play App Signing key is distinct from upload key. |
| Play internal upload | Existing app/package, least-privileged approved service account, selected internal track/testers, current store counters | UNKNOWN. Existing Appfile refers to a JSON file; no file contents inspected. Move custody into reviewed protected storage only with authorization. |
| Production app configuration | Reviewed exact allowlist of client-safe fields, production service identities/channel and successful version/config guards | UNKNOWN for R5 signed candidate. `react-native-config` embeds supplied fields: never place server/signing/upload secrets there. Preserve the existing retired-credential rejection. |
| Artifact retention/provenance | Approved safe retention, authenticated checksums/signature receipts and trusted artifact transport | Source helpers exist; full signed hosted chain NOT VERIFIED. Do not transfer a pass between SHAs. |
| Physical acceptance | Named trusted testers, actual supported phones/signers, firmware/artifact identity and results | NOT RUN by this package. Emulator biometric simulation cannot establish physical biometrics/NFC/USB/camera/signers. |
| Independent and Claude review | Applicable approved review route, authorized capacity, exact-source report and finding resolution | Required; execution/approval NOT VERIFIED. No paid usage requested. Preserve inherited security findings and failed checks. |

Before signing, refresh authenticated complete Apple/Play uploaded-build baselines using the existing release-version tooling; do not infer the next counters from current source. Preserve approval and channel receipts separately from native acceptance. No merge, signing, upload, distribution, deployment or publication was performed in this package.

## PHP security research and exposure assessment

The DigitalOcean bulletin itself has not been provided/located; its date alone cannot identify a vulnerability or Keeper exposure. Independent official upstream research did identify two current critical PHP advisories published 21 October 2026:

- [CVE-2026-109618 / GHSA-w8hw-w9fx-j79w](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w), “RCE via OOM corruption”.
- [CVE-2026-109619 / GHSA-6wmf-4rv5-p3rp](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp), “RCE via stale global state”.

Both official advisories list patched branch versions **8.2.35, 8.3.36, 8.4.27, 8.5.12**. The [official 8.5.12 release](https://github.com/php/php-src/releases/tag/php-8.5.12) describes unauthenticated RCE, no complete mitigation and strongly encourages affected PHP8.5 users to update. [Tagged NEWS](https://github.com/php/php-src/blob/php-8.5.12/NEWS) records both fixes; [8.2.35 NEWS](https://github.com/php/php-src/blob/php-8.2.35/NEWS) confirms the backport. This identifies relevant upstream research, **not the missing bulletin's exact contents or an impact determination**.

Read-only complete Git tree and dependency-manifest inspection found:

| Public source audited | Exact source | PHP/Composer evidence |
| --- | --- | --- |
| R5 app | `c1c4b803039b61b940373c4dc9d08473cf25e042` | 0 tracked PHP files, 0 Composer manifests; React Native/JS/TS source. No PHP-named direct dependency. |
| Website | `ddba13bd289e8899b16a6f653cf5c1ea66be6243` | Complete tree193 files; 0 PHP/Composer; React/Vite/Express package manifest. |
| Public SigningServer | `130d74b5336c40901933d4882db745f0cca811f1` | Complete tree62 files; 0 PHP/Composer; Express/TypeScript package manifest. |
| Public Relay | `1a6b9ff19c82633a15939ff4e74ccd47d535e534` | Complete tree87 files; 0 PHP/Composer; Node22/Express/TypeScript package manifest. |

Authorized private-service source was also inspected read-only; no PHP/Composer source was observed there. Private paths/source details remain outside this public document. A source tree does not inventory deployed hosts, OS packages, reverse proxies, images, control panels, unrelated WordPress/PHP endpoints or provider-managed runtime. **Keeper exposure remains NOT ESTABLISHED; deployed runtime inventory is UNKNOWN.** No live probing, production account operation, exploit test or configuration change was performed.

Next research step: use existing authorized read-only operator inventory to map relevant deployed assets/images and any installed PHP versions/SAPIs to these advisories; obtain the actual bulletin for correlation. Communicate the evidence and uncertainties to the owner privately. Do not infer “not affected” from JavaScript manifests. R5 owns research/exposure investigation and owner communication only; any resulting PHP remediation and verification is assigned to R6 by the latest scope decision. Confirmed urgent exposure must be brought to the owner promptly without silently implementing or publishing a change.
