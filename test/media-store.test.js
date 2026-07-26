const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_MEDIA_BYTES,
  MediaStore,
  parseAppImagePath,
  sniffImage,
} = require('../src/core/media-store');

const GIF = Buffer.from('GIF89a test payload', 'ascii');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPdata')]);

function pngWithDimensions(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const PNG = pngWithDimensions(2, 2);

function makeRoot(prefix = 'qq-local-recall-media-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function toAppImageUrl(filePath) {
  const parsed = path.win32.parse(filePath);
  return `appimg://${parsed.root[0]}${filePath.slice(parsed.root.length - 1).split('\\').map(encodeURIComponent).join('/')}`;
}

function makeQqMediaFile(bytes = GIF, area = 'Emoji', name = 'animated.jpg') {
  const root = makeRoot('qq-local-recall-appimg-');
  const filePath = path.join(root, 'Tencent Files', '123456', 'nt_qq', 'nt_data', area, 'emoji-recv', 'Ori', name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

test('sniffImage maps supported magic bytes to fixed MIME types and extensions', () => {
  assert.deepEqual(sniffImage(GIF), { mimeType: 'image/gif', extension: 'gif' });
  assert.deepEqual(sniffImage(PNG), { mimeType: 'image/png', extension: 'png' });
  assert.deepEqual(sniffImage(JPEG), { mimeType: 'image/jpeg', extension: 'jpg' });
  assert.deepEqual(sniffImage(WEBP), { mimeType: 'image/webp', extension: 'webp' });
});

test('saveAppImage trusts GIF magic instead of a jpg extension and deduplicates bytes', () => {
  const sourcePath = makeQqMediaFile();
  const store = new MediaStore(makeRoot());

  const first = store.saveAppImage(toAppImageUrl(sourcePath));
  const second = store.saveAppImage(toAppImageUrl(sourcePath));
  const expectedHash = crypto.createHash('sha256').update(GIF).digest('hex');

  assert.equal(first.relativePath, `media/${expectedHash}.gif`);
  assert.equal(first.mimeType, 'image/gif');
  assert.equal(first.staticFallback, false);
  assert.deepEqual(second, first);
  assert.deepEqual(fs.readdirSync(path.join(store.rootDir, 'media')), [`${expectedHash}.gif`]);
  assert.equal(fs.readdirSync(path.join(store.rootDir, 'media')).some(name => name.endsWith('.tmp')), false);
});

test('saveBytes accepts only a declared Canvas PNG fallback', () => {
  const store = new MediaStore(makeRoot());
  const saved = store.saveBytes(PNG, 'image/png', true);

  assert.equal(saved.mimeType, 'image/png');
  assert.equal(saved.staticFallback, true);
  assert.throws(() => store.saveBytes(GIF, 'image/png', true), /PNG/);
  assert.throws(() => store.saveBytes(PNG, 'image/jpeg', true), /PNG/);
});

test('static PNG dimensions reject a 60x60 placeholder for an 864x1920 picture', () => {
  const store = new MediaStore(makeRoot());
  const placeholder = store.saveBytes(pngWithDimensions(60, 60), 'image/png', true);
  const portrait = store.saveBytes(pngWithDimensions(432, 960), 'image/png', true);

  assert.throws(() => store.resolve(placeholder, { width: 864, height: 1920 }), /aspect ratio/);
  assert.equal(store.resolve(portrait, { width: 864, height: 1920 }), portrait.absolutePath);
});

test('static PNG dimensions do not impose a minimum size without original dimensions', () => {
  const store = new MediaStore(makeRoot());
  const expression = store.saveBytes(pngWithDimensions(24, 24), 'image/png', true);

  assert.equal(store.resolve(expression, {}), expression.absolutePath);
});

test('media input rejects oversized, unknown, remote and out-of-scope paths', () => {
  const store = new MediaStore(makeRoot());
  assert.throws(() => store.saveBytes(Buffer.alloc(MAX_MEDIA_BYTES + 1), 'image/png', true), /20 MiB/);
  assert.throws(() => store.saveBytes(Buffer.from('unknown'), 'image/png', true), /image/);
  assert.throws(() => parseAppImagePath('http://example.test/a.png'), /appimg/);
  assert.throws(() => parseAppImagePath('https://example.test/a.png'), /appimg/);

  const outside = path.join(makeRoot(), 'outside.gif');
  fs.writeFileSync(outside, GIF);
  assert.throws(() => store.saveAppImage(toAppImageUrl(outside)), /Pic|Emoji/);

  const source = makeQqMediaFile(GIF, 'Emoji');
  const escaped = toAppImageUrl(path.join(path.dirname(source), '..', '..', '..', '..', '..', 'outside.gif'));
  assert.throws(() => store.saveAppImage(escaped), /Pic|Emoji/);
});

test('resolve validates relative path, size and SHA-256', () => {
  const store = new MediaStore(makeRoot());
  const reference = store.saveBytes(PNG, 'image/png', true);
  assert.equal(store.resolve(reference), reference.absolutePath);

  assert.throws(() => store.resolve({ ...reference, relativePath: '../outside.png' }), /reference/);
  assert.throws(() => store.resolve({ ...reference, sizeBytes: reference.sizeBytes + 1 }), /size/);
  fs.writeFileSync(reference.absolutePath, Buffer.concat([PNG, Buffer.from('tampered')]));
  assert.throws(() => store.resolve(reference), /size|SHA-256/);
});

test('copyReferencedTo copies only valid referenced media and sweep deletes only orphans', () => {
  const store = new MediaStore(makeRoot());
  const keep = store.saveBytes(PNG, 'image/png', true);
  const orphan = store.saveBytes(JPEG, 'image/jpeg', false);
  const nextRoot = makeRoot('qq-local-recall-media-next-');

  store.copyReferencedTo(nextRoot, [keep]);
  assert.equal(fs.existsSync(path.join(nextRoot, keep.relativePath)), true);
  assert.equal(fs.existsSync(path.join(nextRoot, orphan.relativePath)), false);

  assert.deepEqual(store.sweep([keep]), [orphan.relativePath]);
  assert.equal(fs.existsSync(keep.absolutePath), true);
  assert.equal(fs.existsSync(orphan.absolutePath), false);
});

test('copyReferencedTo and sweep tolerate mixed image and voice references', () => {
  const store = new MediaStore(makeRoot());
  const keep = store.saveBytes(PNG, 'image/png', true);
  const orphan = store.saveBytes(JPEG, 'image/jpeg', false);
  const voiceSha = 'a'.repeat(64);
  const voiceReference = { sha256: voiceSha, relativePath: `ptt/${voiceSha}.amr`, sizeBytes: 5 };
  const nextRoot = makeRoot('qq-local-recall-media-mixed-');

  store.copyReferencedTo(nextRoot, [keep, voiceReference]);
  assert.equal(fs.existsSync(path.join(nextRoot, keep.relativePath)), true);

  assert.deepEqual(store.sweep([keep, voiceReference]), [orphan.relativePath]);
  assert.equal(fs.existsSync(keep.absolutePath), true);
  assert.equal(fs.existsSync(orphan.absolutePath), false);
});

test('copyReferencedTo replaces a corrupt destination with the validated source bytes', () => {
  const store = new MediaStore(makeRoot());
  const reference = store.saveBytes(PNG, 'image/png', true);
  const nextRoot = makeRoot('qq-local-recall-media-conflict-');
  const destination = path.join(nextRoot, reference.relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, 'corrupt');

  store.copyReferencedTo(nextRoot, [reference]);

  assert.deepEqual(fs.readFileSync(destination), PNG);
});
