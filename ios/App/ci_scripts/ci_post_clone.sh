#!/bin/sh
# Xcode Cloud post-clone script.
#
# Capacitor's iOS Swift Package Manager integration
# (ios/App/CapApp-SPM/Package.swift) references its plugins by *local*
# file-system path into node_modules - e.g.
# "../../../node_modules/@capacitor/app" - rather than a registry package.
# Xcode Cloud only clones the git repo; it never runs `npm install` on its
# own, so those node_modules directories don't exist yet by the time Xcode
# Cloud tries to resolve Swift packages, and the build fails at "Could not
# resolve package dependencies" before any of our code even compiles.
#
# Xcode Cloud automatically runs any executable script named
# ci_post_clone.sh that it finds in a ci_scripts folder next to the
# .xcodeproj, immediately after cloning the repo and before package
# resolution - so installing npm dependencies here is exactly what's needed
# to make those local SPM package paths resolve.
set -e

# This script lives at ios/App/ci_scripts/, so the repo root is three
# directories up.
cd "$(dirname "$0")/../../.."

echo "ci_post_clone.sh: installing npm dependencies so Capacitor's local SPM packages resolve..."
npm ci
