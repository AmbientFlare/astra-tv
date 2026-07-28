const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

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
