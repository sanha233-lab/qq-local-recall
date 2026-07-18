const test = require('node:test');
const assert = require('node:assert/strict');

const { createPreloadApi } = require('../src/preload-api');

test('preload API exposes only fixed local recall operations', async () => {
  const calls = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke(channel, value) { calls.push([channel, value]); return Promise.resolve({ ok: true }); },
    on(channel, callback) { listeners.set(channel, callback); },
  };
  const api = createPreloadApi(ipcRenderer);

  await api.listConversations();
  await api.deleteConversations(['friend:u1']);
  let deleted;
  api.onRecordsDeleted(value => { deleted = value; });
  listeners.get('qq-local-recall:records-deleted')({}, { peerKeys: ['friend:u1'] });

  assert.deepEqual(Object.keys(api).sort(), ['deleteConversations', 'listConversations', 'onRecordsDeleted']);
  assert.deepEqual(calls, [
    ['qq-local-recall:list-conversations', undefined],
    ['qq-local-recall:delete-conversations', ['friend:u1']],
  ]);
  assert.deepEqual(deleted, { peerKeys: ['friend:u1'] });
});

test('renderer preload API exposes the fixed rendered-media operation', async () => {
  const calls = [];
  const ipcRenderer = {
    invoke(channel, value) { calls.push([channel, value]); return Promise.resolve({ ok: true }); },
    on() {},
  };
  const api = createPreloadApi(ipcRenderer, { includeRecovered: true });
  const value = { messageId: 'm1', mediaIndex: 0, sourceUrl: 'appimg://D/a' };

  await api.persistRenderedMedia(value);

  assert.equal(typeof api.onRecovered, 'function');
  assert.deepEqual(calls, [['qq-local-recall:persist-rendered-media', value]]);
  assert.equal('readFile' in api, false);
  assert.equal('writeFile' in api, false);
});
