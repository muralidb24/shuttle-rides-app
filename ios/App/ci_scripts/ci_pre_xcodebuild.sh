#!/bin/sh
# Xcode Cloud pre-xcodebuild script.
#
# Xcode Cloud has its own server-side "manage the build number for me"
# mechanism, and it's what's been quietly setting CFBundleVersion on every
# CI-delivered build so far (project.pbxproj's CURRENT_PROJECT_VERSION
# hasn't needed to change since manual archiving stopped). It just failed
# with "The bundle version must be higher than the previously uploaded
# version" - an edge case where Apple's own auto-increment didn't actually
# compute a higher number.
#
# CI_BUILD_NUMBER is an environment variable Xcode Cloud sets on every
# workflow run, guaranteed unique and strictly increasing for this app
# across every run (not just successful ones). Setting
# CURRENT_PROJECT_VERSION to it directly - which is exactly the mechanism
# Apple documents for this purpose, see
# https://developer.apple.com/documentation/xcode/setting-the-next-build-number-for-xcode-cloud-builds
# - removes any dependency on the server-side guesswork that just failed,
# so this class of failure shouldn't be able to happen again.
set -e
set -x

# This script lives at ios/App/ci_scripts/, so the repo root is three
# directories up.
cd "$(dirname "$0")/../../.."

PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"

if [ -n "$CI_BUILD_NUMBER" ]; then
  echo "ci_pre_xcodebuild.sh: setting CURRENT_PROJECT_VERSION to $CI_BUILD_NUMBER"
  sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $CI_BUILD_NUMBER;/g" "$PBXPROJ"
else
  echo "ci_pre_xcodebuild.sh: CI_BUILD_NUMBER not set (not running on Xcode Cloud?), leaving CURRENT_PROJECT_VERSION as-is"
fi
