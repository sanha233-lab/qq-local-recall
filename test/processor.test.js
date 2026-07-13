const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { RecallProcessor } = require('../src/core/processor');
const { ConversationStore } = require('../src/core/store');

function makeStore() {
  return new ConversationStore(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-processor-')));
}

function textMessage(overrides = {}) {
  return {
    msgId: 'm1', chatType: 1, peerUid: 'u1', peerName: '好友', senderUid: 'u1',
    msgTime: '1000', elements: [{ elementType: 1, textElement: { content: 'hello' } }],
    ...overrides,
  };
}

function recallMessage(overrides = {}) {
  return textMessage({
    msgType: 5,
    subMsgType: 4,
    recallTime: '2000',
    elements: [{ elementType: 8, grayTipElement: { subElementType: 1, revokeElement: {
      isSelfOperate: false, operatorNick: '好友',
    } } }],
    ...overrides,
  });
}

test('RecallProcessor caches received messages then replaces a recall update', () => {
  const store = makeStore();
  const processor = new RecallProcessor({ store, cacheLimit: 10 });
  processor.processEvent({ cmdName: 'nodeIKernelMsgListener/onRecvMsg', payload: { msgList: [textMessage()] } });
  const event = { cmdName: 'nodeIKernelMsgListener/onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const result = processor.processEvent(event);

  assert.equal(result.recoveredIds[0], 'm1');
  assert.deepEqual(result.attemptedIds, ['m1']);
  assert.equal(event.payload.msgList[0].elements[0].textElement.content, 'hello');
  assert.equal(event.payload.msgList[0].qqLocalRecall.operatorName, '好友');
  assert.equal(store.get('m1').msgId, 'm1');
});

test('RecallProcessor restores a persisted recall in a full message list after restart', () => {
  const store = makeStore();
  const first = new RecallProcessor({ store });
  first.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage()] } });
  first.processEvent({ cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } });
  const second = new RecallProcessor({ store: new ConversationStore(store.rootDir) });
  const fullList = { msgList: [recallMessage()] };

  const result = second.processFullList(fullList);

  assert.equal(fullList.msgList[0].elements[0].textElement.content, 'hello');
  assert.equal(fullList.msgList[0].qqLocalRecall.originalMessageId, 'm1');
  assert.deepEqual(result.attemptedIds, []);
});

test('RecallProcessor does not replace self recalls by default', () => {
  const processor = new RecallProcessor({ store: makeStore() });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage()] } });
  const event = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage({
    elements: [{ elementType: 8, grayTipElement: { subElementType: 1, revokeElement: { isSelfOperate: true } } }],
  })] } };

  const result = processor.processEvent(event);

  assert.deepEqual(result.recoveredIds, []);
  assert.ok(event.payload.msgList[0].elements[0].grayTipElement);
});

test('RecallProcessor leaves unsupported media recalls unchanged', () => {
  const processor = new RecallProcessor({ store: makeStore() });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({
    elements: [{ elementType: 2, picElement: { sourcePath: 'x' } }],
  })] } });
  const event = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  processor.processEvent(event);

  assert.ok(event.payload.msgList[0].elements[0].grayTipElement);
});

test('RecallProcessor clears memory candidates for deleted conversations', () => {
  const processor = new RecallProcessor({ store: makeStore() });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage()] } });
  processor.clearPeers(['friend:u1']);

  const event = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };
  processor.processEvent(event);

  assert.ok(event.payload.msgList[0].elements[0].grayTipElement);
});
