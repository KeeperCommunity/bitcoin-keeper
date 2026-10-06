# Contributor development environment

Run MongoDB, Keeper relay/channel and the testnet signing backend in Docker. Run Metro, Android Studio and Xcode on your host. Hosted development services have been retired; this setup needs no production backend or release credentials.

For choosing a change, OpenSpec, test reporting and submitting a pull request, see
[Contributing](../../CONTRIBUTING.md). Keeper maintainers own security review,
acceptance, merges and official releases.

## Prerequisites

**Full stack source access is currently required:**
`KeeperCommunity/bitcoin-keeper-relay` remains private. Follow the
[contributor access process](ACCESS.md) if your work needs the full Docker stack.
[KeeperCommunity/SigningServer](https://github.com/KeeperCommunity/SigningServer)
is public; its source, install, build and unit tests are available independently
without Relay access. Public app and SigningServer development need no access
approval. App setup alone does not grant private Relay access.

- Git, Python 3.9+, Docker Engine with Compose v2.20+ (or a newer Compose release). On macOS use Docker Desktop or Colima; Linux can use Docker Engine. Start the engine before setup. Reserve about 3–4 GB for Docker and run native builds sequentially on a 16 GB Mac.
- Read access to the private Relay repository for `dev up`. SigningServer needs only anonymous GitHub access. First setup downloads sources, container images and dependencies. Subsequent starts can reuse them.
- Mobile: Node 20.19.4+ (Node 22 is a suitable supported baseline), Yarn Classic 1.22.22. Use the committed `yarn.lock`.
- Android: Android Studio, JDK 17, SDK platform 36, build tools 35.0.0, NDK 27.1.12297006, CMake 3.22.1 and platform tools. Set `JAVA_HOME` and `ANDROID_HOME`. These versions come from this app's Gradle files.
- iOS: macOS, Xcode with an iOS simulator runtime, Ruby 3.3.0 (`.ruby-version`) and Bundler. Use the root `Gemfile.lock` and `ios/Podfile.lock`.

Earlier native validation on this Mac used Apple Silicon, Xcode 26.4, Node 25.9.0, Yarn 1.22.22, JDK 17 and Ruby 3.3.0. App tests also passed in GitHub Linux CI on Node 22; Linux full-stack setup remains blocked on private Relay access. Full contributor setup on Intel Macs, Linux and Windows/WSL still needs independent verification; iOS builds require macOS. See [verification](VERIFICATION.md) for actual results and limitations.

Native tool installation: [React Native 0.83 environment guide](https://reactnative.dev/docs/0.83/set-up-your-environment). Follow the repo-specific Android versions above when they differ from that guide.

## First start

While PR #7014 is under review, check out its branch explicitly:

```sh
git clone --branch codex/contributor-dev-environment https://github.com/KeeperCommunity/bitcoin-keeper.git
cd bitcoin-keeper
```

After the change is merged, contributors can use the normal `sprint` checkout.
The private Relay access prerequisite still applies to `dev up`.

From this app checkout's root:

```sh
./dev/local-backend/dev doctor
./dev/local-backend/dev up
./dev/local-backend/dev env
yarn install --frozen-lockfile --non-interactive
```

`up` fetches the exact backend Git revisions, applies the local development adapters, builds containers, waits for readiness and runs real disposable API checks. `env` creates `.env.local` with restrictive permissions; it refuses to overwrite an existing different configuration. Existing `.env` and production files are not used or modified.

## SigningServer without Relay access

For SigningServer changes that do not need the mobile app or Relay, use the
[public repository's instructions](https://github.com/KeeperCommunity/SigningServer#install-and-verify):

```sh
git clone https://github.com/KeeperCommunity/SigningServer.git
cd SigningServer
npm ci --ignore-scripts
npm run compile
npm test
```

Use Node 22 and report the exact tested commit. The server's unit tests use
disposable local fixtures; they do not establish full app/backend integration or
live signing behavior. To check this app PR's local adapter against its pinned
public source, run `./dev/local-backend/dev prepare-signing` from the app clone.
That command checks the adapter digests and applies it under ignored
`.sources/signing/` without fetching Relay or starting Docker. Submit upstream
SigningServer changes to its own repository. Full `dev up`, API checks and native
app setup still require approved private Relay access.

The JavaScript install hook only installs the repo's Node compatibility shims. Native dependencies are separate explicit steps below. It no longer runs CocoaPods on Android-only machines or rewrites `android/local.properties` with a Mac-specific path.

If default ports 3000/4002/3003 are occupied, copy `dev/local-backend/.env.example` to `dev/local-backend/.env`, set distinct ports and a unique project name, then run the commands above. Use the same settings for every invocation. Multiple copies using the same Compose project name share containers and volumes; give each independent environment a unique name. `.env.local` must match those ports. Commands work from any directory except the native/Yarn commands, which assume the app root.

## Android

Create and boot an emulator through Android Studio. Use an ARM64 image on Apple Silicon, x86_64 on Intel/Linux. Use `adb devices` to select its serial. In one terminal at the app root:

```sh
yarn start
```

In another terminal:

```sh
./dev/local-backend/dev android-forward --serial YOUR_SERIAL
ENVFILE=.env.local ./android/gradlew -p android app:assembleDevelopmentDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2
adb -s YOUR_SERIAL install -r android/app/build/outputs/apk/development/debug/app-development-debug.apk
adb -s YOUR_SERIAL shell am start -n io.hexawallet.keeper.development/io.hexawallet.keeper.MainActivityDefault
```

Use `-PreactNativeArchitectures=x86_64` for an x86_64 emulator. `ANDROID_HOME` lets Gradle locate the SDK without a machine-specific committed `local.properties`. Android debug signing uses the disposable debug keystore already in the repository. No release signing key is needed.

Keep `localhost` in `.env.local`: the app's Android cleartext policy allows it. `android-forward` connects the selected device to Metro and the configured backend ports; rerun after restarting the device. A physical Android device can use the same USB forwarding, but physical-device validation is a separate step.

## iOS

Select Ruby 3.3.0 with your Ruby manager, then from the app root:

```sh
bundle install
(cd ios && BUNDLE_GEMFILE="$PWD/../Gemfile" RCT_NEW_ARCH_ENABLED=1 bundle exec pod install)
xcrun simctl list devices available
```

Use the root Gemfile explicitly; the `ios` directory has a different Gemfile. CocoaPods may refresh checkout-path-dependent Hermes podspec checksums on initial installation; review any lockfile diff and do not treat dependency version changes as routine setup.

Start `yarn start` in a separate terminal. You can inspect the workspace in Xcode (`ios/hexa_keeper.xcworkspace`, scheme `hexa_keeper_dev`). Use the command below for local builds so `ENVFILE` reaches every native build phase; simply clicking Run with the default scheme settings does not select `.env.local`:

```sh
ENVFILE=.env.local xcodebuild -workspace ios/hexa_keeper.xcworkspace -scheme hexa_keeper_dev -configuration Debug -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID' -derivedDataPath ios/build/local-dev build
xcrun simctl boot YOUR_SIMULATOR_UDID
xcrun simctl install YOUR_SIMULATOR_UDID ios/build/local-dev/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app
xcrun simctl launch YOUR_SIMULATOR_UDID io.hexawallet.hexakeeper.dev
```

Skip `simctl boot` if already booted. Keep simulator signing enabled so the app retains required entitlements. Store publishing/signing is separate from contributor development; see the release documentation.

## Daily use and verification

```sh
./dev/local-backend/dev status
./dev/local-backend/dev verify
./dev/local-backend/dev logs
./dev/local-backend/dev stop
```

`stop` removes containers but retains both named volumes. A later `up` restores the environment. To check persistence and configuration boundaries explicitly:

```sh
./dev/local-backend/verify-local.sh --persistence --boundaries
```

This recreates only the selected Compose project's containers, retains its volumes, and compares the same app record and testnet signing public key. It also checks startup rejection of mainnet and hosted databases. Run when no other test is using that project. Ordinary `verify` does not restart containers. Every verify run adds a disposable app/signer fixture to the local database; no testnet coins are needed and no transaction is sent. Tokens and private keys are not printed.

For native smoke testing: launch the development app, complete onboarding with a disposable wallet, unlock, open Wallets and More Options, and select testnet before testing network functionality. An API smoke pass does not prove wallet backup/recovery or a real signing transaction.

## What works locally

| Capability | Scope |
| --- | --- |
| Mongo, relay app records | Local persistence and API create/read checks |
| Channel | Socket.IO connection handshake |
| Server Key | V3 testnet setup, public-key derivation, valid/invalid 2FA and persistence |
| Email | Captured inside signing volume at `/local-data/outbox.jsonl`; never delivered |
| Push, purchases, Ask Keeper AI, faucet, price feeds | Unavailable; relay reports unsupported routes explicitly |
| Scheduled signing / inheritance jobs | Disabled; timer-dependent flows are not covered |
| Blockchain / Electrum | Separate mobile internet connection; not provided by this stack |
| Legacy V2 Server Key | Not supported by this acceptance check; a V2 setup probe terminated the pinned upstream process (see verification notes) |

The relay health field `signing: false` describes the relay, not the separate signing service. Use each service's health endpoint. No production service deployment is performed.

## Sources, data and network boundaries

`sources.lock.json` pins both backend revisions and adapter SHA-256 checksums. The Node, Mongo and nginx base images are pinned by digest. Backend dependency installs use frozen Yarn / npm lockfiles; OS packages in the relay build still use Debian repositories, so this is a reproducible development workflow, not a bit-for-bit reproducible image build.

`adapters/` contains the local-mode modifications prepared on this Mac for maintainer review. Patches apply to their pinned source; replacement config files avoid distributing removed historical credential text in patch deletions. `.sources/` is generated and ignored. Bootstrap never overwrites an existing checkout; reruns preserve local backend edits. After editing a backend, rerun `up` to rebuild. To change pins/adapters, save your backend edits and move the generated checkout aside first. Eventually merge local-mode support into the backend repositories and replace adapters with those reviewed commit IDs. Do not deploy these development adapters to production.

Only the gateway publishes host ports, all on `127.0.0.1`. Mongo, relay and signing share an internal network with no external egress; the gateway also has a host-access network. Compose waits on service health, following [Docker's startup ordering](https://docs.docker.com/compose/how-tos/startup-order/). Build-time dependency downloads still use the internet. Mobile native integrations are outside Docker; this is not a fully offline mobile mode.

Signing identities are randomly generated per signing volume and stored with restricted permissions. Use disposable test wallets. Keep the Mongo and signing volumes together: deleting signing keys invalidates their stored Server Key records. There is deliberately no automatic reset/delete command. `docker compose down --volumes` is destructive and not part of normal setup. Do not distribute databases, keys, email captures, `.env` files or native signing credentials with the source.

## Troubleshooting

- Docker unavailable: start Docker Desktop or Colima, then rerun `doctor`.
- Relay repository access denied: request approved read access and rerun `prepare`; no application secret is needed. SigningServer fetch failures should be checked against its public pinned revision and network connection.
- Stale source/adapter marker: save edits and move the relevant `.sources/relay` or `.sources/signing` directory aside. Bootstrap refuses to overwrite it.
- Health succeeds but a feature fails: consult the capability table; cloud integrations are not restored by local startup.
- App cannot reach local services: check `.env.local`, rebuild with `ENVFILE=.env.local`, and rerun Android port forwarding. Changing an env file requires a native rebuild.
- Xcode reports a missing Node executable: inspect the ignored `ios/.xcode.env.local`; CocoaPods may have cached a version-specific path removed by a Node upgrade. Update its `NODE_BINARY` to your current executable and rebuild.
- If several Metro servers are running, select the one for this checkout on each device. Android emulator defaults can bypass USB forwarding via `10.0.2.2`; set its debug server host to `localhost:8081` when using `adb reverse`.
- iOS pod install fails under system Ruby: select the repo's Ruby version and root Bundler environment. Do not run an unrelated globally installed CocoaPods.
- Memory pressure: build iOS and Android sequentially, limit Gradle workers, and shut down unused simulators without erasing their data.
