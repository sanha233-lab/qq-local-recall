'use strict';

const {
  CandidateCache,
  getOriginalMessageId,
  getPeer,
  getRecallInfo,
  recoverRecall,
} = require('./recall');

class RecallProcessor {
  constructor({ store, cacheLimit = 10000, preventSelf = false }) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
    this.cache = new CandidateCache(cacheLimit);
    this.preventSelf = preventSelf;
  }

  processEvent(event) {
    const result = { recoveredIds: [], attemptedIds: [] };
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
      result.recoveredIds.push(String(recovered.msgId));
      if (/(onMsgInfoListUpdate|onActiveMsgInfoUpdate)/.test(command)) {
        result.attemptedIds.push(String(recovered.msgId));
      }
    }
    return result;
  }

  processFullList(container) {
    const result = { recoveredIds: [], attemptedIds: [] };
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
      result.recoveredIds.push(String(recovered.msgId));
    }
    return result;
  }

  processIpcArguments(args) {
    const recoveredIds = [];
    const attemptedIds = [];
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
      } else if (Array.isArray(value.msgList)) {
        recoveredIds.push(...this.processFullList(value).recoveredIds);
      }
    };
    for (const value of args) visit(value);
    return {
      recoveredIds: [...new Set(recoveredIds)],
      attemptedIds: [...new Set(attemptedIds)],
    };
  }

  restore(recallMessage) {
    const info = getRecallInfo(recallMessage);
    if (!info || (info.isSelfOperate === true && !this.preventSelf)) return null;
    const messageId = getOriginalMessageId(recallMessage, info);
    const stored = this.store.get(messageId);
    const original = stored?.message || this.cache.get(messageId);
    const recovered = recoverRecall(recallMessage, original, { preventSelf: this.preventSelf });
    if (!recovered) return null;

    const peer = getPeer(recovered);
    if (!stored && peer) {
      this.store.save({
        msgId: String(recovered.msgId),
        peer,
        recallTime: recovered.qqLocalRecall.recallTime,
        message: recovered,
      });
    }
    this.cache.delete(messageId);
    return recovered;
  }

  clearPeers(peerKeys) {
    for (const peerKey of peerKeys) this.cache.clearPeer(String(peerKey));
  }
}

module.exports = { RecallProcessor };
