'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isLocalStoragePath(value) {
  const text = String(value || '').trim();
  return Boolean(text) && path.isAbsolute(text) && !/^\\\\/.test(text);
}

function configFile(configDir) {
  return path.join(path.resolve(configDir), 'storage.json');
}

function readStoragePath(configDir) {
  const defaultPath = path.resolve(configDir);
  try {
    const document = JSON.parse(fs.readFileSync(configFile(configDir), 'utf8'));
    const rawPath = String(document.storagePath || '').trim();
    if (!isLocalStoragePath(rawPath)) return defaultPath;
    return path.resolve(rawPath);
  } catch {
    return defaultPath;
  }
}

function writeStoragePath(configDir, storagePath) {
  const selected = path.resolve(String(storagePath || ''));
  if (!isLocalStoragePath(selected)) throw new TypeError('storage path must be an absolute local path');
  const filePath = configFile(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify({ version: 1, storagePath: selected }, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
  return selected;
}

module.exports = { isLocalStoragePath, readStoragePath, writeStoragePath };
