'use strict';

const SUPPORTED_ELEMENT_KEYS = new Map([
  [1, 'textElement'],
  [6, 'faceElement'],
  [7, 'replyElement'],
]);

const MESSAGE_FIELDS = [
  'msgId', 'msgRandom', 'msgSeq', 'cntSeq', 'chatType', 'peerUid', 'peerUin',
  'peerName', 'peerRemark', 'senderUid', 'senderUin', 'senderNick',
  'senderMemberName', 'msgTime', 'msgType', 'subMsgType', 'sendStatus',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeMessage(message) {
  if (!message || typeof message !== 'object' || !message.msgId || !Array.isArray(message.elements)) {
    return null;
  }

  const elements = message.elements.flatMap(element => {
    const key = SUPPORTED_ELEMENT_KEYS.get(Number(element?.elementType));
    if (!key || !element[key]) return [];
    return [{ elementType: Number(element.elementType), [key]: clone(element[key]) }];
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

  const recovered = clone(originalMessage);
  recovered.qqLocalRecall = {
    originalMessageId: getOriginalMessageId(recallMessage, recallInfo),
    operatorName: String(
      recallInfo.operatorNick || recallInfo.operatorRemark || recallInfo.operatorMemRemark || '',
    ),
    recallTime: String(recallMessage.recallTime || recallMessage.msgTime || ''),
  };
  return recovered;
}

class CandidateCache {
  constructor(limit = 10000) {
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer');
    this.limit = limit;
    this.items = new Map();
  }

  set(message) {
    const sanitized = sanitizeMessage(message);
    if (!sanitized) return false;
    const id = String(sanitized.msgId);
    this.items.delete(id);
    this.items.set(id, sanitized);
    while (this.items.size > this.limit) {
      this.items.delete(this.items.keys().next().value);
    }
    return true;
  }

  get(messageId) {
    return this.items.get(String(messageId));
  }

  delete(messageId) {
    return this.items.delete(String(messageId));
  }

  clearPeer(peerKey) {
    for (const [messageId, message] of this.items) {
      if (getPeer(message)?.key === peerKey) this.items.delete(messageId);
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
