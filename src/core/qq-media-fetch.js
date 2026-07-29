'use strict';

const { MAX_MEDIA_BYTES, sniffImage } = require('./media-store');

const INITIAL_HOSTS = new Set(['multimedia.nt.qq.com.cn', 'gchat.qpic.cn']);
const REDIRECT_SUFFIXES = ['.qq.com', '.qpic.cn', '.gtimg.cn'];
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;

function parseInitialUrl(value, expectedFileUuid) {
  let url;
  try {
    url = new URL(value);
  } catch { throw new TypeError('media URL is invalid'); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) {
    throw new TypeError('media URL transport is invalid');
  }
  if (!INITIAL_HOSTS.has(url.hostname) || url.pathname !== '/download') {
    throw new TypeError('media URL endpoint is invalid');
  }
  const appid = url.searchParams.get('appid');
  const fileid = url.searchParams.get('fileid');
  const spec = url.searchParams.get('spec');
  const rkey = url.searchParams.get('rkey');
  if (!/^\d+$/.test(appid || '') || !/^\d+$/.test(spec || '')
    || !rkey || fileid !== String(expectedFileUuid || '')) {
    throw new TypeError('media URL query is invalid');
  }
  return url;
}

function parseRedirectUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new TypeError('media redirect is invalid'); }
  const allowedHost = REDIRECT_SUFFIXES.some(suffix => (
    url.hostname === suffix.slice(1) || url.hostname.endsWith(suffix)
  ));
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')
    || url.username || url.password || !allowedHost) {
    throw new TypeError('media redirect is invalid');
  }
  return url;
}

async function requestOnce(fetch, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.href, {
      redirect: 'manual', signal: controller.signal, credentials: 'include',
    });
    return { response, controller, stop: () => clearTimeout(timer) };
  } catch {
    clearTimeout(timer);
    throw new Error('media request failed');
  }
}

async function readLimitedBody(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
    throw new RangeError('media exceeds 20 MiB');
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_MEDIA_BYTES) throw new RangeError('media exceeds 20 MiB');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MEDIA_BYTES) {
        await reader.cancel();
        throw new RangeError('media exceeds 20 MiB');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

async function fetchQqMedia({
  fetch, sourceUrl, expectedFileUuid, timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof fetch !== 'function') throw new TypeError('session fetch is unavailable');
  let url = parseInitialUrl(sourceUrl, expectedFileUuid);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const request = await requestOnce(fetch, url, timeoutMs);
    try {
      const { response } = request;
      if (response.status >= 300 && response.status < 400) {
        if (redirects === MAX_REDIRECTS) throw new Error('media redirect limit exceeded');
        const location = response.headers?.get?.('location');
        if (!location) throw new Error('media redirect is invalid');
        url = parseRedirectUrl(location, url);
        continue;
      }
      if (!response.ok) throw new Error(`media HTTP status ${Number(response.status) || 0}`);
      const bytes = await readLimitedBody(response);
      return { bytes, mimeType: sniffImage(bytes).mimeType };
    } catch (error) {
      if (request.controller.signal.aborted) throw new Error('media request failed');
      throw error;
    } finally {
      request.stop();
    }
  }
  throw new Error('media redirect limit exceeded');
}

module.exports = { fetchQqMedia };
