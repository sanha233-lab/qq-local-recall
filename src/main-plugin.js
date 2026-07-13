'use strict';

const path = require('node:path');
const { RecallProcessor } = require('./core/processor');
const { ConversationStore } = require('./core/store');
const { CHANNELS } = require('./preload-api');

const RECOVERED_CHANNEL = 'qq-local-recall:recovered';

function createPlugin({ electron, dataDir, managerHtmlPath, managerPreloadPath, logger = console }) {
  const { BrowserWindow, ipcMain } = electron;
  const store = new ConversationStore(dataDir);
  const processor = new RecallProcessor({ store, cacheLimit: 10000, preventSelf: false });
  const patchedContents = new WeakSet();
  let managerWindow = null;
  let started = false;

  function broadcast(channel, payload) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window?.webContents || window.webContents.isDestroyed?.()) continue;
      window.webContents.send(channel, payload);
    }
  }

  function openManager() {
    if (managerWindow && !managerWindow.isDestroyed?.()) {
      managerWindow.show?.();
      managerWindow.focus?.();
      return true;
    }
    managerWindow = new BrowserWindow({
      width: 820,
      height: 620,
      minWidth: 680,
      minHeight: 480,
      title: 'QQ 本地撤回记录',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.resolve(managerPreloadPath),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    managerWindow.loadFile(path.resolve(managerHtmlPath));
    managerWindow.once?.('closed', () => { managerWindow = null; });
    return true;
  }

  function validatePeerKeys(value) {
    if (!Array.isArray(value) || value.length > 1000) throw new TypeError('peerKeys must be an array');
    return value.map(String).filter(key => /^(friend|group):[^\r\n]{1,256}$/.test(key));
  }

  function start() {
    if (started) return;
    started = true;
    ipcMain.handle(CHANNELS.list, () => store.listConversations());
    ipcMain.handle(CHANNELS.delete, (_event, value) => {
      const peerKeys = validatePeerKeys(value);
      const result = store.deleteConversations(peerKeys);
      processor.clearPeers(result.deletedPeerKeys);
      broadcast(CHANNELS.deleted, {
        peerKeys: result.deletedPeerKeys,
        messageIds: result.deletedMessageIds,
      });
      return result;
    });
    ipcMain.handle(CHANNELS.open, () => openManager());
  }

  function patchWindow(window) {
    const contents = window?.webContents;
    if (!contents || contents.isDestroyed?.() || patchedContents.has(contents)) return false;
    const url = String(contents.getURL?.() || '');
    if (url && !url.startsWith('app://')) return false;

    const originalOwner = contents.__qqntim_original_object || contents;
    const originalSend = originalOwner.send;
    if (typeof originalSend !== 'function') return false;

    function patchedSend(channel, ...args) {
      let recoveredIds = [];
      let attemptedIds = [];
      try {
        const processed = processor.processIpcArguments(args);
        recoveredIds = processed.recoveredIds;
        attemptedIds = processed.attemptedIds;
      } catch (error) {
        logger.error?.('[QQ Local Recall] IPC processing failed:', error);
      }
      const result = originalSend.call(contents, channel, ...args);
      if (recoveredIds.length) {
        originalSend.call(contents, RECOVERED_CHANNEL, { messageIds: recoveredIds, attemptedIds });
      }
      return result;
    }

    originalOwner.send = patchedSend;
    patchedContents.add(contents);
    return true;
  }

  function onBrowserWindowCreated(window) {
    patchWindow(window);
    window?.webContents?.on?.('did-stop-loading', () => patchWindow(window));
    window?.webContents?.on?.('did-navigate-in-page', () => patchWindow(window));
  }

  return { start, onBrowserWindowCreated, patchWindow, openManager, store, processor };
}

module.exports = { createPlugin, RECOVERED_CHANNEL };
