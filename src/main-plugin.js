'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_MEDIA_BYTES, MediaStore, PttStore, readPngDimensions, validateAspectRatio,
} = require('./core/media-store');
const { RecallProcessor } = require('./core/processor');
const { fetchQqMedia } = require('./core/qq-media-fetch');
const { readSettings, writeSettings } = require('./core/settings');
const { ConversationStore } = require('./core/store');
const { isLocalStoragePath, writeStoragePath } = require('./core/storage-path');
const { CHANNELS } = require('./preload-api');

const RECOVERED_CHANNEL = 'qq-local-recall:recovered';

function pathToAppImageUrl(filePath) {
  const absolutePath = path.win32.resolve(filePath);
  const root = path.win32.parse(absolutePath).root;
  if (!/^[A-Za-z]:\\$/.test(root)) throw new TypeError('display path must use a local drive');
  const encodedPath = absolutePath.slice(root.length).split(path.win32.sep).map(encodeURIComponent).join('/');
  return `appimg://${root[0].toUpperCase()}/${encodedPath}`;
}

function validatePersistedMediaInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('rendered media input must be an object');
  }
  const messageId = value.messageId;
  const mediaIndex = value.mediaIndex;
  if (typeof messageId !== 'string' || messageId.length < 1 || messageId.length > 256
    || !Number.isInteger(mediaIndex) || mediaIndex < 0 || mediaIndex > 31) {
    throw new TypeError('rendered media identity is invalid');
  }
  if (typeof value.sourceUrl === 'string') {
    if (Object.keys(value).sort().join(',') !== 'mediaIndex,messageId,sourceUrl') {
      throw new TypeError('rendered media input has unknown fields');
    }
    let source;
    try { source = new URL(value.sourceUrl); } catch { throw new TypeError('sourceUrl is invalid'); }
    if (source.protocol !== 'appimg:' && source.protocol !== 'https:') {
      throw new TypeError('sourceUrl must use appimg or https');
    }
    return { messageId, mediaIndex, sourceUrl: value.sourceUrl };
  }
  if (Object.keys(value).sort().join(',') !== 'bytes,height,mediaIndex,messageId,mimeType,width'
    || value.mimeType !== 'image/png'
    || !(value.bytes instanceof Uint8Array)
    || value.bytes.byteLength < 1
    || value.bytes.byteLength > MAX_MEDIA_BYTES
    || !Number.isInteger(value.width) || value.width < 1
    || !Number.isInteger(value.height) || value.height < 1) {
    throw new TypeError('rendered media bytes must be a dimensioned PNG Uint8Array within 20 MiB');
  }
  return {
    messageId, mediaIndex, mimeType: 'image/png', bytes: value.bytes,
    width: value.width, height: value.height,
  };
}

function publicReference(reference) {
  return {
    sha256: reference.sha256,
    relativePath: reference.relativePath,
    mimeType: reference.mimeType,
    sizeBytes: reference.sizeBytes,
    staticFallback: reference.staticFallback === true,
  };
}

function createPlugin({ electron, dataDir, storageConfigDir = dataDir, managerHtmlPath, managerPreloadPath, logger = console }) {
  const { BrowserWindow, ipcMain, dialog } = electron;
  const store = new ConversationStore(dataDir);
  const mediaStore = new MediaStore(dataDir);
  const pttStore = new PttStore(dataDir);
  const configDir = path.resolve(storageConfigDir);
  let settings = readSettings(configDir);
  let storagePath = path.resolve(dataDir);
  const diagPath = path.join(dataDir, 'ptt-debug.jsonl');
  const diagLog = entry => fs.appendFileSync(diagPath, JSON.stringify({ t: Date.now(), ...entry }) + '\n');
  const processor = new RecallProcessor({ store, mediaStore, pttStore, cacheLimit: 10000, preventSelf: settings.preventSelf, diagLog });
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
    ipcMain.handle(CHANNELS.listRecords, (_event, peerKey) => {
      if (typeof peerKey !== 'string' || peerKey.length > 512) throw new TypeError('peerKey is invalid');
      return store.getRecordSummaries(peerKey);
    });
    ipcMain.handle(CHANNELS.delete, (_event, value) => {
      const peerKeys = validatePeerKeys(value);
      const result = store.deleteConversations(peerKeys);
      mediaStore.sweep(store.mediaReferences());
      pttStore.sweep(store.mediaReferences());
      processor.clearPeers(result.deletedPeerKeys);
      broadcast(CHANNELS.deleted, {
        peerKeys: result.deletedPeerKeys,
        messageIds: result.deletedMessageIds,
      });
      return result;
    });
    ipcMain.handle(CHANNELS.deleteRecord, (_event, peerKey, msgId) => {
      if (typeof peerKey !== 'string' || peerKey.length > 512) throw new TypeError('peerKey is invalid');
      if (typeof msgId !== 'string' || msgId.length > 256) throw new TypeError('msgId is invalid');
      const deleted = store.deleteRecord(peerKey, msgId);
      if (deleted) {
        mediaStore.sweep(store.mediaReferences());
        pttStore.sweep(store.mediaReferences());
      }
      return { deleted };
    });
    ipcMain.handle(CHANNELS.open, () => openManager());
    ipcMain.handle(CHANNELS.persistMedia, async (event, value) => {
      const input = validatePersistedMediaInput(value);
      const element = processor.pendingMediaElement(input.messageId, input.mediaIndex);
      const pic = element.picElement;
      const expectedDimensions = Number.isInteger(Number(pic?.picWidth)) && Number(pic.picWidth) > 0
        && Number.isInteger(Number(pic?.picHeight)) && Number(pic.picHeight) > 0
        ? { width: Number(pic.picWidth), height: Number(pic.picHeight) }
        : undefined;
      let reference;
      if (input.sourceUrl) {
        const protocol = new URL(input.sourceUrl).protocol;
        if (protocol === 'appimg:') {
          reference = mediaStore.saveAppImage(input.sourceUrl);
        } else {
          if (!settings.networkMediaRecovery) throw new Error('网络回源已关闭');
          const sessionFetch = event?.sender?.session?.fetch;
          if (typeof sessionFetch !== 'function') throw new Error('session fetch is unavailable');
          const downloaded = await fetchQqMedia({
            fetch: sessionFetch.bind(event.sender.session),
            sourceUrl: input.sourceUrl,
            expectedFileUuid: pic?.fileUuid || element.marketFaceElement?.fileUuid,
          });
          reference = mediaStore.saveBytes(downloaded.bytes, downloaded.mimeType, false);
        }
      } else {
        const actualDimensions = readPngDimensions(input.bytes);
        if (actualDimensions.width !== input.width || actualDimensions.height !== input.height) {
          throw new TypeError('Canvas dimensions do not match PNG IHDR');
        }
        validateAspectRatio(actualDimensions, expectedDimensions);
        reference = mediaStore.saveBytes(Buffer.from(input.bytes), input.mimeType, true);
      }
      const displayPath = mediaStore.resolve(reference, expectedDimensions);
      processor.persistRenderedMedia({
        messageId: input.messageId,
        mediaIndex: input.mediaIndex,
        reference,
      });
      return {
        ok: true,
        reference: publicReference(reference),
        displayUrl: pathToAppImageUrl(displayPath),
      };
    });
    ipcMain.handle(CHANNELS.settings, () => ({ ...settings }));
    ipcMain.handle(CHANNELS.updateSettings, (_event, value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('settings update is invalid');
      const allowed = new Set(['networkMediaRecovery', 'preventSelf']);
      const keys = Object.keys(value);
      if (keys.length === 0 || keys.some(k => !allowed.has(k))) throw new TypeError('settings update is invalid');
      if ('networkMediaRecovery' in value && typeof value.networkMediaRecovery !== 'boolean') throw new TypeError('settings update is invalid');
      if ('preventSelf' in value && typeof value.preventSelf !== 'boolean') throw new TypeError('settings update is invalid');
      settings = writeSettings(configDir, { ...settings, ...value });
      processor.preventSelf = settings.preventSelf;
      return { ...settings };
    });
    ipcMain.handle(CHANNELS.storagePath, () => storagePath);
    ipcMain.handle(CHANNELS.chooseStoragePath, async () => {
      if (typeof dialog?.showOpenDialog !== 'function') throw new Error('folder picker is unavailable');
      const result = await dialog.showOpenDialog({
        title: '选择撤回记录保存文件夹',
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result?.filePaths?.[0];
      if (result?.canceled || !selected) return { canceled: true, path: storagePath };
      const nextPath = path.resolve(selected);
      if (!isLocalStoragePath(nextPath)) throw new Error('只能选择本机磁盘目录');
      const previousPath = storagePath;
      try {
        mediaStore.copyReferencedTo(nextPath, store.mediaReferences());
        pttStore.copyReferencedTo(nextPath, store.mediaReferences());
        store.changeRoot(nextPath);
        mediaStore.setRoot(nextPath);
        pttStore.setRoot(nextPath);
        writeStoragePath(configDir, nextPath);
        storagePath = nextPath;
        return { canceled: false, path: storagePath };
      } catch (error) {
        try { store.changeRoot(previousPath); } catch (restoreError) { logger.error?.('[QQ Local Recall] storage rollback failed:', restoreError); }
        try { mediaStore.setRoot(previousPath); } catch (restoreError) { logger.error?.('[QQ Local Recall] media rollback failed:', restoreError); }
        try { pttStore.setRoot(previousPath); } catch (restoreError) { logger.error?.('[QQ Local Recall] ptt rollback failed:', restoreError); }
        throw error;
      }
    });
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
      let messageKinds = {};
      let recallNotices = {};
      try {
        const processed = processor.processIpcArguments(args);
        recoveredIds = processed.recoveredIds;
        attemptedIds = processed.attemptedIds;
        messageKinds = processed.messageKinds;
        recallNotices = processed.recallNotices;
      } catch (error) {
        logger.error?.('[QQ Local Recall] IPC processing failed:', error);
      }
      const result = originalSend.call(contents, channel, ...args);
      if (recoveredIds.length) {
        originalSend.call(contents, RECOVERED_CHANNEL, {
          messageIds: recoveredIds, attemptedIds, messageKinds, recallNotices,
        });
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

  return { start, onBrowserWindowCreated, patchWindow, openManager, store, mediaStore, processor };
}

module.exports = { createPlugin, RECOVERED_CHANNEL, validatePersistedMediaInput };
