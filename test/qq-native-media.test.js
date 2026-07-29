'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { downloadRichMedia, installQqSessionCapture } = require('../src/core/qq-native-media');

const CANDIDATE = {
  messageId: 'm1', mediaIndex: 0, chatType: 1, peerUid: 'u1', elementId: 'e1',
};

function fakeService() {
  const state = { listener: null, removed: [], requests: [] };
  return {
    state,
    addKernelMsgListener(listener) { state.listener = listener; return 17; },
    removeKernelMsgListener(id) { state.removed.push(id); },
    downloadRichMedia(request) { state.requests.push(request); },
  };
}

test('QQ session capture intercepts wrapper.node before the native session is requested', () => {
  const session = { getMsgService() {} };
  class WrapperSession {}
  WrapperSession.keep = 'static';
  WrapperSession.getNTWrapperSession = () => session;
  const processObject = {
    dlopen(module) { module.exports = { NodeIQQNTWrapperSession: WrapperSession, other: 1 }; },
  };
  const getSession = installQqSessionCapture(processObject);
  const module = { exports: {} };

  processObject.dlopen(module, String.raw`D:\QQ\wrapper.node`);
  const result = module.exports.NodeIQQNTWrapperSession.getNTWrapperSession();

  assert.equal(result, session);
  assert.equal(getSession(), session);
  assert.equal(module.exports.NodeIQQNTWrapperSession.keep, 'static');
  assert.equal(module.exports.other, 1);
});

test('native rich-media download sends exact message identity and accepts only its completion', async () => {
  const service = fakeService();
  const pending = downloadRichMedia({ session: { getMsgService: () => service }, candidate: CANDIDATE });

  assert.deepEqual(service.state.requests, [{
    fileModelId: '0', downSourceType: 0, downloadSourceType: 0, triggerType: 1,
    msgId: 'm1', chatType: 1, peerUid: 'u1', elementId: 'e1',
    thumbSize: 0, downloadType: 1, filePath: '',
  }]);
  service.state.listener.onRichMediaDownloadComplete({
    msgId: 'other', msgElementId: 'e1', fileErrCode: 0, filePath: 'wrong.jpg',
  });
  service.state.listener.onRichMediaDownloadComplete({
    msgId: 'm1', msgElementId: 'e1', fileErrCode: 0, filePath: 'right.jpg',
  });

  assert.equal(await pending, 'right.jpg');
  assert.deepEqual(service.state.removed, [17]);
});

test('native rich-media timeout removes its listener', async () => {
  const service = fakeService();
  let timeout;
  const pending = downloadRichMedia({
    session: { getMsgService: () => service }, candidate: CANDIDATE,
    setTimer(callback) { timeout = callback; return 9; }, clearTimer() {},
  });

  timeout();

  await assert.rejects(pending, /timed out/);
  assert.deepEqual(service.state.removed, [17]);
});
