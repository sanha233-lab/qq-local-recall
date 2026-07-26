import test from 'node:test';
import assert from 'node:assert/strict';

import { MEDIA_RETRY_DELAYS, createMediaRetryCoordinator } from '../src/ui/media-retry.mjs';

test('media retry coordinator schedules the five approved attempts', () => {
  const delays = [];
  const coordinator = createMediaRetryCoordinator({
    capture: async () => [], persist: async () => ({}),
    schedule(callback, delay) { delays.push(delay); return callback; },
  });

  coordinator.start('m1');

  assert.deepEqual(delays, [0, 250, 1000, 3000, 8000]);
  assert.deepEqual(MEDIA_RETRY_DELAYS, [0, 250, 1000, 3000, 8000]);
});

test('media retry coordinator retries failures, strips DOM nodes and stops after success', async () => {
  const node = { src: 'loading' };
  const candidate = { sourceUrl: 'appimg://D/a', staticFallback: false, node };
  const inputs = [];
  let calls = 0;
  const coordinator = createMediaRetryCoordinator({
    capture: async () => [candidate],
    async persist(input) {
      inputs.push(input);
      calls += 1;
      if (calls === 1) throw new Error('temporary');
      return { displayUrl: 'file:///saved.gif' };
    },
    schedule() {},
  });

  await coordinator.attempt('m1', false);
  await coordinator.attempt('m1', false);
  await coordinator.attempt('m1', true);

  assert.equal(calls, 2);
  assert.deepEqual(inputs[0], { messageId: 'm1', mediaIndex: 0, sourceUrl: 'appimg://D/a' });
  assert.equal(node.src, 'file:///saved.gif');
});

test('media retry coordinator reapplies a saved display URL after QQ replaces the image node', async () => {
  const firstNode = { src: 'loading-first' };
  const replacementNode = { src: 'loading-replacement' };
  let captures = 0;
  let persists = 0;
  const coordinator = createMediaRetryCoordinator({
    capture: async () => [{
      sourceUrl: 'appimg://D/a',
      node: captures++ === 0 ? firstNode : replacementNode,
    }],
    async persist() {
      persists += 1;
      return { displayUrl: 'file:///saved.png' };
    },
    schedule() {},
  });

  await coordinator.attempt('m1', false);
  await coordinator.attempt('m1', false);

  assert.equal(persists, 1);
  assert.equal(firstNode.src, 'file:///saved.png');
  assert.equal(replacementNode.src, 'file:///saved.png');
});

test('media retry coordinator replaces a final loading node with unavailable text', async () => {
  const replacements = [];
  const node = {
    complete: false,
    closest(selector) { assert.match(selector, /loading|spinner/); return {}; },
    replaceWith(value) { replacements.push(value); },
    ownerDocument: { createElement() { return { className: '', textContent: '' }; } },
  };
  const coordinator = createMediaRetryCoordinator({
    capture: async () => [{ sourceUrl: 'https://multimedia.nt.qq.com.cn/download', node }],
    persist: async () => { throw new Error('still unavailable'); },
    schedule() {},
  });

  await coordinator.attempt('m1', true);

  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].textContent, '图片暂不可用');
  assert.equal(replacements[0].className, 'qq-local-recall-media-unavailable');
});

test('media retry coordinator replaces a completed placeholder after persistence is rejected', async () => {
  const replacements = [];
  const node = {
    complete: true,
    closest() { return null; },
    replaceWith(value) { replacements.push(value); },
    ownerDocument: { createElement() { return { className: '', textContent: '' }; } },
  };
  const coordinator = createMediaRetryCoordinator({
    capture: async () => [{ mimeType: 'image/png', bytes: new Uint8Array([1]), width: 60, height: 60, node }],
    persist: async () => { throw new Error('static fallback aspect ratio mismatch'); },
    schedule() {},
  });

  await coordinator.attempt('m1', true);

  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].textContent, '图片暂不可用');
});

test('media retry coordinator finalizes an empty candidate set after the last attempt', async () => {
  const finalized = [];
  const coordinator = createMediaRetryCoordinator({
    capture: async () => [],
    persist: async () => ({}),
    schedule() {},
    finalize: messageId => finalized.push(messageId),
  });

  await coordinator.attempt('m1', false);
  await coordinator.attempt('m1', true);

  assert.deepEqual(finalized, ['m1']);
});

test('media retry coordinator preserves a sparse media index without submitting its empty slot', async () => {
  const candidates = [];
  candidates.length = 2;
  candidates[1] = { sourceUrl: 'appimg://D/second' };
  const inputs = [];
  const coordinator = createMediaRetryCoordinator({
    capture: async () => candidates,
    persist: async input => { inputs.push(input); return { displayUrl: 'file:///second' }; },
    schedule() {},
  });

  await coordinator.attempt('m1', false);

  assert.deepEqual(inputs, [{ messageId: 'm1', mediaIndex: 1, sourceUrl: 'appimg://D/second' }]);
});
