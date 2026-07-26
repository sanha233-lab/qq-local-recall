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
  constructor({ store, mediaStore = null, pttStore = null, cacheLimit = 10000, preventSelf = false }) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
    this.mediaStore = mediaStore;
    this.pttStore = pttStore;
    this.pendingMedia = new Map();
    this.pendingMediaLimit = cacheLimit;
    this.cache = new CandidateCache(cacheLimit, messageId => this.pendingMedia.delete(messageId));
    this.preventSelf = preventSelf;
    // Secondary index: "chatType:peerUid:senderUid" -> msgId (most recent voice from sender)
    this.pttLastMsgId = new Map();
    // Downloaded PTT files: msgId -> { relativePath, sha256, sizeBytes, ext }
    this.pttDownloads = new Map();
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
        this.indexPttMessage(message);
        continue;
      }
      const recovered = this.restore(message);
      if (!recovered) continue;
      messages[index] = recovered;
      const recoveredId = String(recovered.msgId);
      result.recoveredIds.push(recoveredId);
      result.messageKinds[recoveredId] = recovered.elements.some(element => element?.pttElement)
        ? 'voice'
        : recovered.elements.some(element => element?.picElement)
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
        this.indexPttMessage(message);
        continue;
      }
      const recovered = this.restore(message);
      if (!recovered) continue;
      container.msgList[index] = recovered;
      const recoveredId = String(recovered.msgId);
      result.recoveredIds.push(recoveredId);
      result.messageKinds[recoveredId] = recovered.elements.some(element => element?.pttElement)
        ? 'voice'
        : recovered.elements.some(element => element?.picElement)
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
        if (/onRichMediaDownloadComplete/.test(String(value.cmdName))) {
          this.processRichMediaDownload(value.payload?.notifyInfo);
          return;
        }
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

  // Called when QQ finishes downloading a rich-media file.
  processRichMediaDownload(notifyInfo) {
    if (!notifyInfo || !this.pttStore) return;
    const filePath = String(notifyInfo.filePath || '');
    const msgId = String(notifyInfo.msgId || '');
    if (!filePath || !msgId) return;
    const isPtt = /[\\/]Ptt[\\/]/i.test(filePath)
      || /\.(amr|silk|slk)$/i.test(filePath)
      || Number(notifyInfo.downloadType) === 2;
    if (!isPtt) return;
    try {
      const ref = this.pttStore.saveFile(filePath);
      this.pttDownloads.set(msgId, ref);
    } catch { /* file may not exist yet or already cleaned up */ }
  }

  // Update pttLastMsgId secondary index when a voice message is cached.
  indexPttMessage(message) {
    if (!message || !Array.isArray(message.elements)) return;
    const hasPtt = message.elements.some(el => Number(el?.elementType) === 3 && el.pttElement);
    if (!hasPtt) return;
    const chatType = Number(message.chatType);
    const peerUid = String(message.peerUid || '');
    const senderUid = String(message.senderUid || '');
    if (!peerUid || !senderUid) return;
    this.pttLastMsgId.set(`${chatType}:${peerUid}:${senderUid}`, String(message.msgId));
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

    // Voice recall fallback: revokeElement has no origMsgId, so messageId falls back to
    // the recall notice's own msgId and the normal lookup fails. Use pttLastMsgId index.
    if (!stored && !cached && info.origMsgSenderUid) {
      const chatType = Number(recallMessage.chatType);
      const peerUid = String(recallMessage.peerUid || '');
      const pttKey = `${chatType}:${peerUid}:${info.origMsgSenderUid}`;
      const voiceMsgId = this.pttLastMsgId.get(pttKey);
      if (voiceMsgId) {
        const voiceCached = this.cache.get(voiceMsgId);
        const voiceStored = this.store.get(voiceMsgId);
        if (voiceCached || voiceStored) {
          return this.restoreWithId(recallMessage, info, voiceMsgId, voiceCached, voiceStored);
        }
      }
    }

    return this.restoreWithId(recallMessage, info, messageId, cached, stored);
  }

  restoreWithId(recallMessage, info, messageId, cached, stored) {
    const storedMessage = this.resolveStoredMedia(stored?.message);
    const persistableOriginal = sanitizeMessage(storedMessage || cached);
    const currentSessionOriginal = sanitizeMessage(cached, { allowMissingMedia: true });
    const original = currentSessionOriginal || persistableOriginal;
    const recovered = recoverRecall(recallMessage, original, { preventSelf: this.preventSelf });
    if (!recovered) return null;

    // Attach saved PTT file path if available
    const pttDownload = this.pttDownloads.get(messageId);
    if (pttDownload) {
      for (const element of (recovered.elements || [])) {
        if (element.pttElement) {
          element.pttElement.filePath = pttDownload.absolutePath || element.pttElement.filePath;
          element.qqLocalRecallMedia = {
            sha256: pttDownload.sha256,
            relativePath: pttDownload.relativePath,
            sizeBytes: pttDownload.sizeBytes,
          };
        }
      }
    }

    const mediaCount = message => (message?.elements || [])
      .filter(element => element?.picElement || element?.marketFaceElement).length;
    if (mediaCount(original) > mediaCount(persistableOriginal)) {
      recovered.qqLocalRecall.memoryOnly = true;
      this.pendingMedia.delete(messageId);
      this.pendingMedia.set(messageId, recovered);
      while (this.pendingMedia.size > this.pendingMediaLimit) {
        this.pendingMedia.delete(this.pendingMedia.keys().next().value);
      }
    }

    const peer = getPeer(recovered);
    if (!stored && peer) {
      const persistable = recoverRecall(recallMessage, persistableOriginal, { preventSelf: this.preventSelf });
      if (persistable) {
        if (pttDownload) {
          for (const element of (persistable.elements || [])) {
            if (element.pttElement) {
              element.qqLocalRecallMedia = {
                sha256: pttDownload.sha256,
                relativePath: pttDownload.relativePath,
                sizeBytes: pttDownload.sizeBytes,
              };
            }
          }
        }
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

  resolveStoredMedia(message) {
    if (!message) return null;
    const prepared = sanitizeMessage(message, { requireLocalMedia: false, allowMissingMedia: true });
    if (!prepared) return null;
    prepared.elements = prepared.elements.flatMap(element => {
      const reference = element.qqLocalRecallMedia;
      if (!reference) return [element];
      if (element.pttElement && this.pttStore) {
        try {
          const absolutePath = this.pttStore.resolve(reference.relativePath);
          element.pttElement.filePath = absolutePath;
          return [element];
        } catch { return []; }
      }
      if (!this.mediaStore) return [];
      try {
        const pic = element.picElement;
        const expectedDimensions = Number.isInteger(Number(pic?.picWidth)) && Number(pic.picWidth) > 0
          && Number.isInteger(Number(pic?.picHeight)) && Number(pic.picHeight) > 0
          ? { width: Number(pic.picWidth), height: Number(pic.picHeight) }
          : undefined;
        const absolutePath = this.mediaStore.resolve(reference, expectedDimensions);
        if (element.picElement) {
          element.picElement.sourcePath = absolutePath;
          element.picElement.filePath = absolutePath;
          element.picElement.fileSize = reference.sizeBytes;
        } else if (element.marketFaceElement) {
          if (reference.staticFallback) element.marketFaceElement.staticFacePath = absolutePath;
          else element.marketFaceElement.dynamicFacePath = absolutePath;
        }
        return [element];
      } catch {
        return [];
      }
    });
    return prepared.elements.length ? prepared : null;
  }

  persistRenderedMedia({ messageId, mediaIndex, reference }) {
    const id = String(messageId);
    const pending = this.pendingMedia.get(id);
    if (!pending || !this.mediaStore) throw new Error('rendered media is not pending');
    const mediaElements = pending.elements.filter(element => element?.picElement || element?.marketFaceElement);
    const element = mediaElements[mediaIndex];
    if (!element) throw new RangeError('media index is out of range');
    const absolutePath = this.mediaStore.resolve(reference);
    element.qqLocalRecallMedia = {
      sha256: reference.sha256,
      relativePath: reference.relativePath,
      mimeType: reference.mimeType,
      sizeBytes: reference.sizeBytes,
      staticFallback: reference.staticFallback === true,
    };
    if (element.picElement) {
      element.picElement.sourcePath = absolutePath;
      element.picElement.filePath = absolutePath;
      element.picElement.fileSize = reference.sizeBytes;
    } else if (reference.staticFallback === true) {
      element.marketFaceElement.staticFacePath = absolutePath;
    } else {
      element.marketFaceElement.dynamicFacePath = absolutePath;
    }
    const peer = getPeer(pending);
    const persistable = sanitizeMessage(pending);
    if (!peer || !persistable) throw new Error('rendered media record is invalid');
    persistable.qqLocalRecall = pending.qqLocalRecall;
    this.store.upsert({
      msgId: id,
      peer,
      recallTime: String(pending.qqLocalRecall?.recallTime || ''),
      message: persistable,
    });
    if (mediaElements.every(item => item.qqLocalRecallMedia)) {
      this.pendingMedia.delete(id);
      this.cache.delete(id);
    }
    return reference;
  }

  pendingMediaElement(messageId, mediaIndex) {
    const pending = this.pendingMedia.get(String(messageId));
    if (!pending) throw new Error('rendered media is not pending');
    const mediaElements = pending.elements.filter(element => element?.picElement || element?.marketFaceElement);
    const element = mediaElements[mediaIndex];
    if (!element) throw new RangeError('media index is out of range');
    return element;
  }

  clearPeers(peerKeys) {
    for (const peerKey of peerKeys) {
      this.cache.clearPeer(String(peerKey));
      for (const [messageId, message] of this.pendingMedia) {
        if (getPeer(message)?.key === String(peerKey)) this.pendingMedia.delete(messageId);
      }
    }
  }
}

module.exports = { RecallProcessor };
