#!/usr/bin/env bash
set -euo pipefail

repo=/workspace/keeper
cd "$repo"
[[ -n ${KEEPER_SOURCE_COMMIT:-} ]] || { echo 'Expected source commit is missing.' >&2; exit 1; }
[[ $(git rev-parse HEAD) == "$KEEPER_SOURCE_COMMIT" ]] || {
  echo 'Checkout HEAD differs from the requested source commit.' >&2
  exit 1
}
[[ -z $(git status --porcelain=v1 --untracked-files=normal) ]] || {
  echo 'Source checkout must be clean.' >&2
  exit 1
}
[[ ! -e node_modules && ! -L node_modules ]] || {
  echo 'This build needs an empty dependency tree.' >&2
  exit 1
}

assert_tracked_source_clean() {
  if ! git diff --quiet -- . || ! git diff --cached --quiet -- .; then
    echo 'Build tooling changed tracked source files.' >&2
    exit 1
  fi
}

export GRADLE_USER_HOME=/tmp/keeper-gradle
export YARN_CACHE_FOLDER=/tmp/keeper-yarn
export ANDROID_USER_HOME=/tmp/keeper-android-user
export GRADLE_OPTS='-Duser.home=/tmp/keeper-user'
mkdir -p "$GRADLE_USER_HOME" "$YARN_CACHE_FOLDER" "$ANDROID_USER_HOME" \
  /tmp/keeper-user "$HOME" "$NPM_CONFIG_CACHE" "$XDG_CACHE_HOME"

diagnostic_env=$(mktemp /tmp/keeper-diagnostic.XXXXXX)
trap 'rm -f "$diagnostic_env"' EXIT
cat > "$diagnostic_env" <<'EOF'
CHANNEL_URL=https://example.invalid/
ENVIRONMENT=PRODUCTION
HEXA_ID_MAINNET=0000000000000000000000000000000000000000000000000000000000000000
HEXA_ID_TESTNET=0000000000000000000000000000000000000000000000000000000000000000
RELAY=https://example.invalid/
SIGNING_SERVER_MAINNET=https://example.invalid/
SIGNING_SERVER_TESTNET=https://example.invalid/
EOF

yarn install --frozen-lockfile --ignore-scripts --non-interactive
python3 reproducibility/verify-android-inputs.py \
  --source-commit "$KEEPER_SOURCE_COMMIT" \
  --env-file "$diagnostic_env" \
  --android-sdk-root "$ANDROID_SDK_ROOT"

./node_modules/.bin/patch-package
./node_modules/.bin/rn-nodeify --install buffer,events,process,stream,inherits,path,assert,crypto --hack --yarn
assert_tracked_source_clean
printf 'sdk.dir=%s\n' "$ANDROID_SDK_ROOT" > android/local.properties

export ENVFILE="$diagnostic_env"
export KEEPER_ANDROID_KEYSTORE="$repo/android/app/debug.keystore"
export STORE_PASSWORD=android
export KEY_ALIAS=androiddebugkey
export KEY_PASSWORD=android
(
  cd android
  ./gradlew :app:assembleProductionRelease :app:bundleProductionRelease --no-daemon --console=plain
)
assert_tracked_source_clean

apk=android/app/build/outputs/apk/production/release/app-production-release.apk
aab=android/app/build/outputs/bundle/productionRelease/app-production-release.aab
test -s "$apk"
test -s "$aab"
"$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner" verify "$apk"
badging=$("$ANDROID_SDK_ROOT/build-tools/35.0.0/aapt2" dump badging "$apk")
version=$(node -p 'require("./release/version.json").version')
version_code=$(node -p 'require("./release/version.json").androidVersionCode')
grep -Fq "package: name='io.hexawallet.bitcoinkeeper' versionCode='$version_code' versionName='$version'" <<< "$badging"
jarsigner -verify -verbose -certs "$aab" > /tmp/keeper-aab-signature.log 2>&1
grep -Fxq 'jar verified.' /tmp/keeper-aab-signature.log
if grep -Fq '? = unsigned entry' /tmp/keeper-aab-signature.log; then
  echo 'Diagnostic AAB contains unsigned entries.' >&2
  exit 1
fi
unzip -tq "$apk" >/dev/null
unzip -tq "$aab" >/dev/null

cp "$apk" /output/Bitcoin_Keeper_DIAGNOSTIC.apk
cp "$aab" /output/Bitcoin_Keeper_DIAGNOSTIC.aab
(
  cd /output
  sha256sum Bitcoin_Keeper_DIAGNOSTIC.apk Bitcoin_Keeper_DIAGNOSTIC.aab > SHA256SUMS
)
echo 'Diagnostic APK/AAB built with placeholder values and debug signing; no reproducibility verdict.'
