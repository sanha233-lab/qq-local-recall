'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isLocalStoragePath,
  readStoragePath,
  writeStoragePath,
} = require('../src/core/storage-path');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-path-'));
}

test('storage path persists atomically and is read on the next startup', () => {
  const configDir = tempDir();
  const selected = path.join(tempDir(), 'records-root');

  writeStoragePath(configDir, selected);

  assert.equal(readStoragePath(configDir), path.resolve(selected));
});

test('storage path falls back to the default when the config is invalid', () => {
  const configDir = tempDir();
  fs.writeFileSync(path.join(configDir, 'storage.json'), '{not-json', 'utf8');

  assert.equal(readStoragePath(configDir), path.resolve(configDir));
});

test('storage path falls back to the default when storagePath is empty', () => {
  const configDir = tempDir();
  fs.writeFileSync(path.join(configDir, 'storage.json'), '{"version":1,"storagePath":""}', 'utf8');

  assert.equal(readStoragePath(configDir), path.resolve(configDir));
});

test('storage path rejects UNC and relative paths', () => {
  assert.equal(isLocalStoragePath('relative-folder'), false);
  assert.equal(isLocalStoragePath('\\\\server\\share'), false);
  assert.equal(isLocalStoragePath(path.resolve('local-folder')), true);
});
