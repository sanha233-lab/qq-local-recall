'use strict';

const path = require('node:path');
const electron = require('electron');
const { createPlugin } = require('./main-plugin');

const plugin = createPlugin({
  electron,
  dataDir: path.join(LiteLoader.path.data, 'qq_local_recall'),
  managerHtmlPath: path.join(__dirname, 'ui', 'manager.html'),
  managerPreloadPath: path.join(__dirname, 'ui', 'manager-preload.js'),
});

plugin.start();

module.exports = {
  onBrowserWindowCreated: plugin.onBrowserWindowCreated,
};

