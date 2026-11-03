#!/bin/sh
set -eu

# Yarn's prepare hook runs on Android-only machines too. Keep it platform neutral;
# CocoaPods and the Android SDK are configured explicitly in dev/local-backend/README.md.
rn-nodeify --install buffer,events,process,stream,inherits,path,assert,crypto --hack --yarn
