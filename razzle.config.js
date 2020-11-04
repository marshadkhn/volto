const path = require('path');
const makeLoaderFinder = require('razzle-dev-utils/makeLoaderFinder');
const nodeExternals = require('webpack-node-externals');
const LoadablePlugin = require('@loadable/webpack-plugin');
const LodashModuleReplacementPlugin = require('lodash-webpack-plugin');
const fs = require('fs');
const RootResolverPlugin = require('./webpack-root-resolver');
const createAddonsLoader = require('./create-addons-loader');
const AddonConfigurationRegistry = require('./addon-registry');

const fileLoaderFinder = makeLoaderFinder('file-loader');
const babelLoaderFinder = makeLoaderFinder('babel-loader');

const projectRootPath = path.resolve('.');
const languages = require('./src/constants/Languages');

const packageJson = require(path.join(projectRootPath, 'package.json'));

const registry = new AddonConfigurationRegistry(projectRootPath);

const defaultModify = ({
  env: { target, dev },
  webpackConfig: config,
  webpackObject: webpack,
}) => {
  if (dev) {
    config.plugins.unshift(
      new webpack.DefinePlugin({
        __DEVELOPMENT__: true,
      }),
    );
  } else {
    config.plugins.unshift(
      new webpack.DefinePlugin({
        __DEVELOPMENT__: false,
      }),
    );
  }

  if (target === 'web') {
    config.plugins.unshift(
      new webpack.DefinePlugin({
        __CLIENT__: true,
        __SERVER__: false,
      }),
    );

    config.plugins.push(
      new LoadablePlugin({
        outputAsset: false,
        writeToDisk: { filename: path.resolve(`${projectRootPath}/build`) },
      }),
    );

    config.output.filename = dev
      ? 'static/js/[name].js'
      : 'static/js/[name].[chunkhash:8].js';

    config.optimization = Object.assign({}, config.optimization, {
      runtimeChunk: true,
      splitChunks: {
        chunks: 'all',
        name: dev,
      },
    });

    config.plugins.unshift(
      // restrict moment.js locales to en/de
      // see https://github.com/jmblog/how-to-optimize-momentjs-with-webpack for details
      new webpack.ContextReplacementPlugin(
        /moment[/\\]locale$/,
        new RegExp(Object.keys(languages).join('|')),
      ),
      new LodashModuleReplacementPlugin({
        shorthands: true,
        cloning: true,
        currying: true,
        caching: true,
        collections: true,
        exotics: true,
        guards: true,
        metadata: true,
        deburring: true,
        unicode: true,
        chaining: true,
        memoizing: true,
        coercions: true,
        flattening: true,
        paths: true,
        placeholders: true,
      }),
    );
  }

  if (target === 'node') {
    config.plugins.unshift(
      new webpack.DefinePlugin({
        __CLIENT__: false,
        __SERVER__: true,
      }),
    );
  }

  // Don't load config|variables|overrides) files with file-loader
  // Don't load SVGs from ./src/icons with file-loader
  const fileLoader = config.module.rules.find(fileLoaderFinder);
  fileLoader.exclude = [
    /\.(config|variables|overrides)$/,
    /icons\/.*\.svg$/,
    ...fileLoader.exclude,
  ];

  // Disabling the ESlint pre loader
  config.module.rules.splice(0, 1);

  const addonsLoaderPath = createAddonsLoader(packageJson.addons || []);

  config.resolve.plugins = [new RootResolverPlugin()];

  config.resolve.alias = {
    ...registry.getAddonCustomizationPaths(),
    ...registry.getProjectCustomizationPaths(),
    ...config.resolve.alias,
    '../../theme.config$': `${projectRootPath}/theme/theme.config`,
    'volto-themes': `${registry.voltoPath}/theme/themes`,
    'load-volto-addons': addonsLoaderPath,
    ...registry.getResolveAliases(),
    '@plone/volto': `${registry.voltoPath}/src`,
    // to be able to reference path uncustomized by webpack
    '@plone/volto-original': `${registry.voltoPath}/src`,
    // be able to reference current package from customized package
    '@package': `${projectRootPath}/src`,
  };

  config.performance = {
    maxAssetSize: 10000000,
    maxEntrypointSize: 10000000,
  };

  const babelLoader = config.module.rules.find(babelLoaderFinder);
  const { include } = babelLoader;
  if (packageJson.name !== '@plone/volto') {
    include.push(fs.realpathSync(`${registry.voltoPath}/src`));
  }
  // Add babel support external (ie. node_modules npm published packages)
  if (packageJson.addons) {
    registry.addonNames.forEach((addon) =>
      include.push(fs.realpathSync(registry.packages[addon].modulePath)),
    );
  }

  let addonsAsExternals = [];
  if (packageJson.addons) {
    addonsAsExternals = registry.addonNames.map((addon) => new RegExp(addon));
  }

  config.externals =
    target === 'node'
      ? [
          nodeExternals({
            whitelist: [
              dev ? 'webpack/hot/poll?300' : null,
              /\.(eot|woff|woff2|ttf|otf)$/,
              /\.(svg|png|jpg|jpeg|gif|ico)$/,
              /\.(mp4|mp3|ogg|swf|webp)$/,
              /\.(css|scss|sass|sss|less)$/,
              // Add support for whitelist external (ie. node_modules npm published packages)
              ...addonsAsExternals,
              /^@plone\/volto/,
            ].filter(Boolean),
          }),
        ]
      : [];
  return config;
};

const addonExtenders = registry.getAddonExtenders().map((m) => require(m));

const defaultPlugins = [
  'bundle-analyzer',
  require('./webpack-less-plugin')({ registry }),
  require('./webpack-sentry-plugin').sentryPlugin,
  require('./webpack-svg-plugin').svgPlugin,
];

const plugins = addonExtenders.reduce(
  (acc, extender) => extender.plugins(acc),
  defaultPlugins,
);

module.exports = {
  plugins,
  modifyWebpackConfig: ({
    env: { target, dev },
    webpackConfig,
    webpackObject,
  }) => {
    const defaultConfig = defaultModify({
      env: { target, dev },
      webpackConfig,
      webpackObject,
    });
    const res = addonExtenders.reduce(
      (acc, extender) => extender.modify(acc, { target, dev }, webpackConfig),
      defaultConfig,
    );
    return res;
  },
  experimental: {
    reactRefresh: true,
  },
};
