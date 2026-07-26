'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readSettings, writeSettings } = require('../src/core/settings');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-settings-'));
}

test('settings default network media recovery to enabled for missing or invalid files', () => {
  const missing = tempDir();
  assert.deepEqual(readSettings(missing), { version: 1, networkMediaRecovery: true, preventSelf: false });

  const invalid = tempDir();
  fs.writeFileSync(path.join(invalid, 'settings.json'), '{broken', 'utf8');
  assert.deepEqual(readSettings(invalid), { version: 1, networkMediaRecovery: true, preventSelf: false });

  const missingField = tempDir();
  fs.writeFileSync(path.join(missingField, 'settings.json'), '{"version":1}', 'utf8');
  assert.deepEqual(readSettings(missingField), { version: 1, networkMediaRecovery: true, preventSelf: false });
});

test('settings persist a disabled network recovery flag atomically', () => {
  const configDir = tempDir();

  writeSettings(configDir, { networkMediaRecovery: false, preventSelf: false });

  assert.deepEqual(readSettings(configDir), { version: 1, networkMediaRecovery: false, preventSelf: false });
  assert.deepEqual(fs.readdirSync(configDir), ['settings.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')), {
    version: 1,
    networkMediaRecovery: false,
    preventSelf: false,
  });
});

test('settings persist preventSelf flag', () => {
  const configDir = tempDir();
  writeSettings(configDir, { networkMediaRecovery: true, preventSelf: true });
  assert.deepEqual(readSettings(configDir), { version: 1, networkMediaRecovery: true, preventSelf: true });
});

test('settings reject non-boolean updates', () => {
  const configDir = tempDir();
  for (const value of [undefined, null, 1, 'false']) {
    assert.throws(() => writeSettings(configDir, { networkMediaRecovery: value }), /boolean/);
  }
});
