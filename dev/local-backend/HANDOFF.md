# Independent contributor setup check

Use this full-stack checklist after Keeper has accepted private Relay readiness and
granted Relay access. SigningServer-only work needs no Relay invitation; follow
[its independent setup](README.md#signingserver-without-relay-access). A maintainer's working Mac does not establish that the guide works
on another developer's machine. This check does not authorize code acceptance or
an official release.

## Start clean

1. Use your own approved GitHub identity and a fresh app clone at the exact commit
   supplied by the maintainer. Record `git rev-parse HEAD`. Do not copy another
   developer's `.env`, databases, signing volume, account credentials or key files.
2. Follow [README.md](README.md) for the toolchain, private Relay access and a
   running Docker engine. If other Keeper projects are running, choose a distinct
   Compose project and three unused ports as documented there.
3. Run `./dev/local-backend/dev up`. It must prepare the pinned sources, start the
   services and pass the local API checks without production credentials.
4. Run `./dev/local-backend/verify-local.sh --persistence --boundaries` while no
   other test is using this project's services. It recreates this project's
   containers while retaining its volumes. Both persistence and rejection of
   mainnet/hosted database settings must pass.
5. Run `python3 -B -m unittest discover -s dev/local-backend -p 'test_*.py'`.
6. Follow the native development build instructions for the platforms available
   on this machine. iOS requires a Mac and Xcode. Record unavailable platforms as
   untested, not passed.
7. In the development app, create only a disposable local test fixture, complete
   passcode/onboarding, reach Mobile Wallet and More Options, then relaunch and
   unlock. Confirm that the app uses the local environment. Do not import a real
   wallet or move real funds for this check.
8. Stop the selected stack with `./dev/local-backend/dev stop`. Retain the volumes
   for follow-up unless you intentionally choose to discard this test fixture.

## Send the result privately to the coordinating maintainer

Copy this summary into the existing private conversation. Maintainers keep it in
the internal development backlog, not a new public administrative issue.

```text
App commit:
Backend revisions (from dev/local-backend/sources.lock.json):
Host OS and architecture:
Docker/Compose, Node/Yarn, Python, Java and Xcode versions as applicable:
Fresh clone and new project/volumes: yes/no (explain reused state)

PASS:
FAIL or BLOCKED (exact step and sanitized error):
NOT TESTED:
Guide corrections or undocumented steps needed:
Native platform(s), simulator/emulator and onboarding/relaunch result:
```

Do not attach recovery words, private keys, authentication tokens, receipts,
databases, captured emails or unreviewed full logs. Report security findings via
[SECURITY.md](../../SECURITY.md). Ordinary reproducible user-facing defects can
have public product issues after removing private details.

Passing this checklist proves only the listed local setup and smoke checks.
Purchases, push delivery, scheduled inheritance, hardware wallets, transaction
signing and recovery correctness require their own acceptance evidence; see the
[capability table](README.md#what-works-locally) and [verification record](VERIFICATION.md).
