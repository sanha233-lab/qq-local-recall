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
  assert.deepEqual(result.messageKinds, { m1: 'message' });
  assert.deepEqual(result.recallNotices, { m1: {
    kind: 'message', operatorName: '好友', operatorRole: 0, senderName: '好友',
  } });
  assert.equal(event.payload.msgList[0].elements[0].textElement.content, 'hello');
  assert.equal(event.payload.msgList[0].qqLocalRecall.operatorName, '好友');
  assert.equal(store.get('m1').msgId, 'm1');
});

test('RecallProcessor keeps QQ recall transport metadata required by group text rendering', () => {
  const store = makeStore();
  const processor = new RecallProcessor({ store });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({
    chatType: 2,
    msgSeq: 'original-seq',
    cntSeq: 'original-cnt',
    clientSeq: 'original-client',
    msgMeta: new Uint8Array([1, 2]),
    generalFlags: new Uint8Array([3, 4]),
    msgAttrs: new Map([['original', 1]]),
  })] } });
  const event = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage({
    chatType: 2,
    msgSeq: 'recall-seq',
    cntSeq: 'recall-cnt',
    clientSeq: 'recall-client',
    sendStatus: 2,
    emojiLikesList: [{ emojiId: '1' }],
    msgMeta: new Uint8Array([0, 0]),
    generalFlags: new Uint8Array([0, 0]),
    msgAttrs: new Map([['recall', 1]]),
  })] } };

  processor.processEvent(event);

  const recovered = event.payload.msgList[0];
  assert.equal(recovered.elements[0].textElement.content, 'hello');
  assert.equal(recovered.msgSeq, 'recall-seq');
  assert.equal(recovered.cntSeq, 'recall-cnt');
  assert.equal(recovered.clientSeq, 'recall-client');
  assert.deepEqual(recovered.emojiLikesList, [{ emojiId: '1' }]);
  assert.ok(recovered.msgMeta instanceof Uint8Array);
  assert.deepEqual([...recovered.msgMeta], [1, 2]);
  assert.ok(recovered.generalFlags instanceof Uint8Array);
  assert.deepEqual([...recovered.generalFlags], [3, 4]);
  assert.ok(recovered.msgAttrs instanceof Map);
  assert.deepEqual([...recovered.msgAttrs], [['original', 1]]);

  const afterRestart = new RecallProcessor({ store: new ConversationStore(store.rootDir) });
  const fullList = { msgList: [recallMessage({
    chatType: 2,
    msgSeq: 'restart-seq',
    cntSeq: 'restart-cnt',
    clientSeq: 'restart-client',
    msgMeta: new Uint8Array([0, 0]),
    generalFlags: new Uint8Array([0, 0]),
    msgAttrs: new Map(),
  })] };
  afterRestart.processFullList(fullList);

  assert.ok(fullList.msgList[0].msgMeta instanceof Uint8Array);
  assert.deepEqual([...fullList.msgList[0].msgMeta], [1, 2]);
  assert.ok(fullList.msgList[0].generalFlags instanceof Uint8Array);
  assert.deepEqual([...fullList.msgList[0].generalFlags], [3, 4]);
  assert.ok(fullList.msgList[0].msgAttrs instanceof Map);
  assert.deepEqual([...fullList.msgList[0].msgAttrs], [['original', 1]]);
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

test('RecallProcessor restores a locally cached picture from memory and persisted records', () => {
  const store = makeStore();
  const sourcePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-pic-')), 'cached.png');
  fs.writeFileSync(sourcePath, 'cached');
  const picture = textMessage({ elements: [{
    elementType: 2, elementId: 'pic-1', extBufForUI: 'pic-ui',
    picElement: { sourcePath, fileName: 'cached.png', thumbPath: new Map([[0, sourcePath]]) },
  }] });
  const first = new RecallProcessor({ store });
  first.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [picture] } });
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const pictureResult = first.processEvent(recall);

  assert.deepEqual(pictureResult.messageKinds, { m1: 'picture' });
  assert.equal(recall.payload.msgList[0].elements[0].picElement.sourcePath, sourcePath);
  assert.equal(recall.payload.msgList[0].elements[0].elementId, 'pic-1');
  assert.deepEqual([...recall.payload.msgList[0].elements[0].picElement.thumbPath], [[0, sourcePath]]);

  const second = new RecallProcessor({ store: new ConversationStore(store.rootDir) });
  const fullList = { msgList: [recallMessage()] };
  second.processFullList(fullList);

  assert.equal(fullList.msgList[0].elements[0].picElement.sourcePath, sourcePath);
  assert.deepEqual([...fullList.msgList[0].elements[0].picElement.thumbPath], [[0, sourcePath]]);
});

test('RecallProcessor restores and persists a locally cached QQ market face', () => {
  const store = makeStore();
  const dynamicFacePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-market-')), 'market-face');
  fs.writeFileSync(dynamicFacePath, 'cached-market-face');
  const marketFace = textMessage({ elements: [{
    elementType: 11,
    elementId: 'market-1',
    marketFaceElement: {
      emojiPackageId: 239659,
      faceName: '[舔你]',
      staticFacePath: `${dynamicFacePath}.missing`,
      dynamicFacePath,
    },
  }] });
  const first = new RecallProcessor({ store });
  first.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [marketFace] } });
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const result = first.processEvent(recall);

  assert.equal(recall.payload.msgList[0].elements[0].marketFaceElement.dynamicFacePath, dynamicFacePath);
  assert.deepEqual(result.recallNotices.m1, {
    kind: 'message', operatorName: '好友', operatorRole: 0, senderName: '好友',
  });
  const second = new RecallProcessor({ store: new ConversationStore(store.rootDir) });
  const fullList = { msgList: [recallMessage()] };
  second.processFullList(fullList);
  assert.equal(fullList.msgList[0].elements[0].marketFaceElement.dynamicFacePath, dynamicFacePath);
});

test('RecallProcessor restores and persists a locally cached picture expression', () => {
  const store = makeStore();
  const sourcePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-expression-')), 'animated.jpg');
  fs.writeFileSync(sourcePath, 'cached-expression');
  const expression = textMessage({ elements: [{
    elementType: 2,
    elementId: 'expression-1',
    picElement: {
      picSubType: 1,
      picType: 2000,
      summary: '[动画表情]',
      sourcePath,
      thumbPath: new Map([[0, sourcePath]]),
    },
  }] });
  const first = new RecallProcessor({ store });
  first.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [expression] } });
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const result = first.processEvent(recall);

  assert.equal(recall.payload.msgList[0].elements[0].picElement.summary, '[动画表情]');
  assert.equal(result.recallNotices.m1.kind, 'picture');
  const second = new RecallProcessor({ store: new ConversationStore(store.rootDir) });
  const fullList = { msgList: [recallMessage()] };
  second.processFullList(fullList);
  assert.equal(fullList.msgList[0].elements[0].picElement.sourcePath, sourcePath);
  assert.equal(fullList.msgList[0].elements[0].picElement.picSubType, 1);
});

test('RecallProcessor keeps a picture expression candidate when its local file appears before recall', () => {
  const store = makeStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-expression-late-'));
  const sourcePath = path.join(root, 'animated.jpg');
  const expression = textMessage({ elements: [{
    elementType: 2,
    elementId: 'expression-late-1',
    picElement: {
      picSubType: 1,
      picType: 2000,
      summary: '[动画表情]',
      sourcePath,
      thumbPath: new Map([[0, `${sourcePath}.thumb`]]),
    },
  }] });
  const processor = new RecallProcessor({ store });

  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [expression] } });
  fs.writeFileSync(sourcePath, 'cached-after-receive');
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };
  const result = processor.processEvent(recall);

  assert.deepEqual(result.recoveredIds, ['m1']);
  assert.equal(recall.payload.msgList[0].elements[0].picElement.sourcePath, sourcePath);
});

test('RecallProcessor keeps a market face candidate when its local file appears before recall', () => {
  const store = makeStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-market-late-'));
  const dynamicFacePath = path.join(root, 'market-face');
  const marketFace = textMessage({ elements: [{
    elementType: 11,
    elementId: 'market-late-1',
    marketFaceElement: {
      emojiPackageId: 239659,
      faceName: '[汗]',
      staticFacePath: `${dynamicFacePath}_aio.png`,
      dynamicFacePath,
    },
  }] });
  const processor = new RecallProcessor({ store });

  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [marketFace] } });
  fs.writeFileSync(dynamicFacePath, 'cached-after-receive');
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };
  const result = processor.processEvent(recall);

  assert.deepEqual(result.recoveredIds, ['m1']);
  assert.equal(recall.payload.msgList[0].elements[0].marketFaceElement.dynamicFacePath, dynamicFacePath);
});

test('RecallProcessor replays a received picture expression from memory without persisting missing files', () => {
  const store = makeStore();
  const sourcePath = path.join(os.tmpdir(), `qq-local-recall-expression-memory-${process.pid}.png`);
  const processor = new RecallProcessor({ store });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({ elements: [{
    elementType: 2,
    elementId: 'expression-memory-1',
    picElement: {
      picSubType: 1,
      picType: 1000,
      summary: '[动画表情]',
      sourcePath,
      thumbPath: new Map([[0, `${sourcePath}.thumb`]]),
    },
  }] })] } });
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const result = processor.processEvent(recall);

  assert.deepEqual(result.recoveredIds, ['m1']);
  assert.equal(recall.payload.msgList[0].elements[0].picElement.sourcePath, sourcePath);
  assert.equal(store.get('m1'), undefined);
  const afterRestart = new RecallProcessor({ store: new ConversationStore(store.rootDir) });
  const fullList = { msgList: [recallMessage()] };
  assert.deepEqual(afterRestart.processFullList(fullList).recoveredIds, []);
});

test('RecallProcessor replays a received market face from memory without persisting missing files', () => {
  const store = makeStore();
  const dynamicFacePath = path.join(os.tmpdir(), `qq-local-recall-market-memory-${process.pid}`);
  const processor = new RecallProcessor({ store });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({ elements: [{
    elementType: 11,
    elementId: 'market-memory-1',
    marketFaceElement: {
      emojiPackageId: 239659,
      faceName: '[汗]',
      staticFacePath: `${dynamicFacePath}_aio.png`,
      dynamicFacePath,
    },
  }] })] } });
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const result = processor.processEvent(recall);

  assert.deepEqual(result.recoveredIds, ['m1']);
  assert.equal(recall.payload.msgList[0].elements[0].marketFaceElement.dynamicFacePath, dynamicFacePath);
  assert.equal(store.get('m1'), undefined);
  const afterRestart = new RecallProcessor({ store: new ConversationStore(store.rootDir) });
  const fullList = { msgList: [recallMessage()] };
  assert.deepEqual(afterRestart.processFullList(fullList).recoveredIds, []);
});

test('RecallProcessor marks a stale picture for current-session renderer replay only', () => {
  const store = makeStore();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-picture-memory-'));
  const sourcePath = path.join(root, 'cached.png');
  fs.writeFileSync(sourcePath, 'stale-local-content');
  const processor = new RecallProcessor({ store });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({ elements: [{
    elementType: 2,
    elementId: 'picture-memory-1',
    picElement: { picSubType: 0, fileSize: 262637, sourcePath },
  }] })] } });
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const result = processor.processEvent(recall);

  assert.deepEqual(result.recoveredIds, ['m1']);
  assert.equal(result.recallNotices.m1.memoryOnly, true);
  assert.equal(store.get('m1'), undefined);
});

test('RecallProcessor marks mixed text and missing media for renderer replay while persisting text only', () => {
  const store = makeStore();
  const processor = new RecallProcessor({ store });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({ elements: [
    { elementType: 1, textElement: { content: 'keep text' } },
    { elementType: 2, picElement: { picSubType: 1, sourcePath: 'missing-expression.png' } },
  ] })] } });
  const recall = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const result = processor.processEvent(recall);

  assert.equal(result.recallNotices.m1.memoryOnly, true);
  assert.deepEqual(recall.payload.msgList[0].elements.map(element => element.elementType), [1, 2]);
  assert.deepEqual(store.get('m1').message.elements.map(element => element.elementType), [1]);
});

test('RecallProcessor reopens mixed text with its memory-only media in the current session', () => {
  const store = makeStore();
  const processor = new RecallProcessor({ store });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({ elements: [
    { elementType: 1, textElement: { content: 'keep text' } },
    { elementType: 2, picElement: { picSubType: 1, sourcePath: 'missing-expression.png' } },
  ] })] } });
  processor.processEvent({ cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } });
  const reopened = { msgList: [recallMessage()] };

  const result = processor.processFullList(reopened);

  assert.deepEqual(reopened.msgList[0].elements.map(element => element.elementType), [1, 2]);
  assert.equal(result.recallNotices.m1.memoryOnly, true);
});

test('RecallProcessor exposes administrator and original sender notice data', () => {
  const processor = new RecallProcessor({ store: makeStore() });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({
    chatType: 2, senderUid: 'sender-uid', sendMemberName: 'JAY',
  })] } });
  const event = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage({
    chatType: 2,
    elements: [{ elementType: 8, grayTipElement: { subElementType: 1, revokeElement: {
      isSelfOperate: false,
      operatorRole: '1',
      operatorUid: 'admin-uid',
      operatorNick: 'Q群管家',
      origMsgSenderUid: 'sender-uid',
      origMsgSenderNick: 'JAY',
    } } }],
  })] } };

  const result = processor.processEvent(event);

  assert.deepEqual(result.recallNotices.m1, {
    kind: 'message', operatorName: 'Q群管家', operatorRole: 1, senderName: 'JAY',
    operatorUid: 'admin-uid', senderUid: 'sender-uid',
  });
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

test('RecallProcessor replays pictures without a local file in the current session only', () => {
  const processor = new RecallProcessor({ store: makeStore() });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({
    elements: [{ elementType: 2, picElement: { sourcePath: 'x' } }],
  })] } });
  const event = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };

  const result = processor.processEvent(event);

  assert.equal(event.payload.msgList[0].elements[0].picElement.sourcePath, 'x');
  assert.equal(result.recallNotices.m1.memoryOnly, true);
  assert.equal(processor.store.get('m1'), undefined);
});

test('RecallProcessor replays a memory-only picture after the conversation is reopened', () => {
  const processor = new RecallProcessor({ store: makeStore() });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage({
    elements: [{ elementType: 2, picElement: { sourcePath: 'x' } }],
  })] } });
  processor.processEvent({ cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } });
  const reopened = { msgList: [recallMessage()] };

  const result = processor.processFullList(reopened);

  assert.deepEqual(result.recoveredIds, ['m1']);
  assert.equal(reopened.msgList[0].elements[0].picElement.sourcePath, 'x');
  assert.equal(result.recallNotices.m1.memoryOnly, true);
});

test('RecallProcessor clears memory candidates for deleted conversations', () => {
  const processor = new RecallProcessor({ store: makeStore() });
  processor.processEvent({ cmdName: 'onRecvMsg', payload: { msgList: [textMessage()] } });
  processor.clearPeers(['friend:u1']);

  const event = { cmdName: 'onMsgInfoListUpdate', payload: { msgList: [recallMessage()] } };
  processor.processEvent(event);

  assert.ok(event.payload.msgList[0].elements[0].grayTipElement);
});
