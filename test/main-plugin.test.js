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

function pngWithDimensions(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const PNG = pngWithDimensions(2, 2);
const PORTRAIT_PNG = pngWithDimensions(432, 960);

function primePending(plugin, picElement = {}) {
  plugin.processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [message([{
    elementType: 2,
    picElement: { sourcePath: 'missing.png', ...picElement },
  }])] } });
  plugin.processor.processEvent({ cmdName: 'onMsgInfoListUpdate', payload: { msgList: [message([{
    elementType: 8,
    grayTipElement: { subElementType: 1, revokeElement: { isSelfOperate: false } },
  }])] } });
}

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

test('rendered-media IPC validation accepts only fixed appimg, HTTPS or dimensioned PNG inputs', () => {
  const source = { messageId: 'm1', mediaIndex: 0, sourceUrl: 'appimg://D/QQ/Tencent%20Files/a/nt_qq/nt_data/Emoji/x.jpg' };
  assert.deepEqual(validatePersistedMediaInput(source), source);
  const remote = { messageId: 'm1', mediaIndex: 0, sourceUrl: 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=f1&spec=0&rkey=key' };
  assert.deepEqual(validatePersistedMediaInput(remote), remote);
  const bytes = new Uint8Array(PORTRAIT_PNG);
  assert.deepEqual(validatePersistedMediaInput({ messageId: 'm1', mediaIndex: 31, mimeType: 'image/png', bytes, width: 432, height: 960 }), {
    messageId: 'm1', mediaIndex: 31, mimeType: 'image/png', bytes, width: 432, height: 960,
  });
  for (const invalid of [
    { ...source, outputPath: 'G:\\QQ\\media\\x.gif' },
    { ...source, sourceUrl: 'http://example.test/x.gif' },
    { ...source, mediaIndex: 32 },
    { messageId: 'm1', mediaIndex: 0, mimeType: 'image/jpeg', bytes },
    { messageId: 'm1', mediaIndex: 0, mimeType: 'image/png', bytes, width: 0, height: 960 },
    { messageId: 'm1', mediaIndex: 0, mimeType: 'image/png', bytes: new Uint8Array(20 * 1024 * 1024 + 1), width: 1, height: 1 },
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

test('Canvas media IPC rejects a 60x60 placeholder and persists a matching portrait', async () => {
  const electron = fakeElectron();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-'));
  const plugin = createPlugin({ electron, dataDir, managerHtmlPath: 'manager.html', managerPreloadPath: 'manager-preload.js' });
  plugin.start();
  primePending(plugin, { picWidth: 864, picHeight: 1920, fileUuid: 'f1' });
  const handler = electron.handlers.get('qq-local-recall:persist-rendered-media');

  await assert.rejects(handler({}, {
    messageId: 'm1', mediaIndex: 0, mimeType: 'image/png', bytes: new Uint8Array(pngWithDimensions(60, 60)),
    width: 60, height: 60,
  }), /aspect ratio/);
  const result = await handler({}, {
    messageId: 'm1', mediaIndex: 0, mimeType: 'image/png', bytes: new Uint8Array(PORTRAIT_PNG),
    width: 432, height: 960,
  });

  assert.equal(result.ok, true);
  assert.match(result.displayUrl, /^appimg:\/\/[A-Z]\//);
  assert.equal('sourceUrl' in result, false);
  assert.equal(plugin.store.get('m1').message.elements[0].qqLocalRecallMedia.staticFallback, true);
});

test('HTTPS media IPC uses only the invoking QQ session and returns no temporary URL', async () => {
  const electron = fakeElectron();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-'));
  const plugin = createPlugin({ electron, dataDir, managerHtmlPath: 'manager.html', managerPreloadPath: 'manager-preload.js' });
  plugin.start();
  primePending(plugin, { picWidth: 2, picHeight: 2, fileUuid: 'file-uuid-1' });
  const sourceUrl = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=file-uuid-1&spec=0&rkey=temporary-key';
  const calls = [];
  const session = {
    async fetch(url, options) {
      assert.equal(this, session);
      calls.push([url, options]);
      return new Response(Buffer.from('GIF89a image', 'ascii'));
    },
  };

  const result = await electron.handlers.get('qq-local-recall:persist-rendered-media')(
    { sender: { session } }, { messageId: 'm1', mediaIndex: 0, sourceUrl },
  );

  assert.equal(calls.length, 1);
  assert.match(result.displayUrl, /^appimg:\/\/[A-Z]\//);
  assert.equal(JSON.stringify(result).includes('temporary-key'), false);
  const recordName = fs.readdirSync(path.join(dataDir, 'records'))[0];
  const recordText = fs.readFileSync(path.join(dataDir, 'records', recordName), 'utf8');
  assert.equal(recordText.includes('rkey'), false);
  assert.equal(recordText.includes('temporary-key'), false);
});

test('disabled or unavailable QQ session recovery performs no network request', async () => {
  const electron = fakeElectron();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-main-'));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-config-'));
  const plugin = createPlugin({
    electron, dataDir, storageConfigDir: configDir,
    managerHtmlPath: 'manager.html', managerPreloadPath: 'manager-preload.js',
  });
  plugin.start();
  primePending(plugin, { fileUuid: 'file-uuid-1' });
  const handler = electron.handlers.get('qq-local-recall:persist-rendered-media');
  const input = {
    messageId: 'm1', mediaIndex: 0,
    sourceUrl: 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=file-uuid-1&spec=0&rkey=temporary-key',
  };
  let calls = 0;
  const event = { sender: { session: { fetch: async () => { calls += 1; return new Response(); } } } };

  await electron.handlers.get('qq-local-recall:update-settings')({}, { networkMediaRecovery: false });
  await assert.rejects(handler(event, input), /关闭/);
  assert.equal(calls, 0);

  await electron.handlers.get('qq-local-recall:update-settings')({}, { networkMediaRecovery: true });
  await assert.rejects(handler({ sender: { session: {} } }, input), /unavailable/);
  assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')), {
    version: 1, networkMediaRecovery: true,
  });
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
