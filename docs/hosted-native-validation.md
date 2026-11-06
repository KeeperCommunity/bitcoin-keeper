# Hosted native validation

This infrastructure-only bootstrap reuses issue #7059 / PR #7060's bounded hosted
development builds and disposable first-use UI smoke. It excludes that PR's app
and dependency changes. See [bootstrap preparation and adoption order](cloud-bootstrap-preparation.md)
for exact committed sources, exclusions and the relationship to Phase A #7062.
It does not change R4 #7045 or R5 #7058 app code, merge either branch, change branch
protection, or approve a release. Adopt it for R5 after R4's released baseline is
settled and R5 is reconciled against that baseline.

## Handoff

Draft publication skips both native jobs before runner allocation. The existing
host checks still run; the draft `Tests` dependency install disables lifecycle
scripts to avoid invoking native setup. See the [draft event table and budget
limits](cloud-bootstrap-preparation.md#draft-publication-behavior). Skipped native
jobs supply no platform pass. Marking ready for review enables native work and
requires separate authorization and budget; a draft is not a trust installation.

1. **Cloud code complete:** push the final code, run suitable regression checks,
   and record the full PR head in the existing `Codex local handoff`. Keep
   `Required local checks: IOS, ANDROID` and add `HARDWARE` when applicable.
2. **Hosted native validation:** the PR workflow checks out that exact head with
   read-only permissions and no persisted checkout credential. Both platform jobs
   install locked dependencies, build the development app and run the disposable
   startup smoke. Report each platform as `PASS`, `FAIL` or `NOT RUN` with the run
   URL, attempt and tested SHA. A successful build without a successful UI smoke
   is not a platform pass. Any new commit starts this step again.
3. **Remaining native and physical checks:** assign an authorized tester to the
   remaining feature-specific cases, fallback builds/UI when hosted setup fails,
   and physical-device cases; do not assume the owner's Mac is available. Real
   biometrics, phones/cameras, hardware signers, NFC/USB and signing prompts remain
   explicit. Preserve the existing owner-scoped HARDWARE deferral procedure. A
   later local `LOCAL_FAILED`/`BLOCKED` report cannot be hidden by a hosted pass.
4. **Release review:** inspect the actual exact-head evidence and unresolved
   issues, obtain independent review and explicit owner approval for any signing,
   distribution or submission. CI success grants none of those approvals.

Hosted coverage is deliberately narrow: cold startup to the passcode screen and
entry of a throwaway first passcode through the confirmation screen. Stop before
account/key generation, backup, wallet funding, live transactions or signer use.
Do not mistake this smoke for the R5 deletion matrix, recovery/upgrade validation,
startup performance acceptance or complete release readiness.

## Trust and gate behavior

The existing trusted base-branch gate never checks out or executes PR code and
retains its `keeper/local-validation` status name. The new native workflow uses
`pull_request`, never elevated `pull_request_target` execution. No signing,
environment secrets, release credentials or production configuration are passed
to its jobs.

The gate reads Actions metadata itself. It selects the newest run at the current
source SHA, verifies the workflow path, event, source repository/branch, associated
PR and SHA, and compares every workflow/harness file (including additions and
deletions) against both the current base and the run's base. The latest attempt
must have exactly one successful platform job with successful `Build development
app` and `Run disposable startup smoke` steps. A cancelled/pending run supplies no
pass. A completed run whose other platform failed can still supply its genuinely
successful platform. Partial reruns may lack the other platform in the latest
attempt; use **Re-run all jobs** to establish both platforms together.

Missing metadata, API failures, untrusted changed CI files and incomplete evidence
produce zero hosted passes. Existing local reports remain a fallback. HARDWARE
cannot be filled by simulator evidence. New commits also invalidate owner scope
decisions. Owner deferral still needs a later honest local report recording
physical checks as NOT RUN/DEFERRED; an actual failed physical test cannot be
deferred. No PR-author assertion of a hosted result is parsed as evidence.

This verifies reviewed CI provenance and actual GitHub step results. The native
build still executes PR-controlled Gradle/Xcode/Metro code on its disposable
runner. Integrity checks detect tracked harness changes between phases, but do
not provide an adversarial sandbox against malicious same-user build scripts.
Review native source and CI changes before merging; branch review requirements
remain necessary. The gate does not make an unreviewed app trustworthy.

Bootstrap is intentionally staged: this infrastructure PR can run diagnostics and
test the verifier, but its new workflow is not yet in the protected base, so its
hosted results cannot authorize app PRs. Review and merge the CI-only PR only when
the owner approves. Then a new same-repository PR run using unchanged reviewed CI
files can provide evidence. Fork runs and modified native CI need review/local
fallback. The workflow-run listener is also effective only after the trusted gate
is merged; pre-merge gate tests execute the candidate inline script with mocked
API responses, not a privileged checkout of the candidate.

## Dependency and native-install failures

Use Yarn 1's frozen lock install with lifecycle scripts disabled, followed by the
explicit CI preparation in `.github/native/`. The repository's normal `prepare`
unconditionally invokes CocoaPods and writes a Mac-specific Android SDK path;
running it on Linux is not supported. Do not silently regenerate `yarn.lock`, use
an unlocked install, skip patch failures or replace a failed native build with
Jest. CocoaPods deployment mode likewise exposes Podfile/lock drift.

The pinned Node compatibility tool is restricted to setup.sh's existing shim
whitelist without invoking its installer. Unrestricted `--hack` rewrites imports
to optional packages that the manifest does not contain; the bounded wrapper
keeps both platform Metro graphs resolvable using committed dependencies. Android
command-line tools are provisioned explicitly before SDK/NDK installation.

The #7060 source checkpoint documents dependency drift at sprint
`def0d6a90c80287edb4f58ae272cbfc340f00d73`: missing Yarn lock selectors and older
IAP/Nitro Pod-lock selections. Those app/dependency repairs are excluded here.
The private environment's setup reported a failed frozen app dependency install;
this preparation neither repeats nor repairs it. Host contracts do not validate
app installation or either native platform.

The inherited native lock-repair path is diagnostic only: if separately
authorized, it fails without building/testing and retains a candidate lock for
review. It is not enabled or run by this bootstrap. Dependency repair belongs in
a separate reviewed source change; an authoritative native run must use frozen
Yarn and `pod install --deployment`. New source commits require new native results.
Do not import the ongoing R4 diagnostic/reproducibility branch or its private
fixtures. Its existing Android build diagnostics do not constitute emulator UI
evidence.

## Evidence, runner budget and remaining work

Each platform retains allowlisted source/toolchain/runner metadata, actual command
exit outcomes and fixed diagnostic categories. Diagnostic Pod-lock repair
may also retain its dependency-lock candidate; it cannot report a platform pass.
Development configuration points service integrations at
loopback and uses dummy Firebase identities. Only the bounded first-use scenario
runs on fresh hosted devices. Raw build/device/Metro/Maestro logs, screenshots,
app bundles, keystores and generated account data are not uploaded. Failed raw
command output stays private to the ephemeral runner; metadata records which
command failed. Keep artifacts for seven days.

On startup failure, metadata may include fixed Maestro command/assertion labels,
Metro failure categories and Android/iOS error categories from this job's fresh
account-free device. No error message, path, arbitrary exception name or suffix is
copied from those logs. The schema-1 `redacted_tool_errors` field retains its name
for compatibility but now holds only fixed category identifiers. Unrecognized
text supplies no category; an empty diagnostic list never means success. CLI
failures also omit arbitrary exception text. Diagnostic collection cannot change
a failed result. Cold development
bundling has a three-minute initial-screen allowance and seven-minute Maestro
command limit, with all UI assertions still required. This is not release
performance acceptance. The iOS build command is limited to the hosted
simulator's architecture and 40 minutes; Android's build command is capped at
35 minutes.

Before the iOS build, a separate disposable simulator checks Maestro's driver
with a bounded `hierarchy` command. This is setup only: it installs no Keeper app
and supplies no app build or UI credit. Its private XDG state and fixed diagnostic
flags remain separate from the later smoke. The command is capped at five
minutes, with Maestro's driver timeout unchanged; owned simulator cleanup runs
on success or failure.

For both platforms, a bounded loopback request compiles the development bundle
before iOS simulator creation or Android app installation; only its HTTP status,
byte count and hash are retained.
This setup step supplies no native/UI pass. On failure, fixed startup-screen
flags may be derived from bounded private Maestro hierarchy snapshots, without
retaining their text or attributes. The iOS exception collector reads the first
MiB of compact own-process output over the launch window, preserving early
errors instead of parsing a truncated JSON array. Missing diagnostics remain
explicit and do not imply a clean runtime.

The iOS job is capped at 65 minutes and Android at 60 minutes, with command and
emulator boot limits inside those budgets. The jobs have no automatic retries;
new pushes cancel only
this workflow's runs for that PR. Cold native compilation, SDK installation and
CocoaPods can consume substantial hosted minutes. Use job timestamps and the
Actions usage page to report observed runtime and cost; do not describe a failed
dependency preflight's short duration as native-build timing. Current pricing,
included minutes and spending limits depend on the repository's plan.
As checked on 2026-10-17, GitHub's [standard runner rates](https://docs.github.com/en/billing/reference/actions-runner-pricing)
are $0.062/minute for macOS and $0.006/minute for Linux x64. At those rates a
30-minute iOS plus 30-minute Android attempt is about $2.04; reaching both job
caps is about $4.39, before included minutes, artifact storage, rounding and the
existing CI jobs. These are planning estimates, not measured native timings or
an account bill. These rates were inherited from #7060 and were not rechecked in
this source-only preparation. Observed bootstrap results belong in the validation report.
Enable spending limits before routine use if needed.

Any later validation report must record the actual source/run/attempt and each
platform's build/UI outcome. This preparation runs no native workflow. Until both
strict native builds and actual UI runs
work reliably, use the existing local fallback without interrupting an active Mac
session. A passing startup smoke does not transfer to another PR or prove its
feature matrix. R4 and its existing Local evidence remain outside this bootstrap.
Hardware and release approval remain separate.

## Administrative configuration

Require `keeper/local-validation` and existing `Tests` for merges to `sprint`,
and require review for changes to the gate/native harness. `Native validation
contracts` is a useful additional required check. Do not require both native jobs
unconditionally when local fallback is intended: the combined gate resolves
platform evidence. Administrators should verify the required status app/source,
default-branch workflow availability, Actions runner permissions and private-repo
minute budget. The inherited #7060 report states that on 2026-10-17 the active
branch-rules endpoint reported required
`keeper/local-validation` and `Tests` checks from GitHub Actions (integration
15368). The legacy branch-protection endpoint returned HTTP 403; broader
administrator and bypass settings remain unverified. These settings were not
rechecked or changed by this source-only preparation.
