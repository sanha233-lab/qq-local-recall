import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatTime } from '../src/ui/manager-model.mjs';

// Executes the real manager.mjs against a fake DOM + fake preload API, instead
// of the source-regex "smoke tests" that let the 1.4.2 listRecords/deleteRecord
// bridging gap ship unnoticed. Each mount() imports a fresh module instance
// (cache-busted by query string) so tests do not leak state into each other.

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.id = '';
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.indeterminate = false;
    this.value = '';
    this.title = '';
    this.src = '';
    this.alt = '';
    this._text = '';
    this._attrs = new Map();
    this._listeners = new Map();
  }

  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); this.children = []; }

  setAttribute(name, value) { this._attrs.set(name, String(value)); }
  getAttribute(name) { return this._attrs.get(name); }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }

  dispatch(type) {
    const handlers = this._listeners.get(type) || [];
    let result;
    for (const handler of handlers) result = handler({ target: this });
    return result;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
}

class FakeDocument {
  constructor() {
    this.root = new FakeElement('root');
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    const stack = [this.root];
    while (stack.length) {
      const node = stack.pop();
      if (node.id === id) return node;
      stack.push(...node.children);
    }
    return null;
  }

  querySelector(selector) {
    const className = selector.replace(/^\./, '');
    const stack = [this.root];
    while (stack.length) {
      const node = stack.pop();
      if (String(node.className).split(/\s+/).includes(className)) return node;
      stack.push(...node.children);
    }
    return null;
  }
}

function buildDom() {
  const document = new FakeDocument();
  const withId = (tag, id, props = {}) => {
    const el = Object.assign(document.createElement(tag), { id }, props);
    document.root.appendChild(el);
    return el;
  };
  withId('input', 'search', { type: 'search' });
  withId('button', 'delete', { disabled: true });
  withId('p', 'status');
  withId('p', 'action-error', { hidden: true });
  const table = Object.assign(document.createElement('div'), { className: 'table-wrap', hidden: true });
  document.root.appendChild(table);
  withId('tbody', 'rows');
  withId('input', 'select-all', { type: 'checkbox' });
  withId('strong', 'total-size');
  withId('span', 'total-count');
  withId('code', 'storage-path');
  withId('button', 'change-storage');
  withId('input', 'network-media-recovery', { type: 'checkbox' });
  withId('input', 'prevent-self', { type: 'checkbox' });
  withId('p', 'version-warning', { hidden: true });
  return document;
}

function createFakeApi(overrides = {}) {
  const defaults = {
    listConversations: async () => [],
    listRecords: async () => [],
    deleteRecord: async () => ({ deleted: true }),
    deleteConversations: async peerKeys => ({ deletedPeerKeys: peerKeys, deletedMessageIds: [] }),
    getStoragePath: async () => 'D:\\records',
    chooseStoragePath: async () => ({ canceled: true }),
    getSettings: async () => ({ networkMediaRecovery: true, preventSelf: false }),
    updateSettings: async value => ({ networkMediaRecovery: true, preventSelf: false, ...value }),
    getRecordPreview: async () => null,
    getQqVersion: async () => ({ current: '9.9.32-51246', verified: '9.9.32-51246' }),
  };
  const calls = {};
  const api = {};
  for (const name of Object.keys(defaults)) {
    const impl = overrides[name] || defaults[name];
    api[name] = async (...args) => {
      calls[name] = (calls[name] || 0) + 1;
      return impl(...args);
    };
  }
  let recordsDeletedHandler = null;
  api.onRecordsDeleted = callback => { recordsDeletedHandler = callback; };
  return { api, calls, fireRecordsDeleted: payload => recordsDeletedHandler?.(payload) };
}

const managerUrl = new URL('../src/ui/manager.mjs', import.meta.url);
let importCounter = 0;

async function mountManager({ apiOverrides = {} } = {}) {
  const document = buildDom();
  const { api, calls } = createFakeApi(apiOverrides);
  const confirmCalls = [];
  let confirmReturn = true;
  globalThis.document = document;
  globalThis.window = {
    qqLocalRecallManager: api,
    confirm: message => { confirmCalls.push(message); return confirmReturn; },
  };
  importCounter += 1;
  await import(`${managerUrl.href}?case=${importCounter}`);
  return { document, calls, confirmCalls, setConfirm: value => { confirmReturn = value; } };
}

function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

// tr -> peerCell -> peer(div) -> nameRow(div) -> expandBtn
function expandButtonOf(rowTr) {
  return rowTr.children[1].children[0].children[0].children[1];
}

test('manager loads conversations and renders formatted rows', async () => {
  const rows = [
    { peerKey: 'group:g1', type: 'group', name: '开发群', id: 'g1', sizeBytes: 4096, count: 3, lastRecallTime: '1720000000' },
    { peerKey: 'friend:u1', type: 'friend', name: '小明', id: 'u1', sizeBytes: 1024, count: 1, lastRecallTime: '1720001000000' },
  ];
  const { document, calls } = await mountManager({ apiOverrides: { listConversations: async () => rows } });

  assert.equal(calls.listConversations, 1);
  const body = document.getElementById('rows');
  assert.equal(body.children.length, 2);

  const [groupTr, friendTr] = body.children;
  const [, groupPeerCell, groupType, groupCount, groupSize, groupTime] = groupTr.children;
  assert.equal(groupPeerCell.children[0].children[0].children[0].textContent, '开发群');
  assert.equal(groupType.textContent, '群聊');
  assert.equal(groupCount.textContent, '3');
  assert.equal(groupSize.textContent, formatBytes(4096));
  assert.equal(groupTime.textContent, formatTime('1720000000'));

  const friendType = friendTr.children[2];
  assert.equal(friendType.textContent, '好友');

  assert.equal(document.getElementById('total-count').textContent, '2 个会话');
  assert.equal(document.getElementById('total-size').textContent, formatBytes(4096 + 1024));
  assert.equal(document.getElementById('status').hidden, true);
  assert.equal(document.querySelector('.table-wrap').hidden, false);
});

test('expanding a conversation fetches record previews and renders text, voice and picture content', async () => {
  const rows = [{ peerKey: 'friend:u1', type: 'friend', name: '小明', id: 'u1', sizeBytes: 100, count: 3, lastRecallTime: '1' }];
  const records = [
    { msgId: 'm1', recallTime: '1720000000', kind: 'text', text: '你好在吗', durationSeconds: 0, hasMediaPreview: false },
    { msgId: 'm2', recallTime: '1720000100', kind: 'voice', text: '', durationSeconds: 5, hasMediaPreview: false },
    { msgId: 'm3', recallTime: '1720000200', kind: 'picture', text: '', durationSeconds: 0, hasMediaPreview: true },
  ];
  const { document, calls } = await mountManager({
    apiOverrides: {
      listConversations: async () => rows,
      listRecords: async peerKey => { assert.equal(peerKey, 'friend:u1'); return records; },
      getRecordPreview: async () => ({ mimeType: 'image/png', base64: 'AAAA' }),
    },
  });

  const body = document.getElementById('rows');
  await expandButtonOf(body.children[0]).dispatch('click');
  await flush();

  assert.equal(calls.listRecords, 1);
  assert.equal(body.children.length, 4);

  const item = index => body.children[1 + index].children[0].children[0];
  const textItem = item(0);
  assert.equal(textItem.children[1].textContent, '文字');
  assert.equal(textItem.children[2].textContent, '你好在吗');

  const voiceItem = item(1);
  assert.equal(voiceItem.children[1].textContent, '语音');
  assert.equal(voiceItem.children[2].textContent, '5″');

  const pictureItem = item(2);
  assert.equal(pictureItem.children[1].textContent, '图片');
  const thumb = pictureItem.children[2];
  assert.equal(thumb.tagName, 'img');
  assert.equal(thumb.hidden, false);
  assert.equal(thumb.src, 'data:image/png;base64,AAAA');
});

test('single record delete failure shows a visible error, keeps the record and re-enables the button', async () => {
  const rows = [{ peerKey: 'friend:u1', type: 'friend', name: '小明', id: 'u1', sizeBytes: 100, count: 1, lastRecallTime: '1' }];
  const records = [{ msgId: 'm1', recallTime: '1', kind: 'text', text: 'hi', durationSeconds: 0, hasMediaPreview: false }];
  const { document } = await mountManager({
    apiOverrides: {
      listConversations: async () => rows,
      listRecords: async () => records,
      deleteRecord: async () => { throw new Error('boom'); },
    },
  });
  const body = document.getElementById('rows');
  await expandButtonOf(body.children[0]).dispatch('click');
  await flush();
  const delBtn = body.children[1].children[0].children[0].children[3];

  await delBtn.dispatch('click');

  assert.equal(delBtn.disabled, false);
  const errorEl = document.getElementById('action-error');
  assert.equal(errorEl.hidden, false);
  assert.match(errorEl.textContent, /boom/);
  assert.equal(body.children.length, 2, 'the record must still be rendered after a failed delete');
});

test('batch delete: cancelling the confirm dialog does not call the API', async () => {
  const rows = [{ peerKey: 'friend:u1', type: 'friend', name: '小明', id: 'u1', sizeBytes: 100, count: 1, lastRecallTime: '1' }];
  const { document, calls, setConfirm } = await mountManager({ apiOverrides: { listConversations: async () => rows } });
  setConfirm(false);
  const checkbox = document.getElementById('rows').children[0].children[0].children[0];
  checkbox.checked = true;
  await checkbox.dispatch('change');

  await document.getElementById('delete').dispatch('click');

  assert.equal(calls.deleteConversations, undefined);
});

test('batch delete failure shows a visible error and re-enables the delete button', async () => {
  const rows = [{ peerKey: 'friend:u1', type: 'friend', name: '小明', id: 'u1', sizeBytes: 100, count: 1, lastRecallTime: '1' }];
  const { document } = await mountManager({
    apiOverrides: {
      listConversations: async () => rows,
      deleteConversations: async () => { throw new Error('network down'); },
    },
  });
  const checkbox = document.getElementById('rows').children[0].children[0].children[0];
  checkbox.checked = true;
  await checkbox.dispatch('change');

  await document.getElementById('delete').dispatch('click');

  const errorEl = document.getElementById('action-error');
  assert.equal(errorEl.hidden, false);
  assert.match(errorEl.textContent, /network down/);
  assert.equal(document.getElementById('delete').disabled, false);
});

test('a failed settings toggle reverts the checkbox and shows a visible error', async () => {
  const { document } = await mountManager({
    apiOverrides: {
      getSettings: async () => ({ networkMediaRecovery: true, preventSelf: false }),
      updateSettings: async () => { throw new Error('write failed'); },
    },
  });
  const checkbox = document.getElementById('network-media-recovery');
  assert.equal(checkbox.checked, true);
  checkbox.checked = false;

  await checkbox.dispatch('change');

  assert.equal(checkbox.checked, true, 'checkbox should revert to the previous state on failure');
  assert.equal(checkbox.disabled, false);
  const errorEl = document.getElementById('action-error');
  assert.equal(errorEl.hidden, false);
  assert.match(errorEl.textContent, /write failed/);
});

test('a failed storage change shows a visible error and restores the previously displayed path', async () => {
  const { document } = await mountManager({
    apiOverrides: {
      getStoragePath: async () => 'D:\\original',
      chooseStoragePath: async () => { throw new Error('只能选择本机磁盘目录'); },
    },
  });
  assert.equal(document.getElementById('storage-path').textContent, 'D:\\original');

  await document.getElementById('change-storage').dispatch('click');

  assert.equal(document.getElementById('storage-path').textContent, 'D:\\original');
  const errorEl = document.getElementById('action-error');
  assert.equal(errorEl.hidden, false);
  assert.match(errorEl.textContent, /只能选择本机磁盘目录/);
  assert.equal(document.getElementById('change-storage').disabled, false);
});
