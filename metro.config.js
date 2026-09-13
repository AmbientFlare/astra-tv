const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Every bundle Metro produces — release, debug, submission, `npm start` —
// goes through this file no matter which script or raw CLI command invoked
// it. Running the telemetry-operator step here (rather than only from
// package.json pre-hooks a direct `npx react-native build-vega` skips) is
// what actually makes the requirement unconditional.
require('./scripts/prepare-telemetry.cjs');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // `reference/` holds cloned sample apps kept for research only; it is
    // gitignored and never bundled. Metro would otherwise crawl it and fail on
    // Haste collisions — several Amazon samples ship an identically named
    // plugins/eslint-plugin-amzn-a11y/package.json.
    blockList: [/(^|[/\\])reference[/\\].*/],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
