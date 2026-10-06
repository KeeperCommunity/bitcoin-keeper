# Contributing to Bitcoin Keeper

Contributions are welcome through forks and pull requests. Keeper
maintainers are responsible for code and security review, assessing privacy risks,
deciding whether to accept changes, and controlling merges and public releases.
Passing automated checks or submitting a working build does not constitute approval.

## Set up a local workspace

Fork this repository on GitHub and clone your fork for contributions. You do not
need write access to the Keeper repository or production credentials. Follow the
[local development guide](dev/local-backend/README.md) for tool versions, Docker
backend setup, Android Studio/Xcode builds and troubleshooting. Docker runs the
backend; native SDKs and the mobile app run on your host.

The [SigningServer source](https://github.com/KeeperCommunity/SigningServer) is
public and can be cloned, installed, built, tested and contributed to on its own.
The full Docker app/backend setup still needs the private Keeper relay source;
a fork of this app and public SigningServer access are not enough. Follow the
[contributor access process](dev/local-backend/ACCESS.md) when your work needs
Relay. Public app and SigningServer development need no access approval, and
approved contributors do not need approval for each local command or edit.
Access approval is separate from acceptance of contributed code.

The guide's [capability table](dev/local-backend/README.md#what-works-locally) lists
supported local flows and unavailable integrations. The
[verification record](dev/local-backend/VERIFICATION.md) distinguishes tested
behavior from failures and untested platforms. Start with disposable testnet
wallets. Store accounts, release signing keys and production backend access are
not prerequisites for contributing.

## Develop a focused change

1. Find an existing issue or describe the problem in a new issue. For a suspected
   vulnerability, use the private process in [SECURITY.md](SECURITY.md) instead.
2. Create a branch in your fork. Use the base branch associated with the issue;
   if none is specified, use the repository's default development branch,
   `sprint`. Do not assume a release tag includes every unreleased feature.
3. Capture the change's scope and acceptance criteria using the repository's
   OpenSpec workflow. The CLI is included in the locked development dependencies:

   ```sh
   yarn openspec new change your-change-name
   yarn openspec status --change your-change-name
   yarn openspec instructions proposal --change your-change-name
   ```

   Follow the artifact instructions for proposal, specs, design and tasks. Read
   [OpenSpec configuration](openspec/config.yaml); for UI changes, also read
   [DESIGN.md](DESIGN.md). The repository's
   [change-engineer workflow](.github/agents/change-engineer.agent.md) describes
   planning, implementation and archiving. Respect any explicit repository-owner
   restrictions on committing, pushing or publishing when using coding agents.
4. Implement the agreed scope, reuse existing components and keep unrelated
   formatting, dependency upgrades, feature reconciliation and version bumps out
   of the change. Maintainers coordinate version numbers and the
   [Android](android/fastlane/README.md) and [iOS](ios/fastlane/README.md) release
   workflows separately from local development.

For backend development, bootstrap creates ignored checkouts under
`dev/local-backend/.sources/`. Save backend work in a branch/patch and submit it to
the appropriate backend repository; an app PR does not include those ignored
edits. Changes to packaged adapters must update the corresponding SHA-256 entries
in `sources.lock.json` and be verified from freshly prepared sources. Do not
package a generated checkout, database or signing volume in a PR.

## Test and report the result

Run checks relevant to the changed behavior. These commands run from the app root:

| Change | Checks |
| --- | --- |
| App logic | `yarn test --runInBand` (or the relevant Jest test paths) and `yarn lint` |
| User flow or native code | Build the affected development app and exercise the acceptance scenarios; use/update relevant Maestro flows under `flows/` |
| Local backend/bootstrap | `python3 -B -m unittest discover -s dev/local-backend -p 'test_*.py'` and `./dev/local-backend/dev verify` |
| Persistence or isolation | `./dev/local-backend/verify-local.sh --persistence --boundaries` on a disposable, otherwise idle Compose project |
| OpenSpec | `yarn openspec validate your-change-name --strict` |

Shared mobile changes should be checked on both Android and iOS. If a platform,
hardware device or integration is unavailable, say so; maintainers decide what
additional testing is required before acceptance. A local backend smoke test does
not validate recovery, transaction signing or every mobile feature.

Report the commands, commit, platform/device, actual results and relevant redacted
evidence. Keep **passed**, **failed/blocked** and **not run** separate. Describe
existing failures rather than hiding them or reporting an unexecuted check as a
pass. Screenshots can support manual verification but do not turn a failed
automated assertion into a passing automated test.

## Submit and review

Open a pull request from your fork and complete the supplied template. Link the
issue and OpenSpec artifacts, explain the behavior change and provide the test
results. Review the diff before submission: exclude local environment files,
generated dependencies, databases, keys, wallet backups and signing credentials.
Use [SECURITY.md](SECURITY.md) for private vulnerability details.

Keeper maintainers review correctness, product fit, security/privacy, dependencies
and test evidence. They may request revisions or additional tests, and decide
whether a change is accepted. Only authorized maintainers merge and release
official builds. Contributors do not need release permissions to participate.

Some existing CI checks use maintainer-managed services or secrets. If a check is
unavailable on a fork PR, report it in the PR so maintainers can arrange review;
do not request production secrets or treat an unavailable check as passing.
This document defines review responsibilities; it does not claim that GitHub
branch protection or approval rules have been configured or verified.

GitHub runs the app tests and publishes their LCOV report for review, plus
bootstrap and Docker backend checks. The existing Electrum/wallet integration
tests use public testnet nodes and fee services; an internet connection is needed.
Coverage measures the configured Electrum/wallet source directories, not every
app screen. SonarCloud analysis is deferred; passing tests are not a security
analysis pass. See [CI troubleshooting](dev/local-backend/CI.md) for current access
limitations, the deferred analysis work and how results are distinguished.
