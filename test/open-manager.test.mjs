import test from 'node:test';
import assert from 'node:assert/strict';
import { requestManagerOpen } from '../src/ui/open-manager.mjs';

test('requestManagerOpen reports an opened manager', async () => {
  assert.deepEqual(await requestManagerOpen({ openManager: async () => true }), { ok: true, message: '管理窗口已打开' });
});

test('requestManagerOpen returns a readable failure without throwing', async () => {
  const result = await requestManagerOpen({ openManager: async () => { throw new Error('IPC failed'); } });
  assert.equal(result.ok, false);
  assert.match(result.message, /IPC failed/);
});

