const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
    extraNodeModules: {
      buffer: require.resolve('buffer/'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      process: require.resolve('process/browser'),
      events: require.resolve('events/'),
      http: require.resolve('http-browserify'),
      https: require.resolve('https-browserify'),
      zlib: require.resolve('browserify-zlib'),
      util: require.resolve('util/'),
      url: require.resolve('url/'),
      path: require.resolve('path-browserify'),
    },
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(defaultConfig, config);
