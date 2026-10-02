#!/usr/bin/env bash
# Builds a signed Android release APK, always starting from a fresh web
# build + Capacitor sync - this exists specifically because a release APK
# was once built straight from `./gradlew assembleRelease` without that
# sync step first, shipping web assets from over a month earlier (missing
# the Terms of Use acceptance flow by then required by the backend) to two
# testers. Run this instead of calling gradlew directly, and that class of
# bug can't happen again: npm run build + npx cap sync always run first,
# every time, in the right order.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> [1/3] Building web assets (npm run build)..."
npm run build

echo "==> [2/3] Syncing into the Android project (npx cap sync android)..."
npx cap sync android

# Quick, cheap sanity check: confirm the just-synced assets actually look
# current rather than silently stale, by comparing the synced index.html's
# mtime against dist/index.html's. They should be seconds apart - if the
# synced copy is meaningfully older, something upstream of this script is
# fishy (e.g. cap sync silently no-op'd) and it's worth investigating
# before trusting the APK this produces.
DIST_MTIME=$(stat -f '%m' dist/index.html 2>/dev/null || stat -c '%Y' dist/index.html)
SYNCED_MTIME=$(stat -f '%m' android/app/src/main/assets/public/index.html 2>/dev/null || stat -c '%Y' android/app/src/main/assets/public/index.html)
DIFF=$(( SYNCED_MTIME - DIST_MTIME ))
if [ "${DIFF#-}" -gt 60 ]; then
  echo "WARNING: synced index.html is more than 60s older/newer than the fresh dist/ build (diff: ${DIFF}s)."
  echo "         This script didn't fail, but double-check the Android assets look current before distributing."
fi

echo "==> [3/3] Building the signed release APK..."
cd android

# Terminal doesn't always have a system Java on PATH (Android Studio
# bundles its own), so fall back to Android Studio's JDK if JAVA_HOME
# isn't already set.
if [ -z "${JAVA_HOME:-}" ]; then
  if [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  elif [ -d "/Applications/Android Studio.app/Contents/jre/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jre/Contents/Home"
  fi
fi

./gradlew assembleRelease

echo ""
echo "Done. Signed APK at:"
echo "  android/app/build/outputs/apk/release/app-release.apk"
