import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_CAPTURE_BYTES, captureRenderedMedia } from '../src/ui/media-capture.mjs';

const CONTAINER_SELECTOR = '.pic-element, [class*="pic-element"], [class*="market-face"]';

function contentWith(containers) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, CONTAINER_SELECTOR);
      return containers;
    },
  };
}

function containerWith(nodes, { excluded = false } = {}) {
  return {
    closest(selector) {
      assert.match(selector, /gray-tip-message/);
      return excluded ? this : null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'img, canvas');
      return nodes;
    },
  };
}

function image(overrides = {}) {
  return {
    tagName: 'IMG', currentSrc: '', src: '', complete: true, naturalWidth: 2, naturalHeight: 2,
    closest(selector) {
      assert.match(selector, /avatar|loading|spinner/);
      return null;
    },
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

test('captureRenderedMedia returns one appimg candidate per real media container', async () => {
  const sourceUrl = 'appimg://D/QQ/Tencent%20Files/123/nt_qq/nt_data/Emoji/a.jpg';
  const node = image({ currentSrc: sourceUrl });
  const duplicate = image({ currentSrc: sourceUrl });

  const result = await captureRenderedMedia(contentWith([containerWith([node, duplicate])]));

  assert.deepEqual(result, [{ sourceUrl, staticFallback: false, node }]);
});

test('captureRenderedMedia keeps a Canvas fallback with a completed appimg candidate', async () => {
  const sourceUrl = 'appimg://D/QQ/Tencent%20Files/123/nt_qq/nt_data/Pic/a.png';
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const node = image({ currentSrc: sourceUrl, naturalWidth: 864, naturalHeight: 1920 });
  node.ownerDocument = canvasDocument(new Blob([png], { type: 'image/png' }));

  const [candidate] = await captureRenderedMedia(contentWith([containerWith([node])]));

  assert.equal(candidate.sourceUrl, sourceUrl);
  assert.equal(candidate.width, 864);
  assert.equal(candidate.height, 1920);
  assert.deepEqual([...candidate.bytes], [...png]);
});

test('captureRenderedMedia reports an HTTPS candidate before the image finishes loading', async () => {
  const sourceUrl = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=f1&spec=0&rkey=secret';
  const node = image({ currentSrc: sourceUrl, complete: false, naturalWidth: 0, naturalHeight: 0 });

  const result = await captureRenderedMedia(contentWith([containerWith([node])]));

  assert.deepEqual(result, [{ sourceUrl, staticFallback: false, node }]);
});

test('captureRenderedMedia keeps a Canvas fallback with a completed HTTPS candidate', async () => {
  const sourceUrl = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=f1&spec=0&rkey=secret';
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const node = image({ currentSrc: sourceUrl, naturalWidth: 864, naturalHeight: 1920 });
  node.ownerDocument = canvasDocument(new Blob([png], { type: 'image/png' }));

  const [candidate] = await captureRenderedMedia(contentWith([containerWith([node])]));

  assert.equal(candidate.sourceUrl, sourceUrl);
  assert.equal(candidate.width, 864);
  assert.equal(candidate.height, 1920);
  assert.deepEqual([...candidate.bytes], [...png]);
});

test('captureRenderedMedia includes dimensions when a completed image has a Canvas fallback', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const node = image({ currentSrc: '', naturalWidth: 864, naturalHeight: 1920 });
  node.ownerDocument = canvasDocument(new Blob([png], { type: 'image/png' }));

  const result = await captureRenderedMedia(contentWith([containerWith([node])]));

  assert.equal(result[0].mimeType, 'image/png');
  assert.equal(result[0].staticFallback, true);
  assert.equal(result[0].width, 864);
  assert.equal(result[0].height, 1920);
  assert.equal(result[0].node, node);
  assert.deepEqual([...result[0].bytes], [...png]);
});

test('captureRenderedMedia skips incomplete Canvas images, failures and blobs over 20 MiB', async () => {
  const incomplete = image({ complete: false, naturalWidth: 60, naturalHeight: 60 });
  incomplete.ownerDocument = canvasDocument(new Blob([new Uint8Array([1])], { type: 'image/png' }));
  const failed = image();
  failed.ownerDocument = canvasDocument(null);
  const oversized = image();
  oversized.ownerDocument = canvasDocument(new Blob([new Uint8Array(MAX_CAPTURE_BYTES + 1)], { type: 'image/png' }));

  const result = await captureRenderedMedia(contentWith([
    containerWith([incomplete]), containerWith([failed]), containerWith([oversized]),
  ]));
  assert.equal(result.filter(Boolean).length, 0);
});

test('captureRenderedMedia excludes gray tips, avatars, loading nodes, video and SVG', async () => {
  const sourceUrl = 'appimg://D/QQ/Tencent%20Files/123/nt_qq/nt_data/Pic/a.png';
  const avatar = image({ currentSrc: sourceUrl, closest() { return {}; } });
  const loading = image({ currentSrc: sourceUrl, closest() { return {}; } });
  const valid = image({ currentSrc: sourceUrl });
  const excludedContainer = containerWith([valid], { excluded: true });
  const videoAndSvgOnly = containerWith([{ tagName: 'VIDEO' }, { tagName: 'SVG' }]);

  const result = await captureRenderedMedia(contentWith([
    excludedContainer, containerWith([avatar]), containerWith([loading]), videoAndSvgOnly,
  ]));
  assert.equal(result.filter(Boolean).length, 0);
});

test('captureRenderedMedia preserves mediaIndex when an earlier real container is still loading', async () => {
  const loading = image({ complete: false, currentSrc: 'data:image/png;base64,loading', closest() { return {}; } });
  const sourceUrl = 'appimg://D/QQ/Tencent%20Files/123/nt_qq/nt_data/Pic/second.png';
  const second = image({ currentSrc: sourceUrl });

  const result = await captureRenderedMedia(contentWith([containerWith([loading]), containerWith([second])]));

  assert.equal(result.length, 2);
  assert.equal(result[0], undefined);
  assert.equal(result[1].sourceUrl, sourceUrl);
});
