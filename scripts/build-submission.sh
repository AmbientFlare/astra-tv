#!/usr/bin/env bash
# Builds the Amazon submission package.
#
# `npm run build:release` omits --build-number, which leaves build_number 0 in
# the package. That sideloads fine, but Amazon rejects it:
#
#   Error 1: build_number must be greater than 0, found: 0
#
# Both numbers are derived from src/config/app.ts so they cannot drift from
# what the app shows on its About page: BUILD_NUMBER "20260829.12" becomes the
# Vega package build number 2026082912.
set -euo pipefail

cd "$(dirname "$0")/.."

# Run directly (not via `npm run build:submission`), npm's prebuild:submission
# hook never fires, so do it here too: every release must carry a telemetry
# operator config, armable on-device, regardless of how the build was invoked.
node scripts/prepare-telemetry.cjs

OPERATOR_FILE=src/services/telemetry/operator.generated.ts
if ! grep -q '"endpoint":"http' "$OPERATOR_FILE" 2>/dev/null; then
    echo "Telemetry operator config is blank; this build could never be armed." >&2
    echo "Set ASTRA_TELEMETRY_ENV/.telemetry.env or ASTRA_TELEMETRY_CONFIG first." >&2
    exit 1
fi

APP_VERSION=$(sed -n "s/^export const APP_VERSION = '\(.*\)';$/\1/p" src/config/app.ts)
BUILD_MARKER=$(sed -n "s/^export const BUILD_NUMBER = '\(.*\)';$/\1/p" src/config/app.ts)

if [ -z "$APP_VERSION" ] || [ -z "$BUILD_MARKER" ]; then
    echo "Could not read APP_VERSION / BUILD_NUMBER from src/config/app.ts" >&2
    exit 1
fi

# "20260829.12" -> "2026082912". The sequence is zero-padded to two digits so
# .1 and .12 keep a consistent width and stay monotonically increasing.
BUILD_DATE=${BUILD_MARKER%%.*}
BUILD_SEQ=${BUILD_MARKER##*.}
VEGA_BUILD_NUMBER=$(printf '%s%02d' "$BUILD_DATE" "$BUILD_SEQ")

echo "Building Astra $APP_VERSION"
echo "  app build marker:  $BUILD_MARKER"
echo "  vega build number: $VEGA_BUILD_NUMBER"
echo

rm -f build/x86_64-release/astra_x86_64.vpkg

npx react-native build-vega \
    --build-type Release --target x86_64 \
    --build-number "$VEGA_BUILD_NUMBER" \
    --build-version "$APP_VERSION"

# build-vega can exit 0 having written the JS bundle but no package, so verify
# the artifact rather than trusting the exit code.
if [ ! -f build/x86_64-release/astra_x86_64.vpkg ]; then
    echo "Build reported success but produced no package." >&2
    exit 1
fi

ACTUAL=$(sed -n 's/.*"build_number": \([0-9]*\).*/\1/p' build/x86_64-release/vpkg-info.json)
if [ "$ACTUAL" != "$VEGA_BUILD_NUMBER" ]; then
    echo "Package build_number is '$ACTUAL', expected '$VEGA_BUILD_NUMBER'." >&2
    exit 1
fi

echo
echo "Package: build/x86_64-release/astra_x86_64.vpkg"
cat build/x86_64-release/vpkg-info.json
