import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('renderer uses message-row native notices without detached toast or bubble badge', async () => {
  const source = await readFile(new URL('../src/renderer.mjs', import.meta.url), 'utf8');

  assert.match(source, /placeRecallNotice/);
  assert.match(source, /removeRecallNotice/);
  assert.match(source, /qq-local-recall-notice__pill/);
  assert.doesNotMatch(source, /qq-local-recall-toast/);
  assert.doesNotMatch(source, /qq-local-recall-badge/);
  assert.doesNotMatch(source, /showRecallNotice/);
});
