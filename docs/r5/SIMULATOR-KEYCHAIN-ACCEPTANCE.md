# Hosted simulator Keychain acceptance

This bounded package starts from integration `8b56c6b51831e69f4b67a77754f431f5dcf4711c`.
It changes hosted simulator output signing, not production signing configuration,
Keychain behavior, startup error handling, or the accepted installed-byte policy.

## Observed failure

Frozen app source `044ebb6ea2d465f6a70e9116e3feac5a604cd696`, PR #7131,
run `39873063291` attempt 1, built and installed the unsigned iOS simulator app.
Startup failed before persistence/worker/product acceptance. The exact retained
ZIP `12469536083` has SHA-256
`e244015128d4aa72e1e1c8be3072bc70d506ba11a804067448122d1318621caf`.
The completed #7146 readout `39878256837`/job `120169112238` transported those
original bytes; independent local decode matched that digest. One owned,
in-window `NATIVE_CREDENTIAL_READ` rejection recorded status `-34018`
(`errSecMissingEntitlement`). The unsigned build did not measure effective
entitlements, so this is a targeted simulator configuration correction requiring
new hosted confirmation, not a claim that the app defect has been fixed.

The same frozen run's Android job `120167960772` built and installed its APK,
then failed inside strict installed-byte verification before Maestro launch.
The final recorded command was the package-path query. Its safe public log does
not distinguish path rejection, pull failure or differing APK bytes. No Android
app/navigation cause is inferred and no previous pass transfers to this source.

## Correction and remaining evidence

The harness still builds Debug for `iphonesimulator` with production signing
disabled. A separate helper signs only its owned development simulator bundle
with the ad-hoc identity `-`. Embedded frameworks/libraries receive no app
entitlements; the main app receives a fixed synthetic CI application/team ID and
one matching Keychain group. Device/production bundles, extensions and unexpected
effective entitlements reject. Signature verification and effective-entitlement
readback must succeed before the built artifact identity and build PASS are
recorded. No certificate, provisioning profile, credential export or personal
Mac is used. Release `signing` remains `NOT RUN`.

Built and installed bytes must still match in full before and after acceptance.
The Android verifier only adds fixed failure-stage logging; original query,
path policy, pull, byte hashes and rejection behavior remain intact. This makes
the next original failure diagnosable without publishing paths or exception text.

Host contracts cover simulator-only identity, nested signing order, effective
entitlement/signature mismatch, original tool errors, stale proof revocation,
private-file cleanup, and Android path/pull/byte failures. These tests simulate
tool responses and do not establish codesign, Keychain or native acceptance.

The next sole exact-source hosted diagnostic window must run iOS then Android
after independent review and a fresh global native-capacity check. Preserve all
failed original attempts. Require actual startup, persistence, worker, installed
bytes, five product samples, Retry and key/PIN/companion results; unexecuted or
failed scenarios remain explicit. Physical checks and installed trusted-base
acceptance remain separate. No release, store upload, deployment or merge is
authorized by this package.
