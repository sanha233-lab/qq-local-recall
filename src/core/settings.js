'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({ version: 1, networkMediaRecovery: true, preventSelf: false });

function settingsFile(configDir) {
  return path.join(path.resolve(configDir), 'settings.json');
}

function readSettings(configDir) {
  let raw;
  try {
    raw = fs.readFileSync(settingsFile(configDir), 'utf8');
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const document = JSON.parse(raw);
    if (typeof document.networkMediaRecovery !== 'boolean') throw new TypeError('invalid settings document');
    const preventSelf = typeof document.preventSelf === 'boolean' ? document.preventSelf : false;
    return { version: 1, networkMediaRecovery: document.networkMediaRecovery, preventSelf };
  } catch {
    // An existing-but-corrupt file must not silently re-enable the
    // privacy-relevant network recovery switch; fall back to the off state.
    return { version: 1, networkMediaRecovery: false, preventSelf: false };
  }
}

function writeSettings(configDir, value) {
  if (typeof value?.networkMediaRecovery !== 'boolean') {
    throw new TypeError('networkMediaRecovery must be a boolean');
  }
  const preventSelf = typeof value.preventSelf === 'boolean' ? value.preventSelf : false;
  const filePath = settingsFile(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  const document = { version: 1, networkMediaRecovery: value.networkMediaRecovery, preventSelf };
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
  return document;
}

module.exports = { readSettings, writeSettings };
