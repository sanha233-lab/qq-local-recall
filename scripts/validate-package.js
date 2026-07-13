'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (manifest.manifest_version !== 4) throw new Error('manifest_version must be 4');
for (const relative of Object.values(manifest.injects || {})) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`missing inject file: ${relative}`);
}
if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).length) {
  throw new Error('runtime and development dependencies must remain empty');
}
const managerHtml = fs.readFileSync(path.join(root, 'src', 'ui', 'manager.html'), 'utf8');
if (!managerHtml.includes("connect-src 'none'")) throw new Error('manager CSP must block connections');
console.log('Package validation passed: Manifest V4, inject files, zero dependencies, and offline CSP verified.');

