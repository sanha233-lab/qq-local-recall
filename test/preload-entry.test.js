const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('preload entry exposes the complete fixed API without local module loading', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  let exposed;
  const contextBridge = { exposeInMainWorld(key, value) { exposed = { key, value }; } };
  const ipcRenderer = { invoke() {}, on() {} };
  const sandbox = {
    require(id) {
      if (id !== 'electron') throw new Error(`unexpected preload dependency: ${id}`);
      return { contextBridge, ipcRenderer };
    },
  };

  vm.runInNewContext(source, sandbox, { filename: 'preload.js' });

  assert.equal(exposed.key, 'qqLocalRecall');
  assert.deepEqual(Object.keys(exposed.value).sort(), [
    'deleteConversations', 'listConversations', 'onRecordsDeleted', 'onRecovered', 'openManager',
  ]);
});

test('sandboxed manager preload exposes a separate API to avoid the global QQ preload collision', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'manager-preload.js'), 'utf8');
  let exposed;
  const contextBridge = { exposeInMainWorld(key, value) { exposed = { key, value }; } };
  const ipcRenderer = { invoke() {}, on() {} };
  vm.runInNewContext(source, {
    require(id) {
      if (id !== 'electron') throw new Error(`unexpected manager preload dependency: ${id}`);
      return { contextBridge, ipcRenderer };
    },
  }, { filename: 'manager-preload.js' });

  assert.equal(exposed.key, 'qqLocalRecallManager');
  assert.deepEqual(Object.keys(exposed.value).sort(), [
    'chooseStoragePath', 'deleteConversations', 'getStoragePath', 'listConversations', 'onRecordsDeleted',
  ]);
});
