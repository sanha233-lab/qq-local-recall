import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_CAPTURE_BYTES, captureRenderedMedia } from '../src/ui/media-capture.mjs';

function contentWith(nodes) {
  return { querySelectorAll(selector) { assert.equal(selector, 'img,canvas,video,svg'); return nodes; } };
}

function image(overrides = {}) {
  return {
    tagName: 'IMG', currentSrc: '', src: '', naturalWidth: 2, naturalHeight: 2,
    closest() { return null; },
    ...overrides,
  };
}

function canvasDocument(blob) {
  return {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        getContext() { return { drawImage() {} }; },
        toBlob(callback, mime) { assert.equal(mime, 'image/png'); callback(blob); },
      };
    },
  };
}

test('captureRenderedMedia returns an appimg URL without reading arbitrary paths', async () => {
  const sourceUrl = 'appimg://D/QQ/Tencent%20Files/123/nt_qq/nt_data/Emoji/a.jpg';
  const result = await captureRenderedMedia(contentWith([image({ currentSrc: sourceUrl })]));

  assert.deepEqual(result, [{ sourceUrl, staticFallback: false }]);
});

test('captureRenderedMedia converts a remote image only through Canvas PNG', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const node = image({ currentSrc: 'https://example.test/a.gif' });
  node.ownerDocument = canvasDocument(new Blob([png], { type: 'image/png' }));

  const result = await captureRenderedMedia(contentWith([node]));

  assert.equal(result[0].sourceUrl, undefined);
  assert.equal(result[0].mimeType, 'image/png');
  assert.equal(result[0].staticFallback, true);
  assert.deepEqual([...result[0].bytes], [...png]);
});

test('captureRenderedMedia skips Canvas failures and blobs over 20 MiB', async () => {
  const failed = image({ currentSrc: 'http://example.test/a.png' });
  failed.ownerDocument = canvasDocument(null);
  const oversized = image({ currentSrc: 'https://example.test/b.png' });
  oversized.ownerDocument = canvasDocument(new Blob([new Uint8Array(MAX_CAPTURE_BYTES + 1)], { type: 'image/png' }));

  assert.deepEqual(await captureRenderedMedia(contentWith([failed, oversized])), []);
});

test('captureRenderedMedia excludes gray tips and avatar nodes', async () => {
  const sourceUrl = 'appimg://D/QQ/Tencent%20Files/123/nt_qq/nt_data/Pic/a.png';
  const excluded = image({ currentSrc: sourceUrl, closest(selector) { assert.match(selector, /gray-tip-message/); return {}; } });
  assert.deepEqual(await captureRenderedMedia(contentWith([excluded])), []);
});
