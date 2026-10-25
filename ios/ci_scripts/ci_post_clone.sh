#!/bin/sh
set -eu

# The runner supplies the supported Node, Yarn Classic and locked Ruby toolchain.
# Do not install/link a global runtime or edit dependencies on a shared Mac.
keeper_app_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$keeper_app_root"
NODE_BINARY=${NODE_BINARY:-$(command -v node || true)}
: "${NODE_BINARY:?Configure Node 22.23.4 or a later stable Node 22 patch}"
"$NODE_BINARY" scripts/verify-node-runtime.cjs
NODE_BINARY=$("$NODE_BINARY" -p 'process.execPath')
export NODE_BINARY
PATH="$(dirname -- "$NODE_BINARY"):$PATH"
export PATH
test "$(yarn --version)" = '1.22.22'

yarn install --frozen-lockfile --non-interactive
./node_modules/.bin/patch-package --error-on-fail
git diff --exit-code HEAD -- package.json yarn.lock Gemfile.lock ios/Podfile.lock

export BUNDLE_GEMFILE="$keeper_app_root/Gemfile"
export BUNDLE_FROZEN=true
bundle install
(cd ios && RCT_NEW_ARCH_ENABLED=1 bundle exec pod install --deployment)
git diff --exit-code HEAD -- package.json yarn.lock Gemfile.lock ios/Podfile.lock
