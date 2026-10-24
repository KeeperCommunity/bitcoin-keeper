# Exact event source in CI

The three jobs in `test.yml` select the pull request's event head or the push
commit explicitly. They verify the actual Git HEAD before dependency setup,
after setup and after all checks. A different commit fails even when its tree
equals the requested candidate. Tracked changes and nonignored added source
also fail. The historical matrix alone permits its separately pinned
`.ci-relay` checkout, rejecting aliases, a different fixture commit and changes
inside that checkout. Its original protocol pin and failures remain unchanged.

The fixed JSON receipt records source commit/tree and run/attempt. Its workflow
SHA is recorded separately: a PR workflow can still be evaluated from GitHub's
synthetic merge. This receipt establishes checkout identity only. It does not
authorize native acceptance, protected-origin trust, signing or release, and
the existing gates and permissions remain in force.

Observed motivating evidence is CI39839936253, Tests job120037960899: the check
was attached to candidate8cf8053069e13f1efea7d0a6f5a39b6011c0d293 but actually
checked out1a5e7ac2ffd21112999ba8f717fdd87354918b8c. Both commits have tree
259c2fc92789556a83ae9da90a59ca09421d8dbb. Its788Jest/502recovery passes belong
to the actual checkout; an identical tree does not turn them into a pass on a
different SHA. Exact8cf local788Jest and private43+1+3 protocol results retain
their own sources. A separate disposable exact-checkout recovery run addresses
the unavailable local Realm N-API prerequisite without mocking it.

This bounded package changes no app behavior, native worker, protocol fixture,
dependency, version, signing or distribution operation. It requires its own
source checks and hosted run before live CI behavior is called verified.
