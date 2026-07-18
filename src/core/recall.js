'use strict';

const fs = require('node:fs');

const SUPPORTED_ELEMENT_KEYS = new Map([
  [1, 'textElement'],
  [2, 'picElement'],
  [6, 'faceElement'],
  [7, 'replyElement'],
  [11, 'marketFaceElement'],
]);

const MESSAGE_FIELDS = [
  'msgId', 'msgRandom', 'msgSeq', 'cntSeq', 'chatType', 'peerUid', 'peerUin',
  'peerName', 'peerRemark', 'senderUid', 'senderUin', 'senderNick',
  'senderMemberName', 'sendNickName', 'sendMemberName', 'sourceType', 'isOnlineMsg',
  'msgTime', 'msgType', 'subMsgType', 'sendStatus', 'msgAttrs', 'msgMeta', 'generalFlags',
];

const RECALL_TRANSPORT_FIELDS = new Set([
  'msgSeq', 'cntSeq', 'clientSeq', 'sendStatus', 'emojiLikesList',
]);

function clone(value) {
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [clone(key), clone(item)]));
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function hasLocalPicture(pic) {
  const thumbs = pic?.thumbPath instanceof Map
    ? [...pic.thumbPath.values()]
    : Array.isArray(pic?.thumbPath)
      ? pic.thumbPath.map(entry => Array.isArray(entry) ? entry[1] : entry)
      : Object.values(pic?.thumbPath || {});
  const sources = [pic?.sourcePath, pic?.filePath]
    .filter(file => typeof file === 'string' && file.length > 0);
  const existingSources = sources.filter(file => fs.existsSync(file));
  if (existingSources.length) {
    const expectedSize = Number(pic?.fileSize);
    return existingSources.some(file => (
      !Number.isFinite(expectedSize) || expectedSize <= 0 || fs.statSync(file).size === expectedSize
    ));
  }
  return thumbs.some(file => typeof file === 'string' && file.length > 0 && fs.existsSync(file));
}

function hasLocalMarketFace(face) {
  return [face?.staticFacePath, face?.dynamicFacePath]
    .some(file => typeof file === 'string' && file.length > 0 && fs.existsSync(file));
}

function sanitizeMessage(message, { requireLocalMedia = true, allowMissingMedia = false } = {}) {
  if (!message || typeof message !== 'object' || !message.msgId || !Array.isArray(message.elements)) {
    return null;
  }

  const elements = message.elements.flatMap(element => {
    const key = SUPPORTED_ELEMENT_KEYS.get(Number(element?.elementType));
    if (!key || !element[key]) return [];
    const persistedMedia = element.qqLocalRecallMedia;
    if (requireLocalMedia && key === 'picElement' && !persistedMedia && !hasLocalPicture(element.picElement)
      && !allowMissingMedia) return [];
    if (requireLocalMedia && key === 'marketFaceElement' && !persistedMedia && !hasLocalMarketFace(element.marketFaceElement)
      && !allowMissingMedia) return [];
    const sanitized = { elementType: Number(element.elementType), [key]: clone(element[key]) };
    if (element.elementId !== undefined) sanitized.elementId = clone(element.elementId);
    if (element.extBufForUI !== undefined) sanitized.extBufForUI = clone(element.extBufForUI);
    if (persistedMedia && typeof persistedMedia === 'object') {
      sanitized.qqLocalRecallMedia = {
        sha256: String(persistedMedia.sha256 || ''),
        relativePath: String(persistedMedia.relativePath || ''),
        mimeType: String(persistedMedia.mimeType || ''),
        sizeBytes: Number(persistedMedia.sizeBytes),
        staticFallback: persistedMedia.staticFallback === true,
      };
    }
    return [sanitized];
  });
  if (elements.length === 0) return null;

  const result = { elements };
  for (const field of MESSAGE_FIELDS) {
    if (message[field] !== undefined) result[field] = clone(message[field]);
  }
  return result;
}

function getRecallInfo(message) {
  if (!Array.isArray(message?.elements)) return null;
  for (const element of message.elements) {
    const grayTip = element?.grayTipElement;
    if (grayTip?.revokeElement && (grayTip.subElementType === undefined || Number(grayTip.subElementType) === 1)) {
      return grayTip.revokeElement;
    }
  }
  return null;
}

function getOriginalMessageId(recallMessage, recallInfo) {
  return String(
    recallInfo?.origMsgId || recallInfo?.msgId || recallMessage?.msgId || recallInfo?.origMsgUid || '',
  );
}

function getPeer(message) {
  const type = Number(message?.chatType) === 2 ? 'group' : 'friend';
  const id = String(message?.peerUid || message?.peerUin || '');
  if (!id) return null;
  const name = String(
    message?.peerName || message?.peerRemark || message?.senderNick || message?.senderMemberName || '',
  );
  const peer = {
    key: `${type}:${id}`,
    type,
    id,
    name,
  };
  const uin = String(message?.peerUin || message?.senderUin || '');
  if (uin) peer.uin = uin;
  return peer;
}

function recoverRecall(recallMessage, originalMessage, options = {}) {
  const recallInfo = getRecallInfo(recallMessage);
  if (!recallInfo || !originalMessage) return null;
  if (recallInfo.isSelfOperate === true && options.preventSelf !== true) return null;

  const recovered = clone(recallMessage);
  for (const [key, value] of Object.entries(originalMessage)) {
    if (!RECALL_TRANSPORT_FIELDS.has(key)) recovered[key] = clone(value);
  }
  recovered.qqLocalRecall = {
    originalMessageId: getOriginalMessageId(recallMessage, recallInfo),
    operatorName: String(
      recallInfo.operatorMemRemark || recallInfo.operatorRemark || recallInfo.operatorNick
        || recallInfo.operatorUid || '',
    ),
    operatorRole: Number.isFinite(Number(recallInfo.operatorRole)) ? Number(recallInfo.operatorRole) : 0,
    operatorUid: String(recallInfo.operatorUid || ''),
    senderName: String(
      recallInfo.origMsgSenderMemRemark || recallInfo.origMsgSenderRemark || recallInfo.origMsgSenderNick
        || originalMessage.sendMemberName || originalMessage.sendNickName
        || originalMessage.senderMemberName || originalMessage.senderNick || originalMessage.peerName
        || originalMessage.senderUin || originalMessage.senderUid || '',
    ),
    senderUid: String(recallInfo.origMsgSenderUid || originalMessage.senderUid || ''),
    recallTime: String(recallMessage.recallTime || recallMessage.msgTime || ''),
  };
  return recovered;
}

class CandidateCache {
  constructor(limit = 10000, onDelete = null) {
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer');
    this.limit = limit;
    this.onDelete = onDelete;
    this.items = new Map();
  }

  set(message) {
    const sanitized = sanitizeMessage(message, { requireLocalMedia: false });
    if (!sanitized) return false;
    const id = String(sanitized.msgId);
    this.items.delete(id);
    this.items.set(id, sanitized);
    while (this.items.size > this.limit) {
      this.delete(this.items.keys().next().value);
    }
    return true;
  }

  get(messageId) {
    return this.items.get(String(messageId));
  }

  delete(messageId) {
    const id = String(messageId);
    const deleted = this.items.delete(id);
    if (deleted) this.onDelete?.(id);
    return deleted;
  }

  clearPeer(peerKey) {
    for (const [messageId, message] of this.items) {
      if (getPeer(message)?.key === peerKey) this.delete(messageId);
    }
  }

  get size() {
    return this.items.size;
  }
}

module.exports = {
  CandidateCache,
  sanitizeMessage,
  getRecallInfo,
  getOriginalMessageId,
  recoverRecall,
  getPeer,
};
