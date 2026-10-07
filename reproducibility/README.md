# Android reproducibility status

This directory records the inputs needed to compare a Bitcoin Keeper Android
release with a build from its public source. The comparison tool in
[`scripts/compare-android-apks.py`](../scripts/compare-android-apks.py) is an
inspection aid. It is **not** a WalletScrutiny build script, and this repository
does not yet establish a reproducibility verdict for v2.6.3.

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

[WalletScrutiny's script rules](https://github.com/WalletScrutiny/WalletScrutinyCom/blob/master/docs/script_verifications.md)
require Docker, Podman, or Nix; a script ending in `build.sh`; a `--binary`
argument; and an adjacent `COMPARISON_RESULTS.yaml`. No such script or results
file is included here because the exact production input and complete
third-party build path have not yet been established.
