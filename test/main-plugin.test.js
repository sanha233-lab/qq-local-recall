const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPlugin } = require('../src/main-plugin');

function message(elements, overrides = {}) {
  return {
    msgId: 'm1', chatType: 1, peerUid: 'u1', peerName: '好友', senderUid: 'u1', msgTime: '1',
    elements,
    ...overrides,
  };
}

function fakeElectron() {
  const handlers = new Map();
  const windows = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.loadedFile = null;
      this.webContents = { send() {} };
      windows.push(this);
    }
    loadFile(file) { this.loadedFile = file; }
    static getAllWindows() { return windows; }
  }
  return {
    ipcMain: { handle(channel, callback) { handlers.set(channel, callback); } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    BrowserWindow,
    handlers,
    windows,
  };
}

function fakeChatWindow() {
  const sent = [];
  const listeners = new Map();
  const webContents = {
    send(channel, ...args) { sent.push([channel, ...args]); },
    getURL() { return 'app://./renderer/index.html#/main/message'; },
    isDestroyed() { return false; },
    on(event, callback) { listeners.set(event, callback); },
  };
  return { webContents, sent, listeners };
}

test('main plugin patches QQ IPC and emits recovered message ids', () => {
  const electron = fakeElectron();
  const plugin = createPlugin({
    electron,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-')),
    managerHtmlPath: 'manager.html',
    managerPreloadPath: 'manager-preload.js',
  });
  plugin.start();
  const chat = fakeChatWindow();
  plugin.onBrowserWindowCreated(chat);
  const received = { cmdName: 'onRecvMsg', payload: { msgList: [message([
    { elementType: 1, textElement: { content: 'hello' } },
  ])] } };
  chat.webContents.send('qq-ipc', 'event', received);
  const recalled = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [message([
    { elementType: 8, grayTipElement: { subElementType: 1, revokeElement: { isSelfOperate: false } } },
  ])] } };

  chat.webContents.send('qq-ipc', 'event', recalled);

  assert.equal(recalled.payload.msgList[0].elements[0].textElement.content, 'hello');
  assert.deepEqual(chat.sent.at(-1), ['qq-local-recall:recovered', {
    messageIds: ['m1'], attemptedIds: ['m1'],
  }]);
});

test('main plugin lists and deletes conversations through narrow IPC handlers', async () => {
  const electron = fakeElectron();
  const plugin = createPlugin({
    electron,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-')),
    managerHtmlPath: 'manager.html',
    managerPreloadPath: 'manager-preload.js',
  });
  plugin.start();
  plugin.store.save({
    msgId: 'm1', peer: { key: 'friend:u1', type: 'friend', id: 'u1', name: '好友' },
    recallTime: '1', message: message([{ elementType: 1, textElement: { content: 'hello' } }]),
  });
  const list = await electron.handlers.get('qq-local-recall:list-conversations')({});

  const result = await electron.handlers.get('qq-local-recall:delete-conversations')({}, ['friend:u1']);

  assert.equal(list[0].peerKey, 'friend:u1');
  assert.deepEqual(result.deletedPeerKeys, ['friend:u1']);
  assert.deepEqual(result.deletedMessageIds, ['m1']);
});

test('main plugin opens an isolated local manager window', async () => {
  const electron = fakeElectron();
  const plugin = createPlugin({
    electron,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-')),
    managerHtmlPath: 'manager.html',
    managerPreloadPath: 'manager-preload.js',
  });
  plugin.start();

  await electron.handlers.get('qq-local-recall:open-manager')({});

  const manager = electron.windows[0];
  assert.equal(manager.loadedFile, path.resolve('manager.html'));
  assert.equal(manager.options.webPreferences.contextIsolation, true);
  assert.equal(manager.options.webPreferences.nodeIntegration, false);
});

test('main plugin changes the record directory through the native folder picker', async () => {
  const electron = fakeElectron();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-'));
  const selected = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-selected-')), 'records-root');
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  const plugin = createPlugin({
    electron,
    dataDir,
    managerHtmlPath: 'manager.html',
    managerPreloadPath: 'manager-preload.js',
  });
  plugin.start();
  plugin.store.save({
    msgId: 'm1', peer: { key: 'friend:u1', type: 'friend', id: 'u1', name: '好友' },
    recallTime: '1', message: message([{ elementType: 1, textElement: { content: 'hello' } }]),
  });

  const choose = await electron.handlers.get('qq-local-recall:choose-storage-path')({});

  assert.deepEqual(choose, { canceled: false, path: path.resolve(selected) });
  assert.equal(await electron.handlers.get('qq-local-recall:get-storage-path')({}), path.resolve(selected));
  assert.equal(fs.existsSync(path.join(selected, 'records')), true);
  assert.equal(fs.existsSync(path.join(dataDir, 'storage.json')), true);
});
