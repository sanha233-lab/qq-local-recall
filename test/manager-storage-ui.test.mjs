import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manager UI exposes the current storage path and change-location action', async () => {
  const html = await readFile(new URL('../src/ui/manager.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../src/ui/manager.mjs', import.meta.url), 'utf8');
  const style = await readFile(new URL('../src/ui/manager.css', import.meta.url), 'utf8');

  assert.match(html, /id="storage-path"/);
  assert.match(html, /id="change-storage"/);
  assert.match(script, /getStoragePath/);
  assert.match(script, /chooseStoragePath/);
  assert.match(script, /window\.qqLocalRecallManager/);
  assert.match(style, /\.storage-location/);
});
