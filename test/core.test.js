const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

test('sanitizeMessage keeps supported non-media elements and drops uncached pictures', () => {
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

test('sanitizeMessage keeps the QQ 51246 matrix boundary for unsupported complex media', () => {
  for (const element of [
    { elementType: 3, pttElement: { filePath: 'local.amr' } },
    { elementType: 5, videoElement: { filePath: 'local.mp4' } },
    { elementType: 10, arkElement: { bytesData: '{}' } },
    { elementType: 16, multiForwardMsgElement: { fileName: 'forward' } },
  ]) {
    assert.equal(sanitizeMessage(textMessage({ elements: [element] })), null);
  }
});

test('sanitizeMessage keeps QQ group rendering metadata', () => {
  const message = textMessage({
    chatType: 2,
    peerUid: 'g1',
    sendNickName: '群成员',
    sendMemberName: '群名片',
    sourceType: 1,
    isOnlineMsg: true,
    elements: [{
      elementType: 1,
      elementId: 'e1',
      extBufForUI: '0x01',
      textElement: { content: 'group text' },
    }],
  });

  const sanitized = sanitizeMessage(message);

  assert.equal(sanitized.sendNickName, '群成员');
  assert.equal(sanitized.sendMemberName, '群名片');
  assert.equal(sanitized.sourceType, 1);
  assert.equal(sanitized.isOnlineMsg, true);
  assert.equal(sanitized.elements[0].elementId, 'e1');
  assert.equal(sanitized.elements[0].extBufForUI, '0x01');
});

test('sanitizeMessage keeps a locally cached QQ picture and its rendering fields', () => {
  const sourcePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-pic-')), 'cached.jpg');
  fs.writeFileSync(sourcePath, 'cached');
  const picElement = {
    md5HexStr: 'abc', filePath: sourcePath, fileSize: 6, picWidth: 320, picHeight: 180,
    fileName: 'cached.jpg', sourcePath, original: true, picType: 1001, picSubType: 0,
    fileUuid: 'uuid', fileSubId: 'sub', thumbFileSize: 6, summary: '[图片]',
    thumbPath: new Map([[0, sourcePath]]), originImageMd5: 'abc', originImageUrl: '/remote/path',
  };

  const sanitized = sanitizeMessage(textMessage({ elements: [{
    elementType: 2, elementId: 'pic-1', extBufForUI: 'pic-ui', picElement,
  }] }));

  assert.deepEqual(sanitized.elements[0], {
    elementType: 2, elementId: 'pic-1', extBufForUI: 'pic-ui', picElement,
  });
});

test('sanitizeMessage rejects a picture when no referenced local file exists', () => {
  const missing = path.join(os.tmpdir(), `qq-local-recall-missing-${process.pid}.jpg`);
  const message = textMessage({ elements: [{
    elementType: 2,
    picElement: {
      picSubType: 1,
      picType: 2000,
      summary: '[动画表情]',
      sourcePath: missing,
      thumbPath: new Map([[0, `${missing}.thumb`]]),
    },
  }] });

  assert.equal(sanitizeMessage(message), null);
});

test('sanitizeMessage rejects a stale picture source whose file size no longer matches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-stale-pic-'));
  const sourcePath = path.join(root, 'cached.png');
  const thumbPath = path.join(root, 'cached_720.png');
  fs.writeFileSync(sourcePath, 'stale-local-content');
  fs.writeFileSync(thumbPath, 'unverified-thumbnail');
  const message = textMessage({ elements: [{
    elementType: 2,
    picElement: {
      fileSize: 262637,
      sourcePath,
      thumbPath: new Map([[720, thumbPath]]),
    },
  }] });

  assert.equal(sanitizeMessage(message), null);
});

test('sanitizeMessage keeps a locally cached QQ picture expression', () => {
  const sourcePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-emoji-pic-')), 'animated.jpg');
  fs.writeFileSync(sourcePath, 'cached-expression');
  const sanitized = sanitizeMessage(textMessage({ elements: [{
    elementType: 2,
    elementId: 'emoji-picture-1',
    picElement: {
      picSubType: 1,
      picType: 2000,
      summary: '[动画表情]',
      sourcePath,
      thumbPath: new Map([[0, sourcePath]]),
    },
  }] }));

  assert.equal(sanitized.elements[0].picElement.picSubType, 1);
  assert.equal(sanitized.elements[0].picElement.summary, '[动画表情]');
  assert.equal(sanitized.elements[0].picElement.sourcePath, sourcePath);
});

test('sanitizeMessage keeps a QQ market face only when a referenced local resource exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-local-recall-market-face-'));
  const dynamicFacePath = path.join(root, 'market-face');
  fs.writeFileSync(dynamicFacePath, 'cached-market-face');
  const marketFaceElement = {
    emojiPackageId: 239659,
    subType: 3,
    faceName: '[舔你]',
    emojiId: 'df04d708127ca5e5ffdfe1f936166cdf',
    staticFacePath: path.join(root, 'missing.png'),
    dynamicFacePath,
  };

  const sanitized = sanitizeMessage(textMessage({ elements: [{
    elementType: 11, elementId: 'market-1', extBufForUI: 'market-ui', marketFaceElement,
  }] }));

  assert.deepEqual(sanitized.elements[0], {
    elementType: 11, elementId: 'market-1', extBufForUI: 'market-ui', marketFaceElement,
  });
  assert.equal(sanitizeMessage(textMessage({ msgId: 'm2', elements: [{
    elementType: 11,
    marketFaceElement: {
      staticFacePath: path.join(root, 'missing-static.png'),
      dynamicFacePath: path.join(root, 'missing-dynamic'),
    },
  }] })), null);
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

test('recoverRecall records QQ 51246 operator role and sender identity', () => {
  const recall = textMessage({
    msgId: 'm1',
    recallTime: '2000',
    elements: [{ elementType: 8, grayTipElement: { subElementType: 1, revokeElement: {
      origMsgUid: 'm1',
      isSelfOperate: false,
      operatorRole: '1',
      operatorUid: 'admin-uid',
      operatorNick: 'Q群管家',
      origMsgSenderUid: 'sender-uid',
      origMsgSenderNick: 'JAY',
    } } }],
  });

  const recovered = recoverRecall(recall, textMessage(), { preventSelf: false });

  assert.deepEqual(recovered.qqLocalRecall, {
    originalMessageId: 'm1',
    operatorName: 'Q群管家',
    operatorRole: 1,
    operatorUid: 'admin-uid',
    senderName: 'JAY',
    senderUid: 'sender-uid',
    recallTime: '2000',
  });
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
