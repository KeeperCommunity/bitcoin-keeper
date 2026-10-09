# Bitcoin Keeper — OSS Scanner enrolment preparation

Status: prepared for review, not submitted to Anthropic and not enrolled.
Checked on 9 October 2026. Contact: anant@bithyve.com.

## Initial scope

Enrol the public mobile repository, `KeeperCommunity/bitcoin-keeper`, following
`sprint`. Do not enrol private repositories, upload environment files or include
production credentials. Review the scanned revision against the shipped release:
`sprint` is an integration branch, not a statement that every change is released.

The first environment should build the Android app and run shared TypeScript /
JavaScript tests offline. iOS source remains available for inspection, but a Linux
image does not establish iOS runtime or hardware-signing coverage. Confirm this
scope with Anthropic before treating the environment as sufficient.

## What is prepared

- `project.yaml.example`: the public registration fields and approved contact.
  This is deliberately an example, not an active registration. It names a
  Dockerfile that must be implemented and validated before submission.
- `threat_model.md`: proposed audit boundaries and report expectations, subject to
  maintainer review against the actual enrolled source.
- This dependency and build-integration handoff. No app or release behavior changes.

## The narrow dependency

Reuse the Linux toolchain and diagnostic build work in
[PR #7043](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7043), rather than
maintaining a second Android toolchain. The reviewed implementation must be on the
branch selected for scanning before the registry configuration points to it.

At `cc15f593b62689267168a2405b318876c91947e0`,
`reproducibility/android-diagnostic-in-container.sh` reads
`release/version.json`, but that path is absent at that revision. Resolve that
source/manifest mismatch within the build workstream. Also complete the full
image build: the PR records a successful base-toolchain stage, not a completed
SDK/app build on that head.

The existing Dockerfile installs a toolchain; it is not by itself the scanner's
project build. Add a small adapter around the reviewed build recipe that:

1. Copies the scanner-provided checkout to `/src`, as Anthropic requires. Accommodate
   the current build helper's `/workspace/keeper` path without losing `/src`.
2. Installs all source, package, Gradle and native dependencies and builds the app
   during the network-enabled Docker build. Verify that source checks, including
   any `.git` requirement, work in Anthropic's actual build context.
3. Uses only the existing synthetic service values and public debug signing key.
   Keeps the corresponding synthetic configuration and dependency caches available
   for subsequent offline rebuilding. Never call hosted services during tests.
4. Preserves the built APK/AAB, native sources, shared tests and toolchain inside
   the image. Does not publish or install the diagnostic app on a user's device.
5. Rebuilds and runs the documented tests in a container with `--network=none`.
   A Gradle `--offline` flag alone is not proof that other processes stay offline.

Do not submit the example configuration as though this adapter already exists.
Do not replace the missing release manifest with guessed values to get a green build.

## Submission gates

- [ ] Resolve the source/manifest mismatch and select the reviewed source branch.
- [ ] Add and review `.oss-scanner/Dockerfile`, reusing the build recipe.
- [ ] Validate the full Docker build and actual network-disabled test run; record
      the source commit, commands, results and known coverage limits.
- [ ] Review the proposed threat model and mobile/Linux scope with a maintainer.
- [ ] Copy `project.yaml.example` to `projects/bitcoin-keeper/project.yaml` in a fork
      of `anthropics/oss-scanner`; set `disabled: false` only when ready.
- [ ] Run Anthropic's `tools/validate.py` and `tools/check bitcoin-keeper` against
      the exact submitted configuration and inspect the resulting offline image.
- [ ] Open the upstream enrolment PR as a core maintainer and complete its checklist.
- [ ] Anant personally completes any required contributor-agreement signature.
- [ ] Verify upstream acceptance before describing Keeper as enrolled.

A Keeper preparation PR, a question sent by email, or a passing schema check is
not an application accepted by the scanner.

## Work that should not hold this up

The final WalletScrutiny / source-to-distributed-binary reproducibility result is
not a scanner prerequisite. Only the usable, tested audit build is needed.

The full R4 release and the separate Recoverable Wallet preview in
[PR #7041](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7041) need not be
finished. If source alignment with the release-baseline work is needed for the
build, track that exact change rather than making all of R4 a prerequisite.
Do not merge unrelated work or bypass review gates to complete this enrolment.

Claude for Open Source is a separate, individual maintainer application. It can
be submitted now and has no dependency on any of these product milestones.

## References

- https://red.anthropic.com/oss-scanner/
- https://github.com/anthropics/oss-scanner/blob/main/README.md
- https://github.com/anthropics/oss-scanner/blob/main/CONTRIBUTING.md
- https://github.com/KeeperCommunity/bitcoin-keeper/blob/sprint/SECURITY.md
