const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function exposedKeys(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', ...relativePath.split('/')), 'utf8');
  let exposed;
  vm.runInNewContext(source, {
    require(id) {
      if (id !== 'electron') throw new Error(`unexpected preload dependency: ${id}`);
      return {
        contextBridge: { exposeInMainWorld(_key, value) { exposed = value; } },
        ipcRenderer: { invoke() {}, on() {} },
      };
    },
  }, { filename: relativePath });
  return new Set(Object.keys(exposed));
}

function calledMethods(relativePath, accessorPattern) {
  const source = fs.readFileSync(path.join(__dirname, '..', ...relativePath.split('/')), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(accessorPattern)) names.add(match[1]);
  return names;
}

// 1.4.2 shipped with manager.mjs calling listRecords/deleteRecord that the manager
// preload never exposed. These tests pin every renderer-side call to the real
// preload surface so the two hand-written preloads cannot drift again.
test('manager page only calls methods the manager preload actually exposes', () => {
  const keys = exposedKeys('src/ui/manager-preload.js');
  const called = calledMethods('src/ui/manager.mjs', /\bapi\.([A-Za-z0-9_]+)\s*\(/g);
  assert.ok(called.size >= 5, 'expected manager.mjs to call several api methods');
  for (const name of called) assert.ok(keys.has(name), `manager preload missing method: ${name}`);
});

test('chat renderer only calls methods the chat preload actually exposes', () => {
  const keys = exposedKeys('src/preload.js');
  const called = calledMethods('src/renderer.mjs', /window\.qqLocalRecall\??\.([A-Za-z0-9_]+)(?:\?\.)?\s*\(/g);
  assert.ok(called.size >= 2, 'expected renderer.mjs to call several qqLocalRecall methods');
  for (const name of called) assert.ok(keys.has(name), `chat preload missing method: ${name}`);
});
