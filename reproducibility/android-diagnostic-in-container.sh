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
    return 1
  fi
}

metadata_mode=${KEEPER_GRADLE_VERIFICATION_METADATA:-0}
[[ $metadata_mode == 0 || $metadata_mode == 1 ]] || {
  echo 'Invalid Gradle metadata mode.' >&2
  exit 2
}
metadata_path=android/gradle/verification-metadata.xml
if [[ $metadata_mode == 1 ]]; then
  [[ ! -e $metadata_path && ! -L $metadata_path ]] || {
    echo 'Gradle verification metadata already exists; bootstrap requires a source without it.' >&2
    exit 1
  }
fi

export GRADLE_USER_HOME=/tmp/keeper-gradle
export YARN_CACHE_FOLDER=/tmp/keeper-yarn
export ANDROID_USER_HOME=/tmp/keeper-android-user
export GRADLE_OPTS='-Duser.home=/tmp/keeper-user'
mkdir -p "$GRADLE_USER_HOME" "$YARN_CACHE_FOLDER" "$ANDROID_USER_HOME" \
  /tmp/keeper-user "$HOME" "$NPM_CONFIG_CACHE" "$XDG_CACHE_HOME"

diagnostic_env=$(mktemp /tmp/keeper-diagnostic.XXXXXX)
cleanup() {
  rm -f "$diagnostic_env"
  if [[ $metadata_mode == 1 ]]; then
    rm -f "$metadata_path"
  fi
}
trap cleanup EXIT
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
if [[ $metadata_mode == 1 ]]; then
  gradle_status=0
  printf '%s\n' "$KEEPER_SOURCE_COMMIT" > /output/SOURCE_COMMIT.txt
  (
    cd android
    ./gradlew --write-verification-metadata sha256 \
      :app:assembleProductionRelease :app:bundleProductionRelease \
      -PMYAPP_RELEASE_STORE_FILE="$repo/android/app/debug.keystore" \
      -PMYAPP_RELEASE_STORE_PASSWORD=android \
      -PMYAPP_RELEASE_KEY_ALIAS=androiddebugkey \
      -PMYAPP_RELEASE_KEY_PASSWORD=android \
      --no-daemon --console=plain
  ) || gradle_status=$?
  if [[ -s $metadata_path ]]; then
    if ! python3 - "$metadata_path" <<'PY'
import sys
import xml.etree.ElementTree as ET

root = ET.parse(sys.argv[1]).getroot()
namespace = 'https://schema.gradle.org/dependency-verification'
if root.tag != f'{{{namespace}}}verification-metadata':
    raise SystemExit('Unexpected Gradle verification metadata root element')
if not root.findall(f'.//{{{namespace}}}sha256'):
    raise SystemExit('Gradle verification metadata contains no SHA-256 checksums')
PY
    then
      printf 'INCOMPLETE: Gradle metadata was invalid. Do not use this candidate.\n' > /output/STATUS.txt
      exit 1
    fi
    cp "$metadata_path" /output/gradle-verification-metadata.xml
    (
      cd /output
      sha256sum gradle-verification-metadata.xml > SHA256SUMS
    )
  fi
  if ((gradle_status != 0)); then
    printf 'INCOMPLETE: Gradle exited %d. Do not use this candidate as complete verification metadata.\n' "$gradle_status" > /output/STATUS.txt
    exit "$gradle_status"
  fi
  if [[ ! -s /output/gradle-verification-metadata.xml ]]; then
    printf 'INCOMPLETE: Gradle produced no verification metadata.\n' > /output/STATUS.txt
    exit 1
  fi
  if ! assert_tracked_source_clean; then
    printf 'INCOMPLETE: Build tooling changed tracked source files.\n' > /output/STATUS.txt
    exit 1
  fi
  printf 'CANDIDATE: Build succeeded with placeholder values and debug signing. Review every checksum before enabling verification.\n' > /output/STATUS.txt
  exit 0
fi
(
  cd android
  ./gradlew :app:assembleProductionRelease :app:bundleProductionRelease \
    -PMYAPP_RELEASE_STORE_FILE="$repo/android/app/debug.keystore" \
    -PMYAPP_RELEASE_STORE_PASSWORD=android \
    -PMYAPP_RELEASE_KEY_ALIAS=androiddebugkey \
    -PMYAPP_RELEASE_KEY_PASSWORD=android \
    --no-daemon --console=plain
)
assert_tracked_source_clean

apk=android/app/build/outputs/apk/production/release/app-production-release.apk
aab=android/app/build/outputs/bundle/productionRelease/app-production-release.aab
test -s "$apk"
test -s "$aab"
"$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner" verify "$apk"
badging=$("$ANDROID_SDK_ROOT/build-tools/35.0.0/aapt2" dump badging "$apk")
version_fields=$(python3 - <<'PY'
import json
from pathlib import Path

metadata = json.loads(Path('android/app/build/outputs/apk/production/release/output-metadata.json').read_text())
elements = metadata['elements']
if metadata['applicationId'] != 'io.hexawallet.bitcoinkeeper' or len(elements) != 1:
    raise SystemExit('Unexpected Android APK output metadata')
element = elements[0]
if not isinstance(element['versionCode'], int) or not isinstance(element['versionName'], str) or not element['versionName']:
    raise SystemExit('Android APK output metadata has no valid version')
print(element['versionCode'])
print(element['versionName'])
PY
)
version_code=${version_fields%%$'\n'*}
version_name=${version_fields#*$'\n'}
[[ $version_code =~ ^[0-9]+$ && -n $version_name && $version_name != "$version_fields" ]] || {
  echo 'Android APK output metadata has no valid version.' >&2
  exit 1
}
grep -Fq "package: name='io.hexawallet.bitcoinkeeper' versionCode='$version_code' versionName='$version_name'" <<< "$badging"
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
