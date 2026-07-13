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
