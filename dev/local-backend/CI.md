# Contributor checks and analysis

## Public backend CI

The app's local backend workflow pins the public
[Relay](https://github.com/KeeperCommunity/Relay) and
[SigningServer](https://github.com/KeeperCommunity/SigningServer). It requires no
private repository token or production credential. The default branch runs
`Public backend setup` for the packaged adapter, bootstrap and disposable API
checks. Earlier Linux backend runs failed while fetching the private Relay;
those historical runs do not establish the result for this public pin.
Code acceptance and releases remain maintainer decisions.

## Active checks

The default branch's existing `Run Tests` workflow runs app tests. The new
`Public backend setup` workflow runs a separate public SigningServer adapter
fetch/install/compile/test job and full local backend bootstrap, API,
persistence and network-boundary checks. Neither job uses hosted credentials.
Pull requests are checked against their proposed merge with the target branch.
The development branch's `Contributor checks` workflow additionally publishes
app test coverage; its results are tracked with PR #7014.

Where generated, Jest's LCOV measures only the
Electrum/wallet directories listed in `jest.config.js`; this is not whole-app
coverage. Test success is evidence about the exercised cases, not a security
clearance. Maintainers retain security review and acceptance responsibility.

## SonarCloud deferred on 26 September 2026

The project owner chose to defer SonarCloud on the development branch. That job
was removed from its active workflow; app tests and an LCOV artifact remain there. `sonar-project.properties` is
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
