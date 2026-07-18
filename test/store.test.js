const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ConversationStore } = require('../src/core/store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-'));
}

function record(msgId, peerKey = 'friend:u1', name = '好友一') {
  return {
    msgId,
    peer: { key: peerKey, type: peerKey.startsWith('group:') ? 'group' : 'friend', id: peerKey.split(':')[1], name },
    recallTime: String(Date.now()),
    message: { msgId, elements: [{ elementType: 1, textElement: { content: `text-${msgId}` } }] },
  };
}

test('ConversationStore appends atomically and deduplicates message ids', () => {
  const store = new ConversationStore(tempDir());
  assert.equal(store.save(record('m1')), true);
  assert.equal(store.save(record('m1')), false);
  assert.equal(store.get('m1').message.msgId, 'm1');
  assert.equal(fs.readdirSync(store.recordsDir).some(name => name.endsWith('.tmp')), false);
});

test('ConversationStore upserts an existing message atomically without increasing record count', () => {
  const store = new ConversationStore(tempDir());
  store.save(record('m1'));
  const updated = record('m1');
  updated.message.elements.push({ elementType: 6, faceElement: { faceIndex: 14 } });

  assert.equal(store.upsert(updated), false);
  assert.deepEqual(store.get('m1').message.elements.map(element => element.elementType), [1, 6]);
  assert.equal(store.listConversations()[0].count, 1);
  assert.equal(fs.readdirSync(store.recordsDir).some(name => name.endsWith('.tmp')), false);
});

test('ConversationStore returns all fixed persisted media references', () => {
  const store = new ConversationStore(tempDir());
  const first = { sha256: 'a'.repeat(64), relativePath: `media/${'a'.repeat(64)}.gif`, mimeType: 'image/gif', sizeBytes: 10, staticFallback: false };
  const second = { sha256: 'b'.repeat(64), relativePath: `media/${'b'.repeat(64)}.png`, mimeType: 'image/png', sizeBytes: 20, staticFallback: true };
  const value = record('m1');
  value.message.elements.push(
    { elementType: 2, picElement: {}, qqLocalRecallMedia: first },
    { elementType: 11, marketFaceElement: {}, qqLocalRecallMedia: second },
  );
  store.save(value);

  assert.deepEqual(store.mediaReferences(), [first, second]);
});

test('ConversationStore lists conversations by actual file size descending', () => {
  const store = new ConversationStore(tempDir());
  store.save(record('small', 'friend:u1', '好友一'));
  store.save(record('large-1', 'group:g1', '大群'));
  store.save(record('large-2', 'group:g1', '大群'));

  const rows = store.listConversations();

  assert.equal(rows[0].peerKey, 'group:g1');
  assert.equal(rows[0].count, 2);
  assert.ok(rows[0].sizeBytes >= rows[1].sizeBytes);
});

test('ConversationStore deletes selected conversations and their indexes', () => {
  const store = new ConversationStore(tempDir());
  store.save(record('m1', 'friend:u1'));
  store.save(record('m2', 'group:g1'));

  const result = store.deleteConversations(['friend:u1']);

  assert.deepEqual(result.deletedPeerKeys, ['friend:u1']);
  assert.deepEqual(result.deletedMessageIds, ['m1']);
  assert.equal(store.get('m1'), undefined);
  assert.equal(store.get('m2').msgId, 'm2');
});

test('ConversationStore ignores a corrupt conversation file and reports it', () => {
  const root = tempDir();
  const recordsDir = path.join(root, 'records');
  fs.mkdirSync(recordsDir, { recursive: true });
  fs.writeFileSync(path.join(recordsDir, 'broken.json'), '{not-json', 'utf8');

  const store = new ConversationStore(root);

  assert.equal(store.listConversations().length, 0);
  assert.equal(store.diagnostics.length, 1);
  assert.equal(fs.existsSync(path.join(recordsDir, 'broken.json')), true);
});

test('ConversationStore hashes peer keys instead of using them as paths', () => {
  const store = new ConversationStore(tempDir());
  store.save(record('m1', 'friend:../../escape'));
  const files = fs.readdirSync(store.recordsDir);

  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  assert.equal(fs.existsSync(path.join(store.rootDir, 'escape')), false);
});

test('ConversationStore displays a readable friend label instead of an internal UID', () => {
  const store = new ConversationStore(tempDir());
  store.save({
    msgId: 'm1',
    peer: { key: 'friend:u_raw', type: 'friend', id: 'u_raw', name: 'u_raw' },
    recallTime: '1',
    message: {
      msgId: 'm1',
      senderUin: '3358089740',
      elements: [{ elementType: 1, textElement: { content: 'hello' } }],
    },
  });

  const row = store.listConversations()[0];

  assert.equal(row.name, '好友（QQ号：3358089740）');
  assert.equal(row.id, '3358089740');
});

test('ConversationStore copies records when changing to a new local root', () => {
  const store = new ConversationStore(tempDir());
  const selected = path.join(tempDir(), 'new-records');
  store.save(record('m1'));

  store.changeRoot(selected);

  assert.equal(store.rootDir, path.resolve(selected));
  assert.equal(store.get('m1').message.msgId, 'm1');
  assert.equal(store.listConversations()[0].count, 1);
});
