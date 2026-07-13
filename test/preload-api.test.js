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

