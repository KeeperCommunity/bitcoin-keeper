# Contributor checks and analysis

## Backend source access blocker

The first Linux backend job passed bootstrap unit tests, then failed fetching the
relay source. An anonymous GitHub API check returns 404 for both pinned backend
repositories; an authenticated check confirms both are private. This Mac's saved
read credentials explain why local setup passed. The app repository's CI token
does not supply read access to those repositories.

Maintainers must choose approved contributor/CI read access or a reviewed public
development backend. Do not publish the private repositories, copy their contents
into this app, or place a developer's personal token in CI to hide the failure.
The Docker check remains failing until source access is actually resolved.

## Check behavior

The `Contributor checks` workflow runs app tests with coverage and the local
backend bootstrap/API/persistence checks. Pull requests are checked against their
proposed merge with the target branch. The app test command does not force Jest
to exit or ignore failures. Vault tests close their Electrum connection and the
test harness closes HTTP keep-alive agents after each test suite.

The coverage artifact is passed to SonarCloud using
`sonar.javascript.lcov.reportPaths`. The analyzer waits for the quality gate;
neither failed analysis nor a failed gate is treated as success. No threshold has
been lowered. Jest currently measures only the Electrum/wallet directories listed
in `jest.config.js`; this is not whole-app coverage.

Fork PRs run tests without maintainer secrets. SonarCloud is skipped for those
PRs and therefore supplies no analysis approval; maintainers must arrange the
required review before accepting the code. Never expose a Sonar token to fork
code or switch to `pull_request_target` to bypass that boundary.

## SonarCloud access blocker found on 26 September 2026

PR #7014's original scanner failed while retrieving the pull request, before
analysis. The public SonarCloud project metadata still lists the repository as
`bithyve/bitcoin-keeper`, while this PR lives in
`KeeperCommunity/bitcoin-keeper`. This is evidence of a stale binding; the exact
access/configuration problem needs verification by a SonarCloud administrator.

An administrator should inspect the project's Repository binding and the
SonarCloud GitHub application's access to `KeeperCommunity/bitcoin-keeper`, then
run analysis again. If the organization transfer requires a new Sonar project,
use its actual project/organization keys and token in the repository configuration
and GitHub secret. Do not invent keys or disable analysis to obtain a green check.
See Sonar's [repository binding instructions](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/administering-your-projects/changing-binding).

The last existing `sprint` analysis (17 September, commit `1adf4f663`) already
reported a failed quality gate: 0% new-code coverage, reliability rating C, 5.1%
duplication and 0% reviewed security hotspots. That analysis used a previous-version
baseline dated September 2024. Those results are not this PR's analysis. Repairing
the report upload does not prove that all underlying findings have been resolved;
review the new analysis and any remaining findings before merging.
