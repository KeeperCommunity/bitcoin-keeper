# R4 / 2.6.4 automatic backup: Codex Local handoff

**Current protected-v3 continuation:** follow [the protected-backup app handoff](r4-protected-backup-app.md) and the newest exact-SHA PR comment. Its guarded private backend7693/loopback27038 setup supersedes the public-v2 commands below for the current app. The historical public838 results remain preserved; they do not validate v3. Do not run this document’s old v2 setup as current protected-backup acceptance.

State: **NEEDS_LOCAL**. PR [#7045](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045), branch `codex/r4-264-combined-candidate`, base `sprint`. The exact final SHA is recorded in the newest **Codex local handoff** on that PR. The setup below verifies that handoff against the live head before selecting it; this repository document cannot contain its own eventual commit SHA.

**Node-bootstrap continuation:** follow the [managed producer and original-order Local retest](r4-node-bootstrap-backup.md). This supersedes the narrower queue-only retest below: use one new incremental artifact per platform and test initial Verified→ordinary detail bootstrap→automatic complete Verified→ordinary rename→complete readback/cold persistence. Preserve9a19 native controls and its original bootstrap failure separately; all remaining R4 gaps and restrictions stay open.

**Queue-admission continuation:** follow the [narrow fix and focused Local retest](r4-backup-queue-admission.md). The only changed app module is backup inspection queue admission; native/dependency/configuration inputs are unchanged from17e0. Use incremental builds and one focused ordinary-rename/native smoke retest on both platforms. Preserve17e0 failures and independent test results; do not repeat unrelated large matrices or infer a uniquely proved native cause. The prior full R4 gaps remain tracked, C8/#7056 stays parked, and any further failure must be reported without another speculative fix loop.

**15 October Android continuation:** read the [16 KB supplier proof and targeted retest](r4-android-16kb.md) and retain the [698078 Local failure](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6178691569). The new JNA selection requires a new development build and actual strict-16-KB launch; no native result transfers to this head. Android C8 / [#7056](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7056) remains owner-parked with its observed FAIL: do not restart that bug's fix/retest cycle. Other required native and release blockers remain open. Production AAB/generated-split construction, signing, upload and runtime verification are a separate owner-approved artifact stage.

Paired disposable Relay: **`838049e537e07eb646a2a0393eb969fba43d0739`**, draft [Relay #4](https://github.com/KeeperCommunity/Relay/pull/4). The originally requested `b600416e5ba7325927d7d2871cff7776f4e593fe` was tested: native Android opt-in reached a real repair write but failed complete readback because `createNewApp` had precreated an AppImage without subscription and repair wrote that field only on insert. The successor sets subscription on existing AppImages during explicit revisioned repair, after the transaction's revision and conflict checks. It is a loopback test dependency, not a deployed-service assertion. The approved contributor manifest in `dev/local-backend/sources.lock.json` remains Relay `ee935359f22ff7932ea0a62e9084d4b49801f4aa` and SigningServer `3cc7728c27328e7b0358d1f91a32d8d13feba90a`; do not replace those pins or overwrite generated contributor checkouts to prepare this test.

`AUTOMATIC_BACKUP_SOURCE_READY` is true after genuine disposable proof and independent fixture review. It permits development loopback validation with an explicit port. `AUTOMATIC_BACKUP_RELAY_ROLLOUT_READY` remains false until the separately authorized deployed fleet, transactions/indexes, v2 route and old-writer drainage are verified. The Node fixture permits its explicit loopback test target. Hosted writes remain fenced. Do not change either gate to make a test pass. Current source and results are recorded in [the proof matrix](../openspec/changes/fix-recovery-backup-freshness/automatic-write-validation.md).

The historical [Local report](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6128906958) at `b160656218dc6065ad12af9db220c974255bfc23` is **LOCAL_FAILED**. Its unsigned iOS simulator compile and Android development build passed; install, launch and UI scenarios were not run because the Mac was locked. Seven automatic writes remained disabled and opted-in deletions remained blocked. Its physical deferral and earlier native evidence do not validate a newer SHA. No current app native pass is claimed by this document.

The combined source also retains the bracketed iOS import and shared PIN keypad changes assembled at `bb66cea459fbb00ec33c5c4ebd601d07c0d7c125` from [#7051](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7051) and [#7052](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7052). Their contributor reports used local dependency-lock changes outside those PRs. Validate the final combined dependency set and native behavior again; Jest rendering does not prove Fabric keypad visibility.

## Copy into Codex Local

```text
Validate Keeper PR #7045 on the exact Head commit in its newest Codex local handoff.

For the Android 16 KB continuation, also follow release/r4-android-16kb.md.
Keep Android C8/#7056 parked; retain its observed FAIL without a fix/retest cycle.

Read the latest PR description, newest Codex local handoff, AGENTS.md and
release/r4-automatic-backup-local-handoff.md at the final head. Read the complete
automatic-write-validation.md matrix. Recheck the live PR head; if it differs,
report the mismatch and obtain the current handoff rather than testing stale code.

Preserve every existing checkout, installed owner app, wallet and database. Use
new isolated checkouts, simulator/emulator state and disposable test accounts.
Use paired public Relay 838049e537e07eb646a2a0393eb969fba43d0739 separately from
the approved contributor bootstrap. Do not edit its source or replace the
approved sources.lock.json pins. Save exact source identities and private logs.

Run the Node 22 genuine native-Realm/transactional-Relay runner and all seven
operations through C1-C10, complete producer/fanout and clean Recovery Key
restore cases. Missing native bindings, a skipped matrix or substituted mocks
are BLOCKED/FAIL, never PASS. Run relevant regression/release checks.

On the exact final app source, build unsigned iOS simulator and development
Android artifacts, then actually install, launch and exercise disposable UI
flows on BOTH platforms. Complete the critical backup/account/recovery matrix;
retain bracketed iOS BSMS/TXT import, keypad/cooldown, PIN/Proceed, Testnet
tutorial/faucet-to-visible-balance, modal, inheritance/timelock and profiling
checks below. Source-unit evidence does not replace native launch/UI results.

Required local checks: IOS, ANDROID, HARDWARE. Read #7050's integrated policy in
AGENTS.md. Only the release owner's new exact-SHA OWNER_DEFERRED_PHYSICAL comment
can defer unrun physical HARDWARE checks; old b160 decisions do not carry over.
IOS and ANDROID cannot be deferred. A known critical failure cannot be deferred.

Post a new exact-SHA Codex local validation report with actual pass/fail/not-run
outcomes, versions/artifact hashes, private-log locations and open blockers.
LOCAL_PASSED covers only the stated tested subset, never deferred devices.
Do not merge, deploy, modify production records/indexes, sign a release, upload
to stores, publish artifacts/releases, or use real funded MAINNET wallets. Keep R4 separate
from Reproducibility and Bitkey Wallet. Continue feasible checks if one prerequisite
is blocked, but do not waive a critical or required platform result.
```

## Safe exact-source setup

Select the existing Node **22** toolchain; use Yarn Classic **1.22.22**. Do not overwrite global tool configuration or existing Node/Realm installations. These commands create private temporary directories and fresh detached checkouts. Run them in Bash and retain the printed workspace path for follow-up. GitHub CLI must have read access; a missing or mismatched exact-head handoff fails before checkout.

```bash
set -euo pipefail
umask 077
keeper_app_sha=$(gh pr view 7045 --repo KeeperCommunity/bitcoin-keeper --json headRefOid |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["headRefOid"])')
keeper_handoff_sha=$(gh api --paginate --slurp \
  'repos/KeeperCommunity/bitcoin-keeper/issues/7045/comments?per_page=100' |
  python3 -c 'import json,re,sys; pages=json.load(sys.stdin); comments=[c for page in pages for c in page]; handoffs=[c["body"] for c in comments if c.get("body", "").startswith("## Codex local handoff")]; assert handoffs, "Missing Codex local handoff"; matches=re.findall(r"(?m)^Head commit:\s*([0-9a-f]{40})\s*$", handoffs[-1]); assert matches, "Missing handoff SHA"; print(matches[-1])')
test "$keeper_app_sha" = "$keeper_handoff_sha" || {
  printf 'Live PR head and newest Codex local handoff differ.\n' >&2
  exit 1
}
keeper_relay_sha=838049e537e07eb646a2a0393eb969fba43d0739
test "${#keeper_app_sha}" -eq 40
test "$(node -p 'process.versions.node.split(".")[0]')" = 22
keeper_qa_root=$(mktemp -d "${TMPDIR:-/tmp}/keeper-r4-local.XXXXXX")
keeper_app_dir="$keeper_qa_root/app"
keeper_relay_dir="$keeper_qa_root/relay"
keeper_evidence_dir="$keeper_qa_root/evidence"
mkdir -p "$keeper_evidence_dir"
printf 'Isolated R4 workspace: %s\n' "$keeper_qa_root"

git clone --filter=blob:none --no-checkout https://github.com/KeeperCommunity/bitcoin-keeper.git "$keeper_app_dir"
git -C "$keeper_app_dir" fetch origin refs/pull/7045/head
test "$(git -C "$keeper_app_dir" rev-parse FETCH_HEAD)" = "$keeper_app_sha"
git -C "$keeper_app_dir" checkout --detach "$keeper_app_sha"
git clone --filter=blob:none --no-checkout https://github.com/KeeperCommunity/Relay.git "$keeper_relay_dir"
git -C "$keeper_relay_dir" checkout --detach "$keeper_relay_sha"
git -C "$keeper_app_dir" diff --quiet HEAD
git -C "$keeper_relay_dir" diff --quiet HEAD

cd "$keeper_app_dir"
yarn install --frozen-lockfile --ignore-scripts
yarn patch-package
./node_modules/.bin/rn-nodeify --install buffer,events,process,stream,inherits,path,assert,crypto --hack --yarn
(cd node_modules/realm && ../.bin/prebuild-install --runtime napi --target 6)
(cd "$keeper_relay_dir" && yarn install --frozen-lockfile --non-interactive --ignore-scripts)
export REALM_DISABLE_ANALYTICS=1
export KEEPER_RELAY_FIXTURE_MODULE="$keeper_relay_dir/tests/support/automaticBackupHttpFixture.cjs"
export BACKUP_TEST_MONGO_URL=mongodb://127.0.0.1:27058
```

Confirm Docker uses the local Mac Docker Desktop/Colima engine. Port **27058** must be free; do not stop somebody else's service to claim it. The runner rejects a different port, credentials, non-loopback Mongo, an incorrect Relay SHA or tracked Relay changes. A native Realm write/read probe must really pass; do not substitute the Jest Realm mock.

```bash
docker info --format '{{.ServerVersion}}'
if lsof -nP -iTCP:27058 -sTCP:LISTEN; then
  printf 'Port 27058 is occupied; coordinate an isolated fixture first.\n' >&2
  exit 1
fi
keeper_mongo_name="keeper-r4-local-mongo-$$"
docker run --detach --rm --name "$keeper_mongo_name" \
  --publish 127.0.0.1:27058:27058 \
  mongo:7.0@sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca \
  mongod --replSet keeperQA --bind_ip_all --port 27058
keeper_mongo_ready=false
for keeper_attempt in $(seq 1 30); do
  if docker exec "$keeper_mongo_name" mongosh --port 27058 --quiet --eval \
    'try { rs.status(); } catch (e) { if (e.code !== 94) throw e; rs.initiate({_id:"keeperQA",members:[{_id:0,host:"127.0.0.1:27058"}]}); } quit(db.hello().isWritablePrimary ? 0 : 1)'; then
    keeper_mongo_ready=true
    break
  fi
  sleep 2
done
test "$keeper_mongo_ready" = true
npm run test:automatic-backup-genuine 2>&1 | tee "$keeper_evidence_dir/genuine-matrix.log"
KEEPER_APP_SOURCE="$keeper_app_dir" yarn --cwd "$keeper_relay_dir" test:automatic-http \
  2>&1 | tee "$keeper_evidence_dir/relay-http.log"
npm run test:recovery 2>&1 | tee "$keeper_evidence_dir/recovery.log"
npm test -- --runInBand 2>&1 | tee "$keeper_evidence_dir/jest.log"
npm run test:release 2>&1 | tee "$keeper_evidence_dir/release-rules.log"
npm run version:check 2>&1 | tee "$keeper_evidence_dir/version.log"
git diff --check
# Stop ONLY the disposable container created by this session when finished.
docker stop "$keeper_mongo_name"
```

Retain failures and counts even if a command stops the sequence; run independent feasible checks separately afterward. Do not report unexecuted later commands as passing. A repository-wide TypeScript failure must retain its actual diagnostics/status; historical inherited diagnostics are not a passing typecheck. The same genuine source runner and prerequisite steps are defined in `.github/workflows/test.yml` and `scripts/run-automatic-backup-genuine.cjs`. Verify their Relay pin agrees with this document before running. Keep private logs locally and publish only redacted categories, counts, hashes and source/run identities.

## Required operation and failure coverage

Use the complete [matrix](../openspec/changes/fix-recovery-backup-freshness/automatic-write-validation.md). Record a result and evidence for every operation: `updateAppImage`, `migrateXfps`, `deleteAppImageEntity`, `deleteVaults`, `updateVaultImage`, `modifyLabels`, and `deleteBackup`. Their production producers, native Realm commits, real AES, Redux/store guards, HTTP handlers and Mongo transactions must be exercised together. A transport-only unit fixture is supplemental.

| Case | Required result |
| --- | --- |
| C1 committed match | Local commit and original branded account/session/base/generation precede one intended v2 effect; ciphertext/IDs or deletion target match committed Realm. |
| C2 uncommitted/stale state | Failed/partial/raw/unmanaged commit, stale local state, wrong key, copied origin/receipt or missing proof sends nothing; local data survives. |
| C3 account session | A→B→A and closed/reopened Realm reject old work. Old A's aborted work leaves A pending and clears its stale baseline without changing B. |
| C4 remote conflicts | Remote-only records and immutable wallet/signer/vault key or policy conflicts survive; no automatic overwrite or removal. Fingerprint correction cannot change unrelated keys, script, policy or network. |
| C5 consent | No automatic write for an unconsented account. Explicit whole-backup opt-out is same-account and deliberate; a newer consent choice invalidates old deletion work. Consent changes only after acknowledged complete deletion. |
| C6 competing writer | A real peer transaction/409 stops the chain; no fresh revision is borrowed for old ciphertext. |
| C7 old/malformed protocol | 404, unavailable/partial references, wrong metadata, malformed JSON, false/missing `updated`/`preconditionApplied`, missing/invalid/unchanged `newRevision` stop with no legacy write fallback. |
| C8 timeout/lost acknowledgement | Real post-commit timeout/lost reply remains uncertain/pending; no replay or next prepared member. Matching readback alone does not acknowledge the interrupted operation. |
| C9 complete readback | Full decrypt/reference/metadata comparison at the same generation/session precedes verified. Wrong-key, incomplete or corrupted content cannot pass. A retained empty generation tombstone confirms deletion but never represents a verified backup. |
| C10 final commit race/restart | Inject a genuine local mutation just before final Redux commit: no false verified. Relaunch preserves committed data/pending state and does not replay prepared work. |

Include complete create/archive, multi-vault registration, label import/deletion and whole-upgrade producer batches. For each fanout, let the first real transaction commit and make the next fail, lose its reply or receive malformed acknowledgement; remaining prepared effects must not run. Verify genuine late-field rollback, local-first creation/edit/deletion without an original verified baseline, and final complete restore of BTC MAINNET/TESTNET wallets, existing USDT recovery metadata, keys, active/archived vaults, registrations, labels and nodes. New USDT/GasFree setup and transactional flows remain paused.

## Native local services without changing the approved manifest

Read [contributor setup](../dev/local-backend/README.md), [verification boundaries](../dev/local-backend/VERIFICATION.md) and the paired Relay README. Use unique Compose projects and only disposable data. The approved contributor bootstrap is useful for toolchain, onboarding and existing public services, but its `ee935359` Relay does not establish positive v2 automatic-write acceptance.

From the isolated app checkout, prepare its approved stack and `.env.local` normally. These examples use free default ports; check all ports and choose unused contributor ports/settings as documented before starting anything. Keep the same settings for every invocation.

```bash
cd "$keeper_app_dir"
export COMPOSE_PROJECT_NAME="keeper-r4-contributor-$$"
./dev/local-backend/dev doctor
./dev/local-backend/dev up
./dev/local-backend/dev env
./dev/local-backend/dev verify
./dev/local-backend/dev stop
# stop retains this project's named volumes. Never use down --volumes.
./dev/local-backend/dev prepare-signing
export SIGNING_SOURCE_DIR="$keeper_app_dir/dev/local-backend/.sources/signing"
keeper_pair_project="keeper-r4-paired-$$"
docker compose -p "$keeper_pair_project" \
  -f "$keeper_relay_dir/compose.local.yaml" \
  -f "$keeper_relay_dir/compose.local-with-signing.yaml" config --quiet
docker compose -p "$keeper_pair_project" \
  -f "$keeper_relay_dir/compose.local.yaml" \
  -f "$keeper_relay_dir/compose.local-with-signing.yaml" up --build -d --wait
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3003/health
```

The signing overlay requires Compose **2.24.4+**. Record paired Relay source/container identities and effective local endpoints; this separate stack supports actual onboarding/channel/read/v2 routes, rather than only the runner's ephemeral HTTP handlers. Use the approved local SigningServer adapter for its existing testnet capability; this does not authorize new Assisted Multisig work. Ensure `.env.local` matches the paired gateway ports before building. Do not print its contents, copy hosted configuration, modify approved source locks/adapters or point this fixture at a hosted backend. Stop only this paired project with the same files/project name and `down` without `--volumes` after testing; retain its disposable volumes for diagnosis.

## Required iOS and Android builds, launch and UI

Build sequentially to limit memory pressure. Record available disk/RAM, Node/Yarn/Ruby/Bundler/Xcode/SDK/JDK versions, simulator/emulator identifiers and exact source SHA. Use fresh QA device state through normal simulator/emulator creation, not by erasing an existing owner device. Run Metro from this checkout with `yarn start` in a separate terminal.

For iOS, select Ruby **3.3.0**, the root Gemfile and the actual available simulator UDID. Before building, inspect the shared `/tmp/envfile` selector without printing configuration: coordinate if it selects another build, and do not delete somebody else's selector. Use deployment CocoaPods installation; a lockfile/checksum mismatch is BLOCKED, not permission to rewrite locks.

```bash
cd "$keeper_app_dir"
bundle install
(cd ios && BUNDLE_GEMFILE="$keeper_app_dir/Gemfile" RCT_NEW_ARCH_ENABLED=1 bundle exec pod install --deployment)
xcrun simctl list devices available
keeper_ios_udid=YOUR_DISPOSABLE_SIMULATOR_UDID
ENVFILE=.env.local xcodebuild -workspace ios/hexa_keeper.xcworkspace \
  -scheme hexa_keeper_dev -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$keeper_ios_udid" \
  -derivedDataPath ios/build/r4-local -jobs 2 CODE_SIGNING_ALLOWED=NO build \
  2>&1 | tee "$keeper_evidence_dir/ios-build.log"
xcrun simctl boot "$keeper_ios_udid" # Skip if already booted.
xcrun simctl bootstatus "$keeper_ios_udid" -b
xcrun simctl install "$keeper_ios_udid" ios/build/r4-local/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app
xcrun simctl launch "$keeper_ios_udid" io.hexawallet.hexakeeper.dev
```

An unsigned compile is not functional entitlement evidence. The unsigned app may launch but Keychain can reject PIN storage with OSStatus -34018; a passcode screen alone does not establish onboarding or Realm persistence. Inspect the effective signed entitlements and actual PIN/Realm outcome. If signing or launch blocks this flow, record the exact action and error; use the contributor README's simulator-only Debug build with its normal local development signing if available without distribution credentials. A manually re-signed bundle may itself fail simulator launch policy. Record each artifact and which one actually launched. This is not production/release signing, and it does not turn an unsigned or nonfunctional launch into native acceptance.

For Android, select a disposable emulator serial and its architecture. Use JDK **17**, SDK **36**, build tools **35.0.0**, NDK **27.1.12297006** and CMake **3.22.1** as required by this source. The development artifact uses the checked-in disposable debug certificate, not a production signing key.

```bash
cd "$keeper_app_dir"
adb devices
keeper_android_serial=YOUR_DISPOSABLE_EMULATOR_SERIAL
keeper_android_arch=arm64-v8a # Use x86_64 for an x86_64 emulator.
./dev/local-backend/dev android-forward --serial "$keeper_android_serial"
ENVFILE=.env.local ./android/gradlew -p android app:assembleDevelopmentDebug \
  -PreactNativeArchitectures="$keeper_android_arch" --max-workers=2 --no-daemon \
  2>&1 | tee "$keeper_evidence_dir/android-build.log"
keeper_android_apk=android/app/build/outputs/apk/development/debug/app-development-debug.apk
shasum -a 256 "$keeper_android_apk"
adb -s "$keeper_android_serial" install -r "$keeper_android_apk"
adb -s "$keeper_android_serial" shell am start -W \
  -n io.hexawallet.keeper.development/io.hexawallet.keeper.MainActivityDefault
```

Verify actual app/package IDs, version/counters, APK signature/alignment and launched identities; do not guess them from filenames. The current provisional counters are 2.6.4 / Android 627 / iOS 620. Store-history refresh and signed production artifact reconciliation remain separate release work. The development Android package is `io.hexawallet.keeper.development`; verify website association files against the actual package/certificate, rather than assuming a `bitcoinkeeper.development` entry matches it.

On **both** platforms, record each scenario separately:

1. Fresh disposable onboarding, PIN create/unlock/cooldown, always-visible disabled Proceed/queued presentation and account setup. Cold launch/unlock without pressing a key must retain every keypad digit; disabled cooldown must reject input, retain all digits, expire normally and then accept input. Exercise PIN creation and another shared-keypad consumer without shortening cooldown in production code.
2. Opt in per account, create/edit/delete wallets, signers and vaults locally, archive and register them, edit/import/delete labels, change nodes and version-related recovery state, then relaunch. Check actual local persistence, pending/verified presentation, failure-stage/retry copy and complete native clean Recovery Key restore into a **different disposable Realm**, through the production restore worker. Never restore over the owner's existing app/database. After a verified backup, terminate and cold-launch the disposable app with the next snapshot delayed or unavailable. Open backup status immediately: saved verification and interrupted phases must be unverified/pending before a fresh complete read establishes current proof. Consent and committed local records must survive; no prepared ciphertext may replay. Repeat after a failed partial fanout and A→B→A: a historical phase must not display Verified after its session proof expires. With disposable native storage, cover canonical nested opt-out versus stale root opt-in in both read orders, hold the canonical read and check intermediate states, distinguish confirmed absence from read error, and restore an older root BHR record without nested persistence metadata. Then change consent/pending state and cold-launch again to prove subsequent writes persist. Record native MMKV persistence and actual process restart separately from host Redux-persist rehydration and source-expression tests.
   For the normal Manage Wallets Hide → Delete path, confirm an opted-in BTC wallet or vault Hide commits locally and receives its own revisioned mutation and complete readback before Delete is offered. While Hide is pending or its response is lost, the local hidden state remains, Delete stays unavailable and no stale deletion is sent. After verified Hide, PIN-confirmed Delete must remove the exact remote entity with another complete readback. Consent-off local deletion follows its separate no-write rule.
3. Repeat C1–C10 through feasible real UI paths with the paired v2 service: interruptions/large payloads, 409/old route/malformed/lost reply, local mutation during verification, A→B→A, consent change during deletion, missing/orphaned/legacy encrypted references and multi-write partial success. Confirm server-only records and immutable identities survive. A successful Delete Backup retains local data, acknowledges empty readback, clears only the intended consent and never displays a verified backup.
4. On iOS, import identical harmless bracketed/unbracketed TXT files and valid `[Test]_backup.bsms` / `Test_backup.bsms` from the same Files provider. Both BSMS files must reach identical configuration review; stop before duplicate creation. Test filenames with spaces/literal percent escapes and cancellation. Smoke Android's unchanged content-URI path on a native file picker.
5. Fresh-install Testnet tutorial → Receive Test Sats → visible wallet balance **without restarting**, including retry/slow response and displayed-account ownership. Local mode intentionally lacks a faucet/AI provider: a 503 or mocked unit result is not positive end-to-end evidence. Use an independently approved disposable Testnet-provider QA configuration when available; otherwise record the scenario's actual BLOCKED/NOT RUN status and explicit owner follow-up, without waiving critical backup or required platform checks.
6. Modal/navigation states for new wallet configuration, backup consent/check/failure, vault registration, file picker, QR readiness/retry and network/node switching. Verify disabled/proceed controls, error dismissal, keyboard/dismiss/reopen and account handover while delayed operations resolve. Simulator camera/USB/NFC limitations must be explicit.
7. Wallet/Vault/Archived Wallet refresh, sequential label persistence, node failover/custom-node separation, deep-link cold/warm start, Ask Keeper retry/late response and existing USDT read-only balance/address/history/export. New USDT/GasFree setup, transfers and GasFree actions remain paused. Correct association hosting/certificates and available provider access are separate dependencies; record inaccessible cases rather than reporting UI-source tests as a provider pass.
8. Follow [inheritance validation](r4-inheritance-validation.md): same public test seed with/without passphrase, actual primary/inheritance identities, six-month selection, exported descriptor and fixed absolute activation. Mainnet means 180 days; new Testnet fixtures use the documented accelerated delay. Activity/later deposits must not reset it. Keep affected-wallet assessment and any funded repair separate; unavailable preserved assessor source is still a blocker, not a guessed safety verdict.
9. Profile realistic small/large encrypted backup checks, local-generation capture and UI interaction on both native runtimes. Record sizes/counts, wall time, responsiveness/cancellation, memory peaks and stall/deadline behavior. Do not truncate records or weaken size/timeout/identity guards to obtain a pass. Historical benchmarks and fast loopback HTTP tests are not native profiling acceptance.

Do not sign or broadcast user transactions, touch funded MAINNET wallets, or use real recovery/private material. Physical phones, camera scanning, NFC/USB and hardware signer address/policy/PSBT round trips stay explicitly tracked for the owner's approved physical follow-up; simulator screenshots and fabricated device results cannot satisfy them.

## Exact-head owner scope and Local report

Read [AGENTS.md](../AGENTS.md), including merged [#7050](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7050). Keep `IOS, ANDROID, HARDWARE` in the final Cloud handoff. The release-owner account **antuz123**, with current write access, must record a **new** scope comment for the exact final SHA to defer unrun physical checks. A new commit invalidates both previous Local sign-off and the old deferral. Do not post as a different account or infer a fresh GitHub decision from the old b160 comment.

```text
## Codex local scope decision
State: OWNER_DEFERRED_PHYSICAL
PR: #7045
Head commit: <full SHA captured and tested above>
Deferred local checks: HARDWARE
Reason: The release owner directs unrun physical phone, camera, NFC/USB and hardware-signer checks to post-release testing because those devices are unavailable for this Local run. IOS and ANDROID and known critical failures are not deferred.
Post-release follow-up: The owner will test the installed released iOS/Android builds on physical phones and available signers, including QR, address verification, vault policy and PSBT round trips, and report exact build/device outcomes on #7045 or the release record.
```

This scope decision authorizes no release action and cannot turn a failed physical check into PASS. Run all feasible automated/native checks first. Unavailable noncritical scenarios may be recorded individually as `NOT RUN / POST-RELEASE` only with explicit reason and owner follow-up; neither that label nor the physical decision waives required IOS/ANDROID or a critical backup/key/funds/recipient/policy failure.

After testing, post a new report preserving the earlier `LOCAL_FAILED` evidence:

```text
## Codex local validation
State: LOCAL_PASSED | LOCAL_FAILED | BLOCKED
Tested commit: <full SHA captured and tested above>
iOS build/simulator: PASS/FAIL/NOT RUN — exact commands, installed artifact identity, actual launch and critical UI/recovery outcomes; private log locations.
Android build/emulator: PASS/FAIL/NOT RUN — exact commands, package/version/counter, debug certificate/hash/alignment, actual launch and critical UI/recovery outcomes; private log locations.
Real devices/signers: NOT RUN / OWNER-DEFERRED PHYSICAL only if the exact-SHA owner decision exists; name its URL and every deferred scenario. Otherwise report actual results or BLOCKED.
Other checks: Exact app/Relay SHA; genuine native Realm/HTTP runner and per-operation C1-C10/producer/restore results; recovery/Jest/release/version/typecheck outcomes; hashes and redacted evidence.
Open issues / next action: Every failed, blocked or NOT RUN scenario, reason and owner follow-up. State whether critical software, unsigned native launch/flows, store histories, independent reviews and hosted Relay rollout remain open.
Release readiness: ready for review / NOT READY — LOCAL_PASSED does not authorize release, signing, deployment, upload or publication.
```

Use `LOCAL_PASSED` only after required iOS **and** Android checks actually pass and the physical requirement is either performed or covered by the accepted exact-SHA owner decision. Keep `Real devices/signers` beginning with `NOT RUN` or `DEFERRED` for deferred physical execution. If a critical scenario fails, retain `LOCAL_FAILED`; if a required prerequisite/check cannot run, use `BLOCKED`. Link the report and return the PR URL and actual state to the coordinator. Do not merge, deploy, sign a release, submit to stores or publish any artifact.
