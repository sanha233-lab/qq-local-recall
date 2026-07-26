'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SETTINGS = Object.freeze({ version: 1, networkMediaRecovery: true, preventSelf: false });

function settingsFile(configDir) {
  return path.join(path.resolve(configDir), 'settings.json');
}

function readSettings(configDir) {
  try {
    const document = JSON.parse(fs.readFileSync(settingsFile(configDir), 'utf8'));
    if (typeof document.networkMediaRecovery !== 'boolean') return { ...DEFAULT_SETTINGS };
    const preventSelf = typeof document.preventSelf === 'boolean' ? document.preventSelf : false;
    return { version: 1, networkMediaRecovery: document.networkMediaRecovery, preventSelf };
  } catch {
    return { ...DEFAULT_SETTINGS };
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
