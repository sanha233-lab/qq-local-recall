'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('install.ps1 auto-detects the installed QQ directory during DryRun', () => {
  const script = path.resolve(__dirname, '..', 'delivery', 'install.ps1');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-DryRun',
  ], { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /Auto-detected QQ path:/);
  assert.match(output, /QQ version:\s+9\.9\.32-50969/);
});
