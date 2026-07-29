'use strict';

const DEFAULT_TIMEOUT_MS = 30_000;

function installQqSessionCapture(processObject = process) {
  let session = null;
  const originalDlopen = processObject.dlopen;
  if (typeof originalDlopen !== 'function') return () => session;

  processObject.dlopen = function captureQqWrapper(module, filename, flags) {
    const result = originalDlopen.call(this, module, filename, flags);
    const baseName = String(filename || '').split(/[\\/]/).at(-1).toLowerCase();
    if (baseName !== 'wrapper.node') return result;
    processObject.dlopen = originalDlopen;

    const exportsObject = module?.exports;
    const WrapperSession = exportsObject?.NodeIQQNTWrapperSession;
    const originalGetSession = WrapperSession?.getNTWrapperSession;
    if (typeof originalGetSession !== 'function') return result;

    function CapturedWrapperSession() {}
    for (const property of Object.getOwnPropertyNames(WrapperSession)) {
      if (['length', 'name', 'prototype', 'getNTWrapperSession'].includes(property)) continue;
      try { Object.defineProperty(CapturedWrapperSession, property, Object.getOwnPropertyDescriptor(WrapperSession, property)); } catch {}
    }
    CapturedWrapperSession.prototype = WrapperSession.prototype;
    Object.defineProperty(CapturedWrapperSession, 'getNTWrapperSession', {
      configurable: true,
      writable: true,
      value(...args) {
        const current = originalGetSession.apply(WrapperSession, args);
        if (!session) session = current;
        return current;
      },
    });
    const exportDescriptors = Object.getOwnPropertyDescriptors(exportsObject);
    delete exportDescriptors.NodeIQQNTWrapperSession;
    module.exports = Object.create(Object.getPrototypeOf(exportsObject), exportDescriptors);
    Object.defineProperty(module.exports, 'NodeIQQNTWrapperSession', {
      configurable: true, enumerable: true, writable: true, value: CapturedWrapperSession,
    });
    return result;
  };

  return () => session;
}

function downloadRichMedia({
  session, candidate, timeoutMs = DEFAULT_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  const msgService = session?.getMsgService?.();
  if (!msgService
    || typeof msgService.addKernelMsgListener !== 'function'
    || typeof msgService.removeKernelMsgListener !== 'function'
    || typeof msgService.downloadRichMedia !== 'function') {
    return Promise.reject(new Error('QQ rich-media service is unavailable'));
  }

  return new Promise((resolve, reject) => {
    let listenerId;
    let timer;
    let settled = false;
    const finish = (error, filePath) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      try { msgService.removeKernelMsgListener(listenerId); } catch {}
      if (error) reject(error);
      else resolve(filePath);
    };
    const listener = new Proxy({
      onRichMediaDownloadComplete(data) {
        if (String(data?.msgId || '') !== candidate.messageId
          || String(data?.msgElementId || '') !== candidate.elementId) return;
        const filePath = String(data?.filePath || data?.downloadedFilePath || '');
        if (Number(data?.fileErrCode) !== 0 || !filePath) {
          finish(new Error(`QQ rich-media download failed (${Number(data?.fileErrCode) || 0})`));
          return;
        }
        finish(null, filePath);
      },
    }, { get: (target, property) => target[property] || (() => {}) });

    try {
      listenerId = msgService.addKernelMsgListener(listener);
      timer = setTimer(() => finish(new Error('QQ rich-media download timed out')), timeoutMs);
      msgService.downloadRichMedia({
        fileModelId: '0', downSourceType: 0, downloadSourceType: 0, triggerType: 1,
        msgId: candidate.messageId, chatType: candidate.chatType, peerUid: candidate.peerUid,
        elementId: candidate.elementId, thumbSize: 0, downloadType: 1, filePath: '',
      });
    } catch (error) {
      finish(error);
    }
  });
}

module.exports = { downloadRichMedia, installQqSessionCapture };
