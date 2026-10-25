# R5 controlled malformed native credential acceptance

This separately reviewable companion is based on candidate
`3eb92fc8a622a3e09926d49f47243c163e32d009`. It adds CI fixture files, host
contracts and this document. It changes no product source, native dependencies,
release settings, producer branch or active 5.2 work. Estimated delta: about
8–10k changed implementation/test tokens, one feature area. Native iOS and Android execution is
**NOT RUN** for this package. Host contracts are not native acceptance.

The native fixture uses actual `react-native-keychain` and native MMKV. It
requires a development/loopback build with the known disposable username and
exactly one persisted default account whose identifier is empty, whose app ID
matches the persisted current app, and whose hash matches the native credential.
An empty Keychain read is rejected before any write; it is never called a read
error. Existing or unknown fixture backup data is also rejected.

The arm entrypoint copies the original username/password bytes into a private
same-app Keychain service, verifies that backup, writes a known malformed JSON
password to the normal default service, and verifies the malformed value through
the native API. The normal app then runs through the ordinary `index.js`:

1. Startup shows the blocking credential error, with no setup, login or home.
2. The user taps Retry with the malformed value still present; the blocking
   error remains and no new-account request is accepted.
3. A cold app launch remains blocked.
4. A separate fixture process verifies the same persisted account, restores the
   exact original value through Keychain, verifies it, and deletes/verifies
   removal of its backup service.
5. The ordinary app cold-logs in twice with the existing disposable PIN and
   shows the existing one-wallet account. The backend's setup counter must not
   increase. The installed native artifact must match before and after.

No credentials, account identifiers, hashes, Realm data or device screenshots are
exported by this fixture. Original credential bytes exist only in device Keychain
and transient native/JS memory. Exceptions are rendered as a fixed failed stage;
host evidence contains only fixed stages, counts, safe artifact hashes and named
limits. Maestro's automatic diagnostics remain private and are deleted on both
success and failure, together with the parent suite's private command logs. The
parent must always destroy the owned simulator/emulator data on failure, including
any backup service left when restoration cannot finish. This package never
inspects, pulls, prints or resets an arbitrary credential store.

The scenario proves controlled malformed **serialized credential data** in a
real native store and the ordinary app's JSON-parse error path. It does not
exercise an OS authorization denial, locked-device read, unavailable security
hardware, physical biometrics, recovery backup protocol or production account.
The Retry tap is observed through normal UI; native read-call counts are not
instrumented. Recovery is tested after a separate fixture process and cold
launch. Same-process Retry after external repair remains **NOT RUN**.

The runner integration is deliberately left to the R5 coordinator to avoid
overwriting the other companions' shared runner edits. Invoke
`product_credential_acceptance.run_companion(h, data, device, private,
backend_receipt, switch_entrypoint)` immediately after the unused-key/PIN
companion, before any Version History or Vault fixture that changes account
data. The callback is owned by the parent runner and accepts only `arm`,
`restore` or `product`:

- Stop the owned development app and its existing task-owned Metro process group.
- For `arm`/`restore`, start Metro with the committed
  `.github/native/credential_metro.cjs` and exactly the corresponding
  `KEEPER_CREDENTIAL_FIXTURE_PHASE`. For `product`, start ordinary Metro without
  that config or fixture variable.
- Wait for the selected Metro instance and warm its bundle before returning.
  Preserve the resulting process handle so parent cleanup stops it on any error.

Every reviewed Maestro phase ends with `stopApp`. No fixture service runs beside
the ordinary application process. Callback/source installation, combined native
execution and physical checks remain separate obligations. Root owns native
scheduling; this package performs no build, dispatch, signing or distribution.

Host verification commands:

```sh
node --test .github/tests/credential_fixture.test.cjs
python3 -B -m unittest discover -s .github/tests -p 'test_product_credential_acceptance.py'
git diff --check
```

The nine Node and seven Python checks use fake native/driver adapters to verify
identity guards, empty/error separation, backup ownership/readback, restore
failure handling, fixed phases, exact installed-byte checks, duplicate setup
rejection and private-diagnostic deletion. They supply no native PASS. The three
JSX entrypoint/wrapper Babel transforms also pass locally. The existing native
contract workflow discovers both new test files automatically. All 38 existing
and new product Python contracts also pass together on this branch.
