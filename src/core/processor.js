'use strict';

const {
  CandidateCache,
  getOriginalMessageId,
  getPeer,
  getRecallInfo,
  recoverRecall,
  sanitizeMessage,
} = require('./recall');

class RecallProcessor {
  constructor({ store, cacheLimit = 10000, preventSelf = false }) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
    this.cache = new CandidateCache(cacheLimit);
    this.preventSelf = preventSelf;
  }

  processEvent(event) {
    const result = { recoveredIds: [], attemptedIds: [], messageKinds: {}, recallNotices: {} };
    if (!event || typeof event !== 'object') return result;
    const command = String(event.cmdName || '');
    const payload = event.payload || {};
    const messages = Array.isArray(payload.msgList)
      ? payload.msgList
      : payload.msgRecord
        ? [payload.msgRecord]
        : [];

    if (!/(onRecvMsg|onRecvActiveMsg|onAddSendMsg|onMsgInfoListUpdate|onActiveMsgInfoUpdate)/.test(command)) {
      return result;
    }

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!getRecallInfo(message)) {
        this.cache.set(message);
        continue;
      }
      const recovered = this.restore(message);
      if (!recovered) continue;
      messages[index] = recovered;
      const recoveredId = String(recovered.msgId);
      result.recoveredIds.push(recoveredId);
      result.messageKinds[recoveredId] = recovered.elements.some(element => element?.picElement)
        ? 'picture'
        : 'message';
      result.recallNotices[recoveredId] = this.noticeFor(recovered, result.messageKinds[recoveredId]);
      if (/(onMsgInfoListUpdate|onActiveMsgInfoUpdate)/.test(command)) {
        result.attemptedIds.push(String(recovered.msgId));
      }
    }
    return result;
  }

  processFullList(container) {
    const result = { recoveredIds: [], attemptedIds: [], messageKinds: {}, recallNotices: {} };
    if (!Array.isArray(container?.msgList)) return result;
    for (let index = 0; index < container.msgList.length; index += 1) {
      const message = container.msgList[index];
      if (!getRecallInfo(message)) {
        this.cache.set(message);
        continue;
      }
      const recovered = this.restore(message);
      if (!recovered) continue;
      container.msgList[index] = recovered;
      const recoveredId = String(recovered.msgId);
      result.recoveredIds.push(recoveredId);
      result.messageKinds[recoveredId] = recovered.elements.some(element => element?.picElement)
        ? 'picture'
        : 'message';
      result.recallNotices[recoveredId] = this.noticeFor(recovered, result.messageKinds[recoveredId]);
    }
    return result;
  }

  processIpcArguments(args) {
    const recoveredIds = [];
    const attemptedIds = [];
    const messageKinds = {};
    const recallNotices = {};
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (value.cmdName) {
        const result = this.processEvent(value);
        recoveredIds.push(...result.recoveredIds);
        attemptedIds.push(...result.attemptedIds);
        Object.assign(messageKinds, result.messageKinds);
        Object.assign(recallNotices, result.recallNotices);
      } else if (Array.isArray(value.msgList)) {
        const result = this.processFullList(value);
        recoveredIds.push(...result.recoveredIds);
        Object.assign(messageKinds, result.messageKinds);
        Object.assign(recallNotices, result.recallNotices);
      }
    };
    for (const value of args) visit(value);
    return {
      recoveredIds: [...new Set(recoveredIds)],
      attemptedIds: [...new Set(attemptedIds)],
      messageKinds,
      recallNotices,
    };
  }

  noticeFor(recovered, kind) {
    const local = recovered.qqLocalRecall || {};
    const notice = {
      kind,
      operatorName: String(local.operatorName || '对方'),
      operatorRole: Number.isFinite(Number(local.operatorRole)) ? Number(local.operatorRole) : 0,
      senderName: String(local.senderName || recovered.sendMemberName || recovered.sendNickName
        || recovered.senderMemberName || recovered.senderNick || recovered.peerName || '成员'),
    };
    if (local.operatorUid && local.senderUid) {
      notice.operatorUid = String(local.operatorUid);
      notice.senderUid = String(local.senderUid);
    }
    if (local.memoryOnly === true) notice.memoryOnly = true;
    return notice;
  }

  restore(recallMessage) {
    const info = getRecallInfo(recallMessage);
    if (!info || (info.isSelfOperate === true && !this.preventSelf)) return null;
    const messageId = getOriginalMessageId(recallMessage, info);
    const stored = this.store.get(messageId);
    const cached = this.cache.get(messageId);
    const persistableOriginal = sanitizeMessage(stored?.message || cached);
    const currentSessionOriginal = sanitizeMessage(cached, { allowMissingMedia: true });
    const original = currentSessionOriginal || persistableOriginal;
    const recovered = recoverRecall(recallMessage, original, { preventSelf: this.preventSelf });
    if (!recovered) return null;
    const mediaCount = message => (message?.elements || [])
      .filter(element => element?.picElement || element?.marketFaceElement).length;
    if (mediaCount(original) > mediaCount(persistableOriginal)) {
      recovered.qqLocalRecall.memoryOnly = true;
    }

    const peer = getPeer(recovered);
    if (!stored && peer) {
      const persistable = recoverRecall(recallMessage, persistableOriginal, { preventSelf: this.preventSelf });
      if (persistable) {
        this.store.save({
          msgId: String(persistable.msgId),
          peer,
          recallTime: persistable.qqLocalRecall.recallTime,
          message: persistable,
        });
      }
    }
    if (recovered.qqLocalRecall.memoryOnly !== true) this.cache.delete(messageId);
    return recovered;
  }

  clearPeers(peerKeys) {
    for (const peerKey of peerKeys) this.cache.clearPeer(String(peerKey));
  }
}

module.exports = { RecallProcessor };
