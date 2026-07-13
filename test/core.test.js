const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CandidateCache,
  sanitizeMessage,
  getRecallInfo,
  recoverRecall,
  getPeer,
} = require('../src/core/recall');

function textMessage(overrides = {}) {
  return {
    msgId: 'm1',
    chatType: 1,
    peerUid: 'u100',
    peerName: '测试好友',
    senderUid: 'u100',
    senderNick: '好友',
    msgTime: '1000',
    elements: [{ elementType: 1, textElement: { content: 'hello' } }],
    ...overrides,
  };
}

test('sanitizeMessage keeps text, face and reply elements only', () => {
  const message = textMessage({
    elements: [
      { elementType: 1, textElement: { content: 'hello' } },
      { elementType: 6, faceElement: { faceIndex: 14, faceText: '/微笑' } },
      { elementType: 7, replyElement: { replayMsgId: 'old', sourceMsgText: 'quoted' } },
      { elementType: 2, picElement: { sourcePath: 'C:\\secret.png' } },
    ],
  });

  const sanitized = sanitizeMessage(message);

  assert.deepEqual(sanitized.elements.map(item => item.elementType), [1, 6, 7]);
  assert.equal(JSON.stringify(sanitized).includes('secret.png'), false);
});

test('sanitizeMessage rejects messages without supported content', () => {
  const message = textMessage({ elements: [{ elementType: 2, picElement: { sourcePath: 'x' } }] });
  assert.equal(sanitizeMessage(message), null);
});

test('CandidateCache evicts the oldest message at its limit', () => {
  const cache = new CandidateCache(2);
  cache.set(textMessage({ msgId: 'm1' }));
  cache.set(textMessage({ msgId: 'm2' }));
  cache.set(textMessage({ msgId: 'm3' }));

  assert.equal(cache.get('m1'), undefined);
  assert.equal(cache.get('m2').msgId, 'm2');
  assert.equal(cache.size, 2);
});

test('getRecallInfo recognizes a QQ revoke gray tip', () => {
  const recall = textMessage({
    elements: [{
      elementType: 8,
      grayTipElement: {
        subElementType: 1,
        revokeElement: { origMsgUid: 'm1', isSelfOperate: false, operatorNick: '好友' },
      },
    }],
  });

  assert.equal(getRecallInfo(recall).origMsgUid, 'm1');
});

test('recoverRecall restores a cached peer message and adds a local mark', () => {
  const original = textMessage();
  const recall = textMessage({
    msgId: 'tip1',
    recallTime: '2000',
    elements: [{ elementType: 8, grayTipElement: { subElementType: 1, revokeElement: {
      origMsgUid: 'm1', isSelfOperate: false, operatorNick: '好友',
    } } }],
  });

  const recovered = recoverRecall(recall, original, { preventSelf: false });

  assert.equal(recovered.msgId, 'm1');
  assert.equal(recovered.qqLocalRecall.operatorName, '好友');
  assert.equal(recovered.qqLocalRecall.recallTime, '2000');
});

test('recoverRecall leaves self-operated recalls untouched by default', () => {
  const recall = textMessage({
    elements: [{ elementType: 8, grayTipElement: { subElementType: 1, revokeElement: {
      origMsgUid: 'm1', isSelfOperate: true,
    } } }],
  });
  assert.equal(recoverRecall(recall, textMessage(), { preventSelf: false }), null);
});

test('getPeer creates a stable friend or group identity', () => {
  assert.deepEqual(getPeer(textMessage()), {
    key: 'friend:u100', type: 'friend', id: 'u100', name: '测试好友',
  });
  assert.deepEqual(getPeer(textMessage({ chatType: 2, peerUid: 'g9', peerName: '测试群' })), {
    key: 'group:g9', type: 'group', id: 'g9', name: '测试群',
  });
});

