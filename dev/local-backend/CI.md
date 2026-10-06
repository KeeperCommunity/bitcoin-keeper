# Contributor checks and analysis

## Readiness before access; CI provisioning pending

Keeper uses [approved contributor access](ACCESS.md) for private Relay.
Relay source/history readiness and security review must be accepted before
expanding access; private visibility does not waive that review. The published
[SigningServer](https://github.com/KeeperCommunity/SigningServer) can be developed
and tested independently without Relay access. Acceptance of code and official
releases remain separate maintainer decisions.

The Linux backend job passed bootstrap unit tests, then failed fetching private
Relay. SigningServer is now public and pinned to its public revision; the app
repository's CI token still does not supply Relay read access. The full-stack
job remains blocked there. SigningServer's own public test and source-readiness
checks are separate from this app job.

The Relay access policy is decided; provisioning an automation identity and a reviewed
credential-handling workflow is still pending. Human contributor approval does
not fix CI access. Do not publish private sources or use a developer's personal
token to hide the failure. The Docker check remains failing until CI source
access is actually implemented and verified. Fork PRs must not receive these
credentials or private source artifacts; do not use `pull_request_target` to run
untrusted code with secrets.

## Active checks

The `Contributor checks` workflow runs app tests with coverage, a separate public
SigningServer adapter fetch/install/compile/test job, and the full local
backend bootstrap/API/persistence checks. The SigningServer job needs no private
source access; it does not establish full-stack readiness. Pull requests are checked against their
proposed merge with the target branch. The app test command does not force Jest
to exit or ignore failures. Vault tests close their Electrum connection and the
test harness closes HTTP keep-alive agents after each test suite.

App tests publish an LCOV artifact for review. Jest measures only the
Electrum/wallet directories listed in `jest.config.js`; this is not whole-app
coverage. Test success is evidence about the exercised cases, not a security
clearance. Maintainers retain security review and acceptance responsibility.

## SonarCloud deferred on 26 September 2026

The project owner chose to defer SonarCloud. Its job is removed from the active
workflow; app tests and the LCOV artifact remain. `sonar-project.properties` is
retained for future restoration, including the report path and quality-gate wait
setting. No analysis or quality-gate pass is claimed, and no threshold has been
lowered. GitHub protection settings were not changed; if a required Sonar status
blocks merging, a maintainer must reconcile that setting with this decision.

Before deferral, PR #7014's original and updated scanners failed while retrieving
the pull request, before analysis. Public project metadata lists the repository
as `bithyve/bitcoin-keeper`, while this PR lives in
`KeeperCommunity/bitcoin-keeper`. This suggests a stale binding; an administrator
needs to verify the exact access/configuration problem when analysis is restored.

Deferred follow-up: inspect the project's Repository binding and GitHub app
access, confirm project/organization keys and the secret, restore a pinned scanner
that consumes LCOV and waits for its quality gate, then review the actual result.
Keep analyzer credentials away from fork code. See Sonar's
[repository binding instructions](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/administering-your-projects/changing-binding).

The last existing `sprint` analysis (17 September, commit `1adf4f663`) reported a
failed quality gate: 0% new-code coverage, reliability rating C, 5.1% duplication
and 0% reviewed security hotspots, using a September 2024 previous-version
baseline. These are historical findings, not this PR's analysis. Deferral does
not resolve them or replace Keeper's review.
