# R5 delivery continuation

This ledger records bounded implementation packages. Exact current source SHA,
workflow run/attempt and actual results belong in [integration #7068](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7068)
and the separate execution records [#7082](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7082)
and [#7107](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7107).
Never transfer a package's checks to the combined candidate. No merge, shared
promotion, release signing, upload, distribution, deployment or publication is
authorized by this document. Native development acceptance uses Cloud, with no
personal Mac dependency.

The supplied R4 source1d8a86a7462d935cbd0e28b857934b5718c152fc is already an
ancestor; no further R4 confirmation is awaited. This source fact is separate
from store/publication and device evidence in other workstreams. Core and5.1
are incorporated. **5.2 remains owner-reported running, unidentified, untouched
and unintegrated.5.1 and5.2 have not been tested together. No candidate freeze.**
The approved read-only assessor's source is also unavailable; its supplied patch
SHA256 is not a Git commit. Preserve both source dependencies without guessing.

## Included app and acceptance packages

Completed implementation means the bounded source/check deliverable; native
acceptance remains remaining unless an exact-source receipt says it ran.

| Package | Branch / draft / exact checkpoint | State / actual checks / next action |
| --- | --- | --- |
| Core deletion/startup/scoped copy | codex/r5-key-deletion-startup #7058,77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238 | REMAINING native acceptance; source included. Earlier exact3eb combined565Jest/502recoveryPASS. |
| 5.1 backup/history | codex/7066-protected-backup-correction #7067,c1c4b803039b61b940373c4dc9d08473cf25e042 | REMAINING combined native acceptance; both protected-backup and Version History corrections included. |
| Biometric callback | codex/r5-biometric-callback-guard #7069,257fbe17e1a85d0e5d7e5d8ab97e1a69edbd9628 +14a2459b30e31ea3099d56f6c6928a4a3b7d6995 | COMPLETED source/review,17component controlsPASS; actual biometricsNOTRUN. |
| Infrastructure reconciliation | codex/r5-cloud-native-reconcile #7070,17baf3bff3a5cd96787218b9e8e1fee75f549967 | REMAINING live/installed acceptance; preserves7060/7063/7062 package reviews and R4 guards. |
| Native worker/storage witness | codex/r5-native-feature-probe #7071,486810052f90550d55dd6ddd541ff53ebd875caa | COMPLETED source; exact3eb Android attempt2 actual Realm/MMKV persistence and all5 production-worker casesPASS. Combined-source/native UI/crypto/backend acceptance remains. |
| Product measurements/Retry | codex/r5-native-product-measurements #7073,040955d0caca38bb3cb386ca2918adf60f0f30db | REMAINING five raw observations plus separate real socket-disconnect/Retry; development timing includes warm Metro/driver overhead. |
| Unused key/PIN UI | codex/r5-native-key-ui-acceptance #7079,5c4c211339aeee3216faa0663c309314a1627123 | COMPLETED implementation/host controls; native cancel/wrong PIN/delete/relaunchNOTRUN. |
| Installed-byte comparisons | codex/r5-installed-byte-acceptance #7083,56b91ba87da8e979cb3d72cadf25828b59bce61a | REMAINING combined execution;8independent controlsPASS. Exact3eb Android before-smoke pulled-APK comparisonPASS; this supplies no iOS/feature pass. |
| Credential errors | codex/r5-native-credential-acceptance #7088,dd5fca6707308e3d2a1e3fe664c7fa424455b258 | COMPLETED implementation/review,112Node/99PythonPASS. Controlled malformed native JSON, not OS denial; nativeNOTRUN. |
| Stale/empty Version History | codex/r5-native-version-history-ui #7093,b8abebb2001ac506eafb560d4ac8980eee8a6858 | COMPLETED implementation/review,115Node/98PythonPASS; controlled histories/actual Realm/exact restore, not authentic historic migration. NativeNOTRUN. |
| Genuine Vault reference UI | codex/r5-native-vault-reference-ui #7097,b6cb88c0b78e97988ead30f2e40ee4d8e6ef9341 | COMPLETED implementation/review,8host/67componentPASS, TS/lint0delta; visible/hidden/archive/reinstate nativeNOTRUN. |
| Companion orchestration | codex/r5-native-feature-orchestration-20261022 #7102,196bfeded03705315871eb5c8d1b693540110581 | COMPLETED source/review,124Node/125Python/actionlintPASS; root9+3controlsPASS. Producer ancestry preserved, primary failures/cleanup hardened, new native execution remaining. |
| Retry artifacts | codex/r5-native-attempt-artifacts #7100,461d3119dae6e717ab700ada2e4caaae2fcd257f | COMPLETED source/review,106Node/93PythonPASS; run+attempt names preserve prior evidence without overwrite. |
| Android startup diagnosis | codex/r5-android-startup-diagnostics #7101,87d21fa34ee7d55e2b49c91ccb83bc9a1c1346c7 | COMPLETED source/review,105Python/4policy controlsPASS. Actual collectionNOTRUN; unavailable factsUNKNOWN, causeUNDETERMINED. |
| Bounded iOS installation | codex/r5-ios-install-allowance #7104,70cfbfa3a5d58fb324420fdf87d90850e5b28b14 | COMPLETED historical preparation;126Python/108Node/actionlintPASS, root14controlsPASS. Unverified300s allowance retains ancestry/history; selected #7107 instead keeps120s plus a separate readiness precondition. No installation fix credit. |
| Witness fee sizing | codex/r5-witness-fee-fix-20261022 #7098,514d2d656da17336312fef98989c01c2113ef9f1 | COMPLETED narrow fix/review;223actual-production-body testsPASS, immutable baseline78policies/927witnesses/120APIcasesPASS. Exact combined security/native fee checks remain. |
| Exact-event CI source | codex/r5-ci-exact-head-source #7108,24674bd107c5ed8d55fa206911eaa7586c741c31 | COMPLETED source/review,154Node/actionlintPASS; root independent24controlsPASS. Explicit event SHA and clean tracked/nonignored source verified before/after setup and checks; only exact existing paired Relay checkout admitted. Hosted39843976625 Tests/source guardsPASS; inherited automatic matrixFAIL. Actual counts are recorded on #7108. |
| Public companion receipts | codex/r5-public-companion-evidence #7109,2af7be96178fa12bbde0c9a7f7a651813fc9fa9b | COMPLETED source/review;649Node/179Python/actionlintPASS, independent515scoped controlsPASS. Strict installed-byte, six credential/twelve history/eleven Vault stages and ordinary Metro restore yield only three scoped subchecks after successful predecessors. Five parent obligations stay NOT_IMPLEMENTED; authorizationfalse. |
| Selected next native source | codex/r5-native-acceptance-20261022 #7107,23f14e01f3437c213f1443c3167d96022f3a43bc | RUNNING sole hosted window39846002094, iOS then Android. Independently151Node/213Python/actionlintPASS. Ports readiness/install diagnosis preserving cleanup and companions, keeps120s install; fixed host PIN acknowledgements and failure-only Android facts change no UI action/wait/counter. No parallel execution or source push during this window. |

The orchestration and canonical platform workers have the same240minute global
ceiling on standard hosted runners, one build/device per platform. The new
100–150minute planning range is unmeasured; nested maxima can exceed the global
ceiling, which remains fail-closed. No larger runner or paid activation is used.
Physical-device and signer results require actual authorized devices/testers.

## Protected preparation and non-app work

| Package | Branch / draft / exact checkpoint | State / actual checks / next action |
| --- | --- | --- |
| Inventory, PHP research, unsent copy | codex/r5-cloud-release-readiness #7072,f2fc0cb557f0e5303335dadc9e98152640795e6c | COMPLETED preparation/research; deployed PHP exposureUNKNOWN, remediesR6, communicationunsent. |
| Fail-closed origin guard | codex/r5-release-origin-guard #7074,76150f455978c1a565f2c670774672bc18789877 | COMPLETED source fix,21controlsPASS; authorization deliberately disabled. |
| Worker core | codex/r5-protected-release-workers #7076,e195de31ffc38ec54fcee9c43f74e610139d3844 | COMPLETED preparation,67Node/24PythonPASS; signing/provider acceptanceNOTVERIFIED. |
| Frozen Ruby inputs | codex/r5-cloud-ruby-locks #7078,1241256d465d25f2ea2bb4c4e75fccb608ff276e | COMPLETED preparation; frozen118-gem install/load/project parse and Ruby21runs117assertionsPASS at its own checkpoint. |
| Protected orchestration | codex/r5-protected-release-orchestration #7080,c1e0e6df99eb762d62e31e9d71afa2cb97958bc5 | COMPLETED inert preparation/review,67Node/24Python/Ruby3runs16assertionsPASS; no dispatch/sign/upload. |
| Upload-only behavior | codex/r5-protected-upload-purity #7086,36df64be4ccafc287c0ac07fb911d7e3a1c4711c | COMPLETED source fix/review; actual pinned Fastlane fake-boundary8runs40assertionsPASS; no provider call. |
| Frozen preparation alignment | codex/r5-cloud-release-reconciliation #7096,945a0ee3c6af68eed70e412f948dcaab2f876150 | COMPLETED source/review;67Node/25Python/input alignment/actionlintPASS. Ruby inputs pair7078 with exact3eb Pod/Nitro inputs. |
| Canonical native producer | codex/r5-canonical-native-attestation #7084,29a73faaf4312f3536db9aad1d5b6795042aef7d | REMAINING installed/live verification;114Node/82PythonPASS. Incomplete parent obligations emit blocked readiness only. |
| Dedicated live-pin reader | codex/r5-canonical-pin-read-identity #7095,effd9175c00ebbdbaf616813a3ecfa6886bbbf45 | COMPLETED source/review,119Node/82PythonPASS; credential unprovisioned/liveNOTRUN, prior integration403 preserved. |
| Origin consumer | codex/r5-trusted-origin-consumer #7085,a1e167cab4e8485bb84418cadfb2313cbcedb644 | COMPLETED read-only source;89consumer+B1/100NodePASS. Not imported into B1, authorizationfalse. |
| Consumer byte proofs | codex/r5-trusted-installed-byte-proof #7087,546d77261d02c0633e45b2c62df8f8e5580620c0 | COMPLETED source/review,182consumer/203combinedPASS; retained as7099mergeancestor, no duplicate patch. |
| Official analysis provenance | codex/r5-codeql-run-provenance #7099,bd8ad7fc41b41b19a9d83a32b4e816a1e7abd51f | COMPLETED bounded source/review,268NodePASS; official upload/run linkage stronger, GAS-check-to-analysis joinUNVERIFIED and API403 retained. Authorization remainsfalse. |

These capabilities are prepared source, not installed or verified release
operations. Read-only environment inventory18:23:58UTC showed onlycopilot,Env,
keeper-claude-review; both release environments absent. Credential custody is
UNKNOWN after403, not asserted absent. Installation/pins/protection/API identity,
conditional review, artifact audience, binary config/provider readback and
actual cleanup/signing/upload acceptance remain separately bounded setup and
operation requirements. No production account operation is permitted here.

## Running, blocked and later packages

| Package | Checkpoint | State / next action |
| --- | --- | --- |
| Previous paired backend | Private Relay #160,control296b2880f1e62f320665fb44d69288b72859fb0c; app3eb92fc8a622a3e09926d49f47243c163e32d009 +Relay29597b27eeeb299205bf7d0555db0a90c38cc4be | COMPLETED exact host witness43+1+3PASS/run39825255620. Preserved source-specific history; not native acceptance/deployment. |
| Exact8cf paired backend | Private Relay #168,codex/r5-combined-protected-pair-20261022,0f09f0137245907d52b0fa0a39c5b4ceb09d9ba6; app8cf8053069e13f1efea7d0a6f5a39b6011c0d293 +Relay29597b27eeeb299205bf7d0555db0a90c38cc4be | COMPLETED actual hosted43protected+1upgrade+3guardsPASS/run39839996160, genuine Realm/frozen inputs/three source checks/owned Mongo cleanup. No pass transferred to newer candidate. |
| Exact8cf genuine recovery | Private Relay #170,codex/r5-exact-head-recovery-proof-20261022,22108d89fa76fc2d4328c10fde9f876e5468da17 | COMPLETED502recovery+43protected+1upgrade+3guardsPASS in both original push runs39842461445 and39842469359; four exact8cf source checks/actual Realm/frozen inputs/owned cleanupPASS. Duplicate server-created runs serialized naturally, neither canceled. General inherited Build lint failure retained. New candidate requires new pinned run. |
| Private genuine native fixture | Relay #164,a5b85102c91d9b9362fcd6c0953d8a5827616903 | COMPLETED source/local4characterizationsPASS; real service/router/crypto/Mongo, provider traps. |
| Private native backup UI | Relay #165,fb021d101eac34855aff1bb440d6a1bc84e50b6a | COMPLETED source/11host controlsPASS; unarmed nativeNOTRUN, original checkpoint retained. |
| Private teardown follow-up | Relay #167,35860ea95202d071b585c9793215d5dbffdea3f4 | COMPLETED bounded fix/18Python2NodePASS; root independent18controlsPASS. Execution-fork setup remaining, no native marker. |
| Fresh restore fixture | Relay #166,codex/r5-native-recovery-20261022,f15a0825e82b3ec0775cac5286e6da9e2c191579 | COMPLETED bounded source/6current-protocol/crypto/source/admission controlsPASS; known-public vector, provider-free current v3. Build workflow correctlySKIPPED; no native execution. |
| Recovery receipt admission | Private Relay #169,codex/r5-native-recovery-admission-20261022,2b4b38ab59fb83af91f90f8ed2e387670a87a849 | COMPLETED bounded source,7Node+5receipt/lifecycle+13cleanup controlsPASS at exact8cf; original source-guard failure retained. Rejects forged/stale owner/nonzero backend exit. Only explicit3eb/8cf source admitted; newer candidate needs a separately reviewed finite retarget. NativeNOTRUN. |
| Normal fresh restore UI | Private Relay #171,codex/r5-native-recovery-ui-20261022,265e9d5c3e0145af5da94c5e28ed2db9d70fc712 | COMPLETED source/review,11Node+12Python+13cleanupPASS; real protocol/crypto/owned service disposal. Normal Restore writes genuine Realm, checks public-vector identity/counts/consent/history/coldPIN. Source16.2k; native unarmed/NOTRUN, authentic historical migration not claimed. |
| Account-isolation fixture | Private Relay #173,codex/r5-native-account-fixture-20261022,6cecfaa3c7db29cd2b131ab6c523a90f313e6c24 | COMPLETED corrected source/review,11genuine-host controlsPASS including arm-time slow-body boundary and held-abort poisoning. Earliera438 source/results preserved. Durable distinct A/B namespaces and signed snapshots, no production accounts. Source~10k; nativeNOTRUN. |
| Normal account-switch UI | codex/r5-native-account-switch-20261022, base6cecfaa3c7db29cd2b131ab6c523a90f313e6c24; producer checkpoint pending | RUNNING separate12–15k package; generated B stays on-device, cold normal A→B→A/PIN/history/consent isolation. No execution marker or native credit; preserve active producer. |
| Hosted driver/runtime diagnosis | codex/r5-hosted-readiness-20261022 #7094,c79ab7c22a3a371a7bb7e3b66b788b000a64cc62; cleanup #7103,50a0e3e7c1acbc8417001a6bbd1c691f7b2c08e8 | COMPLETED source/setup observation. Corrected setup39841528773: actual listappsTIMEOUT→SUCCESS11.072s, unchanged driverPASS101.9s, both Keeper app jobsSKIPPED.108Node139PythonPASS. Initialffb setupFAIL preserved; no SDK/daemon cause proven. Full ancestry retained while selected17bf/23f orchestration supersedes per-sample simulator lifecycle. |
| Queue/bootstrap caller ports | codex/r4-public-ci-v3-ports-20261022 #7091,b572b28c9cec09e47e1b9cb3b62a51369dd74c51 | COMPLETED32genuine current-protocol casesPASS/run39833492710; originalb9dc31PASS/1FAIL preserved. Included by #7105 ancestry without duplicate patches; original295-case matrix unchanged. |
| Label caller ports | codex/r5-protected-label-callers-20261022 #7105,6cf2ab15bb2bee4ab84c88decbfb6e88d609bcb0; private Relay #172,1db92881f9fb94c66bc1d24b181d9fdb603de07e | COMPLETED9genuine host casesPASS/run39843462322, app6cf/Relay29597,13guards/source/frozen inputs/owned cleanupPASS; no native/rendered UI credit. Separate~6k package included. |
| Wallet/Vault caller ports | codex/r5-protected-wallet-vault-callers-20261022 #7106,83609f374b28b497850e1a68fe0ec9d7b2925937; private Relay #174,9c45b392ba105be570c8ceab5e44d3375d4871cf | COMPLETED11genuine host casesPASS/run39845023112, app836/Relay29597,15guards/three source checks/frozen inputs/actual Realm/owned cleanupPASS. Separate7–11k package included. Original retired matrix unchanged; neither package supplies combined/native acceptance. |
| 5.2 | Actual task/branch/PR/handoff unavailable | RUNNING per owner; locate authoritative completed checkpoint, inspect overlaps, integrate verified commits and rerun affected checks before freeze. |
| Read-only assessor | task01a15e9e-3c9a-7518-8adc-2fe5eee410f4; supplied patchSHA2567f7ffc52c1aafa39448e2a1d6e7205c6a2b4c98606eb3a23b830bfe413a2c50f | BLOCKED source handoff; full key/origin/script/intent binding and native isolation remain. Never guessed to be5.2. |
| Navigation7055/timezone6991 | Existing bounded investigations | REMAINING native reproduction/QA; fourTZ72assertions+18historical controls, no confirmed narrow fix. Preserve scoped PIN/Emergency/backup copy. |
| Review/physical/release evidence | Conditional7034 route, exact source/artifact | REMAINING; independent source reviews recorded, applicable Claude route uninstalled/unverified/no paid activation, real devices/testers required for physical credit. |
| Excluded/later | Prior agreed boundaries | EXPLICITLY DEFERRED: legacy all-copy purge, parked7056secondPOST, storage/passcode redesign, ReceiveQR R07, broad terminology/componentsR08, scaling/AskreplySoon, separate AssistedMultisig. PHP remediesR6. |

## Evidence retained and remaining deltas

The completed3eb window is preserved independently of next-source work. Attempt1
iOS driverFAIL/appNOTRUN; Android build/install/actual installed APKPASS but
startupFAIL, product/worker/Retry/key UI/five measurementsNOTRUN. Attempt2passed
the unchanged driver and development build, then failed during app installation:
simctl install reached120seconds (exit124, observed120.4s), before Maestro/UI or
installed-byte comparison. Its iOS artifact12452576904 ZIP SHA256 is
eb78af70712620e31478d239931f804e21cdad11fc8655f398023d77f87cfc3a.
The dependent Android continuation finished naturally as job120035062245:
build/startup/Realm-MMKV persistence/all5 worker cases/installed APK bytesPASS,
but product sample1FAIL during PIN/onboarding, before wallet_start or account
creation. Its only product duration is startup_to_passcode_ms20111.336;
create_new_app_calls0, no first-wallet measurement, no five product pairs.
Retry/key/credential/history/Vault companionsNOTRUN. Worker measurements are
controlled probes, not product samples. Android artifact12453239850 ZIP SHA256
e1e3330538fe266ff29b3bbe278907dc5e914b56f13f3e3d3df57fc9441c9048;
APK926daa77e540b063832438962a76912854b16a1998534dcebd5618151b7bb2fe.
No safe failed-step/JUnit was retained; the specific action/cause is unknown.
Every outcome belongs only to3eb and its actual run/attempt. The next sole
window39846002094 runs immutable23f14 on #7107, never the integration's later SHA.

Old public protocol matrix2PASS/293FAIL, original CodeQL High, whole TypeScript
943errors and ESLint4450errors/882warnings remain recorded. Exact3eb individually
normalized static comparison had0added/0removed diagnostics. Scoped7098CodeQL
PASS is not fullR5clearance. An independent exact3eb local scan completed all89
default queries (888/888JS/TS and13/13Actions files), finding two inherited High
results; the first2048MB analysis attempt failed with OOM and the bounded4096MB
retry completed. Exact8cf independent comparison completed all89queries,
930/930JS-TS and19/19Actions files, retaining one inherited High with identical
SARIF fingerprint/source blob and zero new alerts. Private SARIF/evidence remain
under SECURITY.md. Independent synthetic review confirmed the remaining issue
is actionable; its separately documented versioned credential/storage migration
is8–15k and excluded/later unless explicitly reassigned. No waiver or clearance.
New combined checks must report
their own findings and source, including inherited failures and environment
blockers. Never suppress or relabel them as native success.

Exact8cf local source checks passed50Jest suites/788tests,148nativeNode,
179Python,303preparationNode/25Python, frozen Ruby checks and32runs175assertions.
Local recovery originally492PASS/one Realm prerequisite environmentFAIL; this
failure stays recorded. Genuine private exact8cf host runs above subsequently
passed all502recovery cases. Standard public8cf CI used a different synthetic
mergeSHA despite the same tree, so its passes are not exact8cf evidence. #7108
corrects that checkout policy for future runs. Whole8cf TypeScript943FAIL and
ESLint4450errors/885raw warningsFAIL; tracked-source normalization against3eb
has zero added/removed diagnostics,882tracked warnings plus3generated warnings.

Core+5.1 already approximate35k changed code/test tokens. Major adopted
infrastructure retains its original reviews. New credential8–10k/history9.7k/
Vault8.3k/orchestration11–13k/Android diagnostics6.5k and private fixture9k/UI13–16k
are separate packages. Remaining source deltas include bounded recovery/account
packages above, bounded private execution admission/retargeting and remaining
parent-receipt/trust integration after real native observations. Candidate-source
retargeting is required after5.2. Unknown5.2/assessor scope cannot be
estimated honestly before their authoritative handoffs. Continue unrelated Cloud
work while those dependencies remain unresolved.
