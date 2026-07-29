'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchQqMedia } = require('../src/core/qq-media-fetch');

const FILE_UUID = 'file-uuid-1';
const VALID_URL = `https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=${FILE_UUID}&spec=0&rkey=session-key`;
const GIF = Buffer.from('GIF89a image bytes', 'ascii');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function response(bytes, { status = 200, headers = {} } = {}) {
  return new Response(bytes, { status, headers });
}

test('restricted QQ fetch accepts supported image magic and ignores response MIME', async () => {
  const calls = [];
  const result = await fetchQqMedia({
    fetch: async (url, options) => {
      calls.push([url, options]);
      return response(GIF, { headers: { 'content-type': 'text/plain' } });
    },
    sourceUrl: VALID_URL,
    expectedFileUuid: FILE_UUID,
  });

  assert.deepEqual(result, { bytes: GIF, mimeType: 'image/gif' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], VALID_URL);
  assert.equal(calls[0][1].redirect, 'manual');
  assert.ok(calls[0][1].signal instanceof AbortSignal);
});

test('restricted QQ fetch rejects an rkey-less relative URL before requesting', async () => {
  const relative = `/download?appid=1407&fileid=${FILE_UUID}&spec=0`;
  let requests = 0;
  const fetch = async () => { requests += 1; return response(GIF); };

  await assert.rejects(fetchQqMedia({ fetch, sourceUrl: relative, expectedFileUuid: FILE_UUID }));
  assert.equal(requests, 0);
});

test('restricted QQ fetch reports only the rejected HTTP status', async () => {
  await assert.rejects(fetchQqMedia({
    fetch: async () => response(null, { status: 403 }),
    sourceUrl: VALID_URL, expectedFileUuid: FILE_UUID,
  }), /HTTP status 403/);
});

test('restricted QQ fetch validates every initial URL field before requesting', async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; return response(GIF); };
  const invalid = [
    VALID_URL.replace('https:', 'http:'),
    VALID_URL.replace('https://', 'https://user:pass@'),
    VALID_URL.replace('.cn/download', '.cn:444/download'),
    VALID_URL.replace('multimedia.nt.qq.com.cn', 'example.test'),
    VALID_URL.replace('/download', '/other'),
    VALID_URL.replace('appid=1407', 'appid=x'),
    VALID_URL.replace(`fileid=${FILE_UUID}`, 'fileid=other'),
    VALID_URL.replace('spec=0', 'spec=x'),
    VALID_URL.replace('&rkey=session-key', ''),
    VALID_URL.replace('rkey=session-key', 'rkey='),
  ];

  for (const sourceUrl of invalid) {
    await assert.rejects(fetchQqMedia({ fetch, sourceUrl, expectedFileUuid: FILE_UUID }));
  }
  assert.equal(calls, 0);
});

test('restricted QQ fetch follows at most two approved HTTPS redirects', async () => {
  const urls = [];
  const redirects = [
    'https://cdn.qq.com/one',
    'https://image.qpic.cn/two',
  ];
  const fetch = async url => {
    urls.push(url);
    const location = redirects.shift();
    return location ? response(null, { status: 302, headers: { location } }) : response(PNG);
  };

  const result = await fetchQqMedia({ fetch, sourceUrl: VALID_URL, expectedFileUuid: FILE_UUID });

  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(urls, [VALID_URL, 'https://cdn.qq.com/one', 'https://image.qpic.cn/two']);

  const endless = async () => response(null, {
    status: 302,
    headers: { location: 'https://next.gtimg.cn/still-redirecting' },
  });
  await assert.rejects(
    fetchQqMedia({ fetch: endless, sourceUrl: VALID_URL, expectedFileUuid: FILE_UUID }),
    /redirect/,
  );
});

test('restricted QQ fetch rejects unsafe redirect hosts and HTTP errors', async () => {
  await assert.rejects(fetchQqMedia({
    fetch: async () => response(null, { status: 302, headers: { location: 'https://example.test/image' } }),
    sourceUrl: VALID_URL,
    expectedFileUuid: FILE_UUID,
  }), /redirect/);
  await assert.rejects(fetchQqMedia({
    fetch: async () => response('denied', { status: 403 }),
    sourceUrl: VALID_URL,
    expectedFileUuid: FILE_UUID,
  }), /HTTP status/);
});

test('restricted QQ fetch rejects unknown image bytes and responses over 20 MiB', async () => {
  await assert.rejects(fetchQqMedia({
    fetch: async () => response('not an image'), sourceUrl: VALID_URL, expectedFileUuid: FILE_UUID,
  }), /image/);

  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
  await assert.rejects(fetchQqMedia({
    fetch: async () => response(oversized), sourceUrl: VALID_URL, expectedFileUuid: FILE_UUID,
  }), /20 MiB/);
});

test('restricted QQ fetch aborts a request after its timeout without exposing the URL', async () => {
  const fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  await assert.rejects(
    fetchQqMedia({ fetch, sourceUrl: VALID_URL, expectedFileUuid: FILE_UUID, timeoutMs: 5 }),
    error => {
      assert.match(error.message, /request failed/);
      assert.doesNotMatch(error.message, /rkey|fileid|session-key|download/);
      return true;
    },
  );
});

test('restricted QQ fetch keeps the timeout active while reading the response body', async () => {
  const fetch = async (_url, { signal }) => ({
    status: 200,
    ok: true,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          read() {
            return new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new Error('body aborted')), { once: true });
            });
          },
          releaseLock() {},
        };
      },
    },
  });

  await assert.rejects(
    fetchQqMedia({ fetch, sourceUrl: VALID_URL, expectedFileUuid: FILE_UUID, timeoutMs: 5 }),
    /request failed/,
  );
});
