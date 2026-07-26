'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const TYPES = [
  {
    test: bytes => ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')),
    mimeType: 'image/gif', extension: 'gif',
  },
  {
    test: bytes => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    mimeType: 'image/png', extension: 'png',
  },
  {
    test: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    mimeType: 'image/jpeg', extension: 'jpg',
  },
  {
    test: bytes => bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    mimeType: 'image/webp', extension: 'webp',
  },
];
const TYPE_BY_EXTENSION = new Map(TYPES.map(type => [type.extension, type]));
const REFERENCE_PATH = /^media\/([a-f0-9]{64})\.(gif|png|jpg|webp)$/;

function sniffImage(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const type = TYPES.find(candidate => candidate.test(bytes));
  if (!type) throw new TypeError('unsupported image bytes');
  return { mimeType: type.mimeType, extension: type.extension };
}

function readPngDimensions(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length < 24
    || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new TypeError('invalid PNG IHDR');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) throw new TypeError('invalid PNG dimensions');
  return { width, height };
}

function validateAspectRatio(actual, expected) {
  const width = Number(expected?.width);
  const height = Number(expected?.height);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) return;
  const expectedRatio = width / height;
  const actualRatio = actual.width / actual.height;
  if (Math.abs(actualRatio - expectedRatio) / expectedRatio > 0.15) {
    throw new TypeError('static fallback aspect ratio mismatch');
  }
}

function parseAppImagePath(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('source must be an appimg URL');
  }
  if (url.protocol !== 'appimg:' || !/^[a-z]$/i.test(url.hostname)) {
    throw new TypeError('source must be an appimg URL with a drive host');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new TypeError('appimg path encoding is invalid');
  }
  const filePath = path.win32.resolve(`${url.hostname.toUpperCase()}:\\`, pathname.replace(/^\/+/, ''));
  if (!/\\Tencent Files\\[^\\]+\\nt_qq\\nt_data\\(?:Pic|Emoji)(?:\\|$)/i.test(filePath)) {
    throw new TypeError('appimg path must be inside a QQ Pic or Emoji directory');
  }
  return filePath;
}

function referenceParts(reference) {
  const relativePath = String(reference?.relativePath || '').replaceAll('\\', '/');
  const match = REFERENCE_PATH.exec(relativePath);
  if (!match || String(reference?.sha256 || '') !== match[1]) {
    throw new TypeError('invalid media reference');
  }
  const type = TYPE_BY_EXTENSION.get(match[2]);
  if (reference.mimeType !== type.mimeType
    || !Number.isInteger(reference.sizeBytes)
    || reference.sizeBytes < 1
    || reference.sizeBytes > MAX_MEDIA_BYTES) {
    throw new TypeError('invalid media reference');
  }
  return { relativePath, sha256: match[1] };
}

class MediaStore {
  constructor(rootDir) {
    this.setRoot(rootDir);
  }

  setRoot(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.mediaDir = path.join(this.rootDir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    return this.rootDir;
  }

  saveAppImage(sourceUrl) {
    const sourcePath = parseAppImagePath(sourceUrl);
    const stats = fs.statSync(sourcePath);
    if (!stats.isFile()) throw new TypeError('appimg source must be a file');
    if (stats.size > MAX_MEDIA_BYTES) throw new RangeError('media exceeds 20 MiB');
    return this.saveBytes(fs.readFileSync(sourcePath), '', false);
  }

  saveBytes(value, declaredMime, staticFallback = false) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
    if (bytes.length > MAX_MEDIA_BYTES) throw new RangeError('media exceeds 20 MiB');
    const type = sniffImage(bytes);
    if (staticFallback === true
      && (declaredMime !== 'image/png' || type.mimeType !== 'image/png')) {
      throw new TypeError('Canvas fallback must be PNG');
    }
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const relativePath = `media/${sha256}.${type.extension}`;
    const absolutePath = path.join(this.rootDir, ...relativePath.split('/'));
    if (!fs.existsSync(absolutePath)) {
      const tempPath = `${absolutePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(tempPath, bytes, { flag: 'wx' });
        fs.renameSync(tempPath, absolutePath);
      } finally {
        fs.rmSync(tempPath, { force: true });
      }
    }
    const reference = {
      sha256,
      relativePath,
      mimeType: type.mimeType,
      sizeBytes: bytes.length,
      staticFallback: staticFallback === true,
      absolutePath,
    };
    this.resolve(reference);
    return reference;
  }

  resolve(reference, expectedDimensions) {
    const { relativePath, sha256 } = referenceParts(reference);
    const absolutePath = path.resolve(this.rootDir, ...relativePath.split('/'));
    const relative = path.relative(this.rootDir, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new TypeError('invalid media reference path');
    }
    const stats = fs.statSync(absolutePath);
    if (!stats.isFile() || stats.size !== reference.sizeBytes) {
      throw new Error('media size mismatch');
    }
    const bytes = fs.readFileSync(absolutePath);
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== sha256) throw new Error('media SHA-256 mismatch');
    if (reference.staticFallback === true) {
      validateAspectRatio(readPngDimensions(bytes), expectedDimensions);
    }
    return absolutePath;
  }

  copyReferencedTo(nextRoot, references) {
    const destinationRoot = path.resolve(nextRoot);
    const destinationMedia = path.join(destinationRoot, 'media');
    fs.mkdirSync(destinationMedia, { recursive: true });
    for (const reference of references) {
      const source = this.resolve(reference);
      const { relativePath } = referenceParts(reference);
      const destination = path.join(destinationRoot, ...relativePath.split('/'));
      fs.copyFileSync(source, destination);
    }
  }

  sweep(references) {
    const retained = new Set(references.map(reference => referenceParts(reference).relativePath));
    const removed = [];
    for (const name of fs.readdirSync(this.mediaDir)) {
      const relativePath = `media/${name}`;
      if (!REFERENCE_PATH.test(relativePath) || retained.has(relativePath)) continue;
      fs.rmSync(path.join(this.mediaDir, name), { force: true });
      removed.push(relativePath);
    }
    return removed;
  }
}

const AUDIO_EXTENSIONS = new Set(['amr', 'silk', 'slk', 'mp3', 'm4a', 'ogg', 'wav', 'aac']);
const PTT_REFERENCE_PATH = /^ptt\/([a-f0-9]{64})\.(amr|silk|slk|mp3|m4a|ogg|wav|aac)$/;

class PttStore {
  constructor(rootDir) {
    this.setRoot(rootDir);
  }

  setRoot(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.pttDir = path.join(this.rootDir, 'ptt');
    fs.mkdirSync(this.pttDir, { recursive: true });
    return this.rootDir;
  }

  saveFile(sourcePath) {
    const stats = fs.statSync(sourcePath);
    if (!stats.isFile()) throw new TypeError('PTT source must be a file');
    const ext = path.extname(sourcePath).replace('.', '').toLowerCase();
    const validExt = AUDIO_EXTENSIONS.has(ext) ? ext : 'amr';
    const bytes = fs.readFileSync(sourcePath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const relativePath = `ptt/${sha256}.${validExt}`;
    const absolutePath = path.join(this.rootDir, 'ptt', `${sha256}.${validExt}`);
    if (!fs.existsSync(absolutePath)) {
      const tempPath = `${absolutePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(tempPath, bytes, { flag: 'wx' });
        fs.renameSync(tempPath, absolutePath);
      } finally {
        fs.rmSync(tempPath, { force: true });
      }
    }
    return { relativePath, absolutePath, sha256, sizeBytes: bytes.length, ext: validExt };
  }

  resolve(relativePath) {
    const rel = String(relativePath || '').replaceAll('\\', '/');
    if (!PTT_REFERENCE_PATH.test(rel)) throw new TypeError('invalid PTT reference');
    const absolutePath = path.resolve(this.rootDir, ...rel.split('/'));
    const relative = path.relative(this.rootDir, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new TypeError('invalid PTT reference path');
    }
    if (!fs.existsSync(absolutePath)) throw new Error('PTT file not found');
    return absolutePath;
  }

  copyReferencedTo(nextRoot, references) {
    const destPttDir = path.join(path.resolve(nextRoot), 'ptt');
    fs.mkdirSync(destPttDir, { recursive: true });
    for (const ref of references) {
      const rel = String(ref?.relativePath || '').replaceAll('\\', '/');
      if (!PTT_REFERENCE_PATH.test(rel)) continue;
      try {
        const src = this.resolve(rel);
        const dest = path.join(path.resolve(nextRoot), ...rel.split('/'));
        fs.copyFileSync(src, dest);
      } catch { /* skip missing */ }
    }
  }

  sweep(references) {
    const retained = new Set(
      references
        .map(r => String(r?.relativePath || '').replaceAll('\\', '/'))
        .filter(r => PTT_REFERENCE_PATH.test(r)),
    );
    const removed = [];
    for (const name of fs.readdirSync(this.pttDir)) {
      const rel = `ptt/${name}`;
      if (!PTT_REFERENCE_PATH.test(rel) || retained.has(rel)) continue;
      fs.rmSync(path.join(this.pttDir, name), { force: true });
      removed.push(rel);
    }
    return removed;
  }
}

module.exports = {
  MAX_MEDIA_BYTES, MediaStore, PttStore, parseAppImagePath, readPngDimensions, sniffImage, validateAspectRatio,
};
