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

test('manager UI exposes the default-on missing-media recovery toggle', async () => {
  const html = await readFile(new URL('../src/ui/manager.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../src/ui/manager.mjs', import.meta.url), 'utf8');

  assert.match(html, /id="network-media-recovery"[^>]*type="checkbox"/);
  assert.match(html, /缺失媒体自动回源/);
  assert.match(html, /本地副本不可用时尝试从 QQ 媒体服务恢复/);
  assert.match(script, /getSettings/);
  assert.match(script, /updateSettings/);
  assert.match(script, /networkMediaRecovery/);
});
