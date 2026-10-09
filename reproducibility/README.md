# Android reproducibility status

This directory records the inputs needed to compare a Bitcoin Keeper Android
release with a build from its public source. The comparison tool in
[`scripts/compare-android-apks.py`](../scripts/compare-android-apks.py) is an
inspection aid. It is **not** a WalletScrutiny build script, and this repository
does not yet establish a reproducibility verdict for v2.6.3.

## Independent Linux diagnostic build

[`android-diagnostic.sh`](android-diagnostic.sh) builds a production-flavor APK
and AAB in a disposable Linux container using deliberately invalid service
endpoints and the checked-in debug signing key. It needs Docker, a clean
checkout without `node_modules`, and an empty output directory outside the
checkout. Run it with the exact source commit you intend to inspect:

```sh
bash reproducibility/android-diagnostic.sh \
  --source-commit "$(git rev-parse HEAD)" \
  --output-dir /tmp/keeper-android-diagnostic
```

The script records the toolchain image ID and writes only the diagnostic APK,
AAB, and their `SHA256SUMS` to the output directory. It never writes a
`COMPARISON_RESULTS.yaml` or reports a reproducibility verdict. Its CI workflow
builds on a clean Ubuntu runner when a `codex/android-repro*` branch is pushed
or a pull request targets a main development or release branch. No release
artifact is uploaded by that workflow.

The container uses a digest-pinned **linux/amd64** Temurin JDK 17.0.19 base.
Node 22.23.3, Yarn 1.22.22, and Android command-line tools downloads have
checked SHA-256 hashes. The existing input checker then verifies the exact
Node, Yarn, Java, Android SDK package revisions, Gradle wrapper hash, lockfile
hash, environment **names**, and local dependency layout before Gradle builds.
Gradle and Yarn caches and Gradle's Maven-local home are isolated inside each
container run. The Android platform, Build-Tools, NDK, and CMake archives are
selected by fixed Google URLs and checked by SHA-256 before unpacking. The
archive names, sizes, and Google-published SHA-1 values were checked against
[Google's SDK repository index](https://dl.google.com/android/repository/repository2-1.xml)
before recording the SHA-256 values. The input checker also verifies their
installed revisions. Ubuntu apt packages,
Maven artifacts, and transitive native downloads still lack recorded hashes.
Those are remaining build-input gaps. The script is therefore an independent
**diagnostic build path**, not a final WalletScrutiny recipe.

The placeholder configuration cannot establish whether a distributed APK or
Play split matches this source. The seven-name environment allowlist in
`android-inputs.json` remains provisional: this source still references
GasFree and exchange configuration, including `LETS_EXCHANGE_BASE_URL`, and
`react-native-config` can embed every supplied key. The actual release input
set must be reviewed before building for comparison. Do not substitute the
development defaults or treat this diagnostic APK as a usable release.

## v2.6.3 reference and measured result

The public source tag is [`v2.6.3`](https://github.com/KeeperCommunity/bitcoin-keeper/releases/tag/v2.6.3),
commit `872cbc4b16ddcb0a8f3b5b1d7ebcde28e06ed096`. The GitHub release APK
`Bitcoin_Keeper_v2.6.3.apk` has SHA-256
`a20d934ebd80ece779d3c171c7906bb4aff010337989ec1b826cab55c50eba46`.
Its package is `io.hexawallet.bitcoinkeeper`, version `2.6.3`, version code
`626`.

An isolated build of that tag with a placeholder production configuration and
the checked-in debug signing key produced a valid 2.6.3 APK. Its SHA-256 was
`cc4102251a11cbbfa104808adc4906a3a0e3b2efd9a14ab0785d66f5c9d5143b`.
Comparing uncompressed APK entries found **1,424 matching payload entries and
192 differences**: one manifest, one baseline profile, one Hermes bundle, five
DEX files, 56 native libraries, and 128 resources. The placeholder
configuration and different build environment can affect these files. This is
a diagnostic mismatch, not evidence that the published binary was built from
different source. The measured result and remaining work are tracked in
[#6097](https://github.com/KeeperCommunity/bitcoin-keeper/issues/6097).

For an SDK 33, arm64-v8a, xxhdpi, English-only profile, the four official
Play-generated APKs were also retrieved and verified. All 42 corresponding
code entries (six DEX files, Hermes, and 35 arm64 libraries) match the GitHub
release APK byte for byte. This establishes published-channel code parity for
that profile, not a rebuild from public source. A rebuilt AAB and split-set
comparison are still needed.

| Play split | SHA-256 |
| --- | --- |
| SDK 29+ base | `e384b966359aa4937bf4353316ddda471adf1e17f6bb08fe53f9945e8ea9bc1d` |
| arm64-v8a | `11740257e813455501301d5dc0f9870dc476e15947d912523e051d9a3400ab8c` |
| xxhdpi | `da3b93b89e98cff52bbea6c593fc26193139d53f400139ebd44ac51118f08195` |
| English | `a5cae92f6e9c2d725bcf8fc3ebcfb397573fda38e1413dde7e40c395430f0a73` |

## Compare two APKs

Run with Python 3 and no extra packages:

```sh
python3 scripts/compare-android-apks.py published.apk rebuilt.apk > comparison.json
```

Exit code 0 means all **uncompressed ZIP file entries** match after the narrow
signing exceptions below. Exit code 1 means at least one payload difference;
exit code 2 means invalid input. JSON includes whole-APK SHA-256 hashes, entry
counts, and every changed, added, or removed file path. ZIP directory records,
compression, entry order, and APK v2/v3 signing blocks are outside this payload
comparison. The tool assumes its inputs are APKs; verify their signatures,
package names, and versions separately.

The only exempt entries are root-level JAR/v1 signature material
(`META-INF/MANIFEST.MF`, `META-INF/*.SF`, `*.RSA`, `*.DSA`, `*.EC`) and Play's
root `stamp-cert-sha256`. Their differences still appear in
`ignored_signing_entries`. DEX, Hermes, native libraries, manifests, resource
tables and files, baseline profiles, other assets, and other `META-INF` files
remain comparison-critical. A payload match does not authenticate either
signer or prove that the APK came from the claimed source.

Synthetic tests cover signing exceptions, each payload category, added and
removed files, duplicate ZIP paths, and CLI exit codes:

```sh
python3 -m unittest scripts/test_compare_android_apks.py
```

Compare one APK with one APK. Google Play delivers APKs generated from an AAB;
a Play base split cannot be equated with a standalone GitHub APK. Play
verification needs the complete delivered split set and corresponding splits
from a rebuilt AAB, with transformations examined separately.

## Inputs needed for an independent build

The tagged production lane requires an ignored `.env.production`. Its exact
v2.6.3 contents are not public. Names-only inspection of the published APK
found 13 environment-derived fields in `BuildConfig`. `react-native-config`
embeds supplied environment values in Android build outputs, including fields
outside the app's TypeScript configuration object. Placeholder values cannot
support an exact payload verdict. Some fields appear credential-bearing and
require owner security review before public build inputs are released; do not
commit an unchecked production environment file.

The source pins Gradle wrapper 8.14.3, Android Gradle Plugin 8.8.0, Android
SDK/target 36, Build Tools 35.0.0, NDK 27.1.12297006, and React Native
0.83.9. The locked Realm dependency requests CMake 3.22.1. The dependency
tree is recorded in `yarn.lock` and checked-in `patch-package` patches. The
successful diagnostic used Node
22.23.3, Yarn 1.22.22, and JDK 17.0.19; these are measured diagnostic inputs,
not a claim about the publisher's complete toolchain. A third-party recipe
still needs a digest-pinned Linux container image, exact JDK/Node/Yarn and SDK
package checksums, a fixed checkout and dependency layout, and verified build
commands. The Gradle wrapper now has a distribution checksum pin, but the
Android project has no dependency lock or verification metadata. The published
Hermes bundle contains a Node 25.9.0
literal injected by `rn-nodeify` and a path through a sibling
`keeper-release-2.5.15/node_modules` directory. These historical build inputs
must be investigated; copying them into a future release recipe would not by
itself reproduce v2.6.3. Realm and Screens also have native executable/data
differences in the placeholder rebuild.

For the Android-only path, the diagnostic installed JavaScript packages with
`yarn install --frozen-lockfile --ignore-scripts`, then ran the checked-in
`patch-package` patches and the Android `rn-nodeify` step before invoking
`./gradlew :app:assembleProductionRelease`. The root `setup.sh` cannot serve
as a Linux build recipe unchanged: it runs iOS CocoaPods and writes a macOS SDK
path. A future container recipe needs a Linux `local.properties`, the verified
production environment input, and a disposable signing identity. It should
also run `:app:bundleProductionRelease` for Play split comparisons. These
commands describe the diagnostic path; they are not a complete reproducible
build recipe.

The release Fastlane lane validates time-sensitive store baselines and uploads
an AAB to Play. An independent verifier should build locally without store
access or upload. It can use a disposable signing key and compare payloads
while explicitly accounting for signing differences. A complete recipe must
then build the production APK and AAB under pinned tools and compare the
actual distributed artifacts.

## Check the seven future build values against a public APK

The seven names in `android-inputs.json` are already present as string
resources in the authenticated public v2.6.3 APK. The
[`audit-apk-build-values.py`](audit-apk-build-values.py) tool checks that an
APK matches a supplied SHA-256, that each of those seven fields has one plain
production value, and optionally that a seven-field candidate `.env` file
matches them exactly. It prints field names on a mismatch but never prints,
exports, or writes their values. It ignores all other historical APK fields,
including old credential-bearing fields. Keep any candidate environment file
outside Git.

The expected digest must come from a trusted release check, not from the same
untrusted APK being inspected. For the PGP-verified
[v2.6.3 GitHub release APK](https://github.com/KeeperCommunity/bitcoin-keeper/releases/tag/v2.6.3),
run:

```sh
python3 reproducibility/audit-apk-build-values.py \
  --apk /path/to/Bitcoin_Keeper_v2.6.3.apk \
  --expected-apk-sha256 a20d934ebd80ece779d3c171c7906bb4aff010337989ec1b826cab55c50eba46 \
  --aapt2 /path/to/android-sdk/build-tools/35.0.0/aapt2 \
  --env-file /path/outside/repository/to/candidate.env
```

Omit `--env-file` to check APK field presence only. Candidate entries must be
simple `KEY=value` lines with exactly the seven approved names. A mismatch can
indicate an intentional endpoint or identifier change; the release engineer
must confirm it before using that candidate. This check neither reconstructs
the complete historical v2.6.3 `.env.production` nor proves that a release was
built from public source. Run its focused tests with:

```sh
python3 -m unittest reproducibility/test_audit_apk_build_values.py
```

[WalletScrutiny's script rules](https://github.com/WalletScrutiny/WalletScrutinyCom/blob/master/docs/script_verifications.md)
require Docker, Podman, or Nix; a script ending in `build.sh`; a `--binary`
argument; and an adjacent `COMPARISON_RESULTS.yaml`. The diagnostic script
above intentionally has a different interface and no results file because the
exact production input and complete third-party comparison are not established.

## Fail closed on future build inputs

`android-inputs.json` pins the Node, Yarn, JDK, Gradle wrapper, lockfile, and
Android SDK package versions chosen for the next independent build attempt.
These are **chosen future inputs**, not a reconstruction of the v2.6.3
publisher's environment. Before any production build, run:

```sh
python3 reproducibility/verify-android-inputs.py \
  --source-commit <reviewed-40-character-commit> \
  --env-file /path/to/reviewed/.env.production \
  --android-sdk-root /path/to/android-sdk
```

The tracked manifest contains seven environment names and no values. This is a
**provisional future-release allowlist**: GasFree and exchange configuration
still exist in this source, and candidate omissions need review before using it
for a release. Changing the list requires a tracked source change. The checker rejects
missing or extra names, a dirty or wrong source checkout, changed dependency
hashes, mismatched tool versions, missing SDK packages, a symlinked
`node_modules` root, and links from dependencies to files outside the checkout.
It does not output environment values. A local dependency install is necessary;
linking to a sibling `node_modules` directory recreates an observed historical
build-path dependency and fails this check.

This check does not yet pin the container image, Android command-line tools
download, Maven artifacts, or every transitive native input. It does not run
the build or compare a binary and is not a WalletScrutiny `build.sh`. The exact
production environment names and values still need release-owner review before
any public recipe or verdict. Run its focused tests with:

```sh
python3 -m unittest reproducibility/test_verify_android_inputs.py
```
