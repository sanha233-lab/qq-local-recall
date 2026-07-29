'use strict';

const path = require('node:path');
const electron = require('electron');
const { createPlugin } = require('./main-plugin');
const { installQqSessionCapture } = require('./core/qq-native-media');
const { readStoragePath } = require('./core/storage-path');

const getQqSession = installQqSessionCapture();

const defaultDataDir = path.join(LiteLoader.path.data, 'qq_local_recall');

const plugin = createPlugin({
  electron,
  dataDir: readStoragePath(defaultDataDir),
  storageConfigDir: defaultDataDir,
  managerHtmlPath: path.join(__dirname, 'ui', 'manager.html'),
  managerPreloadPath: path.join(__dirname, 'ui', 'manager-preload.js'),
  getQqSession,
});

plugin.start();

module.exports = {
  onBrowserWindowCreated: plugin.onBrowserWindowCreated,
};
