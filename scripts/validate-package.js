'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (manifest.manifest_version !== 4) throw new Error('manifest_version must be 4');
if (manifest.version !== pkg.version) throw new Error('manifest and package versions must match');
for (const relative of Object.values(manifest.injects || {})) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`missing inject file: ${relative}`);
}
if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).length) {
  throw new Error('runtime and development dependencies must remain empty');
}
const managerHtml = fs.readFileSync(path.join(root, 'src', 'ui', 'manager.html'), 'utf8');
if (!managerHtml.includes("connect-src 'none'")) throw new Error('manager CSP must block connections');

const delivery = path.join(root, 'delivery');
const expectedDelivery = [
  `QQ-Local-Recall-v${pkg.version}.zip`,
  `QQ-Local-Recall-source-v${pkg.version}.zip`,
  'install.ps1',
  'rollback.ps1',
  'vendor/LiteLoaderQQNT-1.4.1.zip',
  'vendor/dbghelp_x64-1.1.2.dll',
];
const checksumLines = fs.readFileSync(path.join(delivery, 'SHA256SUMS.txt'), 'utf8')
  .trim().split(/\r?\n/);
const checksums = new Map(checksumLines.map(line => {
  const match = line.match(/^([A-Fa-f0-9]{64})  (.+)$/);
  if (!match) throw new Error(`invalid checksum line: ${line}`);
  return [match[2], match[1].toUpperCase()];
}));
if (checksums.size !== expectedDelivery.length) throw new Error('unexpected delivery checksum count');
for (const relative of expectedDelivery) {
  const file = path.join(delivery, ...relative.split('/'));
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
  if (checksums.get(relative) !== actual) throw new Error(`delivery checksum mismatch: ${relative}`);
}
const pluginZip = fs.readFileSync(path.join(delivery, expectedDelivery[0]));
for (const relative of [
  ...Object.values(manifest.injects || {}),
  'src/core/media-store.js',
  'src/ui/media-capture.mjs',
  'src/ui/picture-memory.mjs',
]) {
  const archiveRelative = relative.replace(/^\.\//, '').replaceAll('\\', '/');
  const archiveEntries = [
    `QQ-Local-Recall/${archiveRelative}`,
    `QQ-Local-Recall\\${archiveRelative.replaceAll('/', '\\')}`,
  ];
  if (!archiveEntries.some(entry => pluginZip.includes(Buffer.from(entry)))) {
    throw new Error(`plugin archive missing entry: ${relative}`);
  }
}

console.log('Package validation passed: Manifest V4, matching version, offline CSP, media entries, and SHA-256 checks verified.');
