const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPlugin, validatePersistedMediaInput } = require('../src/main-plugin');

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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')]);

function mediaRecord(msgId, peerKey, reference) {
  return {
    msgId,
    peer: { key: peerKey, type: 'friend', id: peerKey.split(':')[1], name: peerKey },
    recallTime: '1',
    message: message([{
      elementType: 2,
      picElement: { sourcePath: 'persisted.png' },
      qqLocalRecallMedia: reference,
    }], { msgId, peerUid: peerKey.split(':')[1] }),
  };
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
    messageIds: ['m1'], attemptedIds: ['m1'], messageKinds: { m1: 'message' },
    recallNotices: { m1: {
      kind: 'message', operatorName: '对方', operatorRole: 0, senderName: '好友',
    } },
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

test('rendered-media IPC validation accepts only fixed appimg or PNG byte inputs', () => {
  const source = { messageId: 'm1', mediaIndex: 0, sourceUrl: 'appimg://D/QQ/Tencent%20Files/a/nt_qq/nt_data/Emoji/x.jpg' };
  assert.deepEqual(validatePersistedMediaInput(source), source);
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual(validatePersistedMediaInput({ messageId: 'm1', mediaIndex: 31, mimeType: 'image/png', bytes }), {
    messageId: 'm1', mediaIndex: 31, mimeType: 'image/png', bytes,
  });
  for (const invalid of [
    { ...source, outputPath: 'G:\\QQ\\media\\x.gif' },
    { ...source, sourceUrl: 'https://example.test/x.gif' },
    { ...source, mediaIndex: 32 },
    { messageId: 'm1', mediaIndex: 0, mimeType: 'image/jpeg', bytes },
    { messageId: 'm1', mediaIndex: 0, mimeType: 'image/png', bytes: new Uint8Array(20 * 1024 * 1024 + 1) },
  ]) assert.throws(() => validatePersistedMediaInput(invalid));
});

test('main plugin registers the fixed rendered-media IPC handler', () => {
  const electron = fakeElectron();
  const plugin = createPlugin({
    electron,
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-')),
    managerHtmlPath: 'manager.html',
    managerPreloadPath: 'manager-preload.js',
  });
  plugin.start();

  assert.equal(typeof electron.handlers.get('qq-local-recall:persist-rendered-media'), 'function');
});

test('deleting conversations removes media only after the final reference', async () => {
  const electron = fakeElectron();
  const plugin = createPlugin({
    electron, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-')),
    managerHtmlPath: 'manager.html', managerPreloadPath: 'manager-preload.js',
  });
  plugin.start();
  const saved = plugin.mediaStore.saveBytes(PNG, 'image/png', true);
  const reference = { ...saved };
  delete reference.absolutePath;
  plugin.store.save(mediaRecord('m1', 'friend:u1', reference));
  plugin.store.save(mediaRecord('m2', 'friend:u2', reference));

  await electron.handlers.get('qq-local-recall:delete-conversations')({}, ['friend:u1']);
  assert.equal(fs.existsSync(saved.absolutePath), true);

  await electron.handlers.get('qq-local-recall:delete-conversations')({}, ['friend:u2']);
  assert.equal(fs.existsSync(saved.absolutePath), false);
});

test('changing storage root copies referenced media but not orphans', async () => {
  const electron = fakeElectron();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-'));
  const selected = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-selected-')), 'records-root');
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  const plugin = createPlugin({ electron, dataDir, managerHtmlPath: 'manager.html', managerPreloadPath: 'manager-preload.js' });
  plugin.start();
  const referenced = plugin.mediaStore.saveBytes(PNG, 'image/png', true);
  const orphan = plugin.mediaStore.saveBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg', false);
  const reference = { ...referenced };
  delete reference.absolutePath;
  plugin.store.save(mediaRecord('m1', 'friend:u1', reference));

  await electron.handlers.get('qq-local-recall:choose-storage-path')({});

  assert.equal(fs.existsSync(path.join(selected, reference.relativePath)), true);
  assert.equal(fs.existsSync(path.join(selected, orphan.relativePath)), false);
  assert.equal(plugin.mediaStore.rootDir, path.resolve(selected));
  assert.equal(plugin.store.rootDir, path.resolve(selected));
});

test('failed media migration keeps both stores on the previous root', async () => {
  const electron = fakeElectron();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-'));
  const selected = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-selected-')), 'records-root');
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  const plugin = createPlugin({ electron, dataDir, managerHtmlPath: 'manager.html', managerPreloadPath: 'manager-preload.js' });
  plugin.start();
  plugin.store.save({
    msgId: 'm1', peer: { key: 'friend:u1', type: 'friend', id: 'u1', name: '好友' }, recallTime: '1',
    message: message([{ elementType: 1, textElement: { content: 'keep' } }]),
  });
  plugin.mediaStore.copyReferencedTo = () => { throw new Error('copy failed'); };

  await assert.rejects(electron.handlers.get('qq-local-recall:choose-storage-path')({}), /copy failed/);

  assert.equal(plugin.store.rootDir, path.resolve(dataDir));
  assert.equal(plugin.mediaStore.rootDir, path.resolve(dataDir));
  assert.equal(plugin.store.get('m1').message.elements[0].textElement.content, 'keep');
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
