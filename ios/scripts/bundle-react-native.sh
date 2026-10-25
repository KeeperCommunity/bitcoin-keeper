#!/bin/sh
set -eu

# React Native's with-environment.sh has resolved .xcode.env and its local override.
# Verify that selected executable, then preserve it for the actual bundle phase.
keeper_app_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
: "${NODE_BINARY:?React Native must resolve NODE_BINARY before bundling}"
"$NODE_BINARY" "$keeper_app_root/scripts/verify-node-runtime.cjs"
exec "$keeper_app_root/node_modules/react-native/scripts/react-native-xcode.sh"
