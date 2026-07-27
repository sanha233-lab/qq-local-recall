'use strict';

const fs = require('node:fs');

// AMR-NB payload sizes per frame type: FT0-7 speech, FT8 SID;
// FT9-14 reserved and FT15 NO_DATA (DTX silence) carry only the 1-byte TOC.
const AMR_FRAME_SIZES = [12, 13, 15, 17, 19, 20, 26, 31, 5, 0, 0, 0, 0, 0, 0, 0];

function readAmrDuration(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    // Exact "#!AMR\n" magic; "#!AMR-WB\n" uses different frame sizes and is rejected.
    if (buf.length < 6 || buf.subarray(0, 6).toString('latin1') !== '#!AMR\n') return 0;
    let offset = 6;
    let frames = 0;
    while (offset < buf.length) {
      const ft = (buf[offset] >> 3) & 0xF;
      offset += 1 + AMR_FRAME_SIZES[ft];
      frames++;
    }
    return frames ? Math.ceil(frames * 0.02) : 0;
  } catch { return 0; }
}

const {
  CandidateCache,
  getOriginalMessageId,
  getPeer,
  getRecallInfo,
  recoverRecall,
  sanitizeMessage,
} = require('./recall');

class RecallProcessor {
  constructor({ store, mediaStore = null, pttStore = null, videoStore = null, cacheLimit = 10000, preventSelf = false, diagLog = null }) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
    this.mediaStore = mediaStore;
    this.pttStore = pttStore;
    this.videoStore = videoStore;
    this.pendingMedia = new Map();
    this.pendingMediaLimit = cacheLimit;
    this.cache = new CandidateCache(cacheLimit, messageId => this.pendingMedia.delete(messageId));
    this.preventSelf = preventSelf;
    this.pttDownloads = new Map();
    this.videoDownloads = new Map();
    this._diagLog = diagLog;
  }

  _log(entry) {
    if (this._diagLog) try { this._diagLog(entry); } catch {}
  }

  _safeStr(obj, max = 2000) {
    if (obj == null) return null;
    try {
      const s = JSON.stringify(obj, (k, v) => ArrayBuffer.isView(v) ? `<Buf:${v.byteLength}>` : v);
      return s.length > max ? s.slice(0, max) + '…' : s;
    } catch { return '<err>'; }
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
      result.messageKinds[recoveredId] = recovered.elements.some(el => {
          const et = Number(el?.elementType);
          return et === 3 || et === 4;
        })
        ? 'voice'
        : recovered.elements.some(element => element?.videoElement)
          ? 'video'
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
        continue;
      }
      const recovered = this.restore(message);
      if (!recovered) continue;
      container.msgList[index] = recovered;
      const recoveredId = String(recovered.msgId);
      result.recoveredIds.push(recoveredId);
      result.messageKinds[recoveredId] = recovered.elements.some(el => {
          const et = Number(el?.elementType);
          return et === 3 || et === 4;
        })
        ? 'voice'
        : recovered.elements.some(element => element?.videoElement)
          ? 'video'
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

    // Diagnostic: scan raw IPC args for voice/recall data before processing
    if (this._diagLog) {
      const scan = (val, depth) => {
        if (!val || typeof val !== 'object' || depth > 8) return;
        if (Array.isArray(val)) { for (const v of val) scan(v, depth + 1); return; }
        if (Array.isArray(val.elements) && val.elements.length > 0) {
          const types = val.elements.map(e => ({ et: e?.elementType, k: Object.keys(e || {}) }));
          const isRecall = val.elements.some(e => e?.grayTipElement?.revokeElement !== undefined);
          const hasPttLike = types.some(t => Number(t.et) === 3 || (t.k || []).some(k => /ptt|voice/i.test(k)));
          if (isRecall) {
            const grayEl = val.elements.find(e => e?.grayTipElement);
            this._log({ ev: 'recallNotice', msgId: val.msgId, chatType: val.chatType,
              revoke: this._safeStr(grayEl?.grayTipElement?.revokeElement), types });
          }
          if (hasPttLike) {
            this._log({ ev: 'voiceLike', msgId: val.msgId, chatType: val.chatType,
              peerUid: val.peerUid, senderUid: val.senderUid, types });
          }
          const hasVideoLike = types.some(t => Number(t.et) === 5
            || (t.k || []).some(k => /video/i.test(k)));
          if (hasVideoLike) {
            const videoEl = val.elements.find(e => e?.videoElement)?.videoElement;
            // Record which referenced paths exist right now; the files may be
            // gone by the time the log is read.
            const exists = {};
            const check = (label, p) => {
              if (typeof p === 'string' && p.length > 3 && /[\\/]/.test(p)) {
                try { exists[label] = fs.existsSync(p); } catch {}
              }
            };
            for (const [key, v] of Object.entries(videoEl || {})) {
              if (v instanceof Map) { let i = 0; for (const item of v.values()) check(`${key}.${i++}`, item); }
              else if (v && typeof v === 'object' && !Array.isArray(v)) {
                for (const [k2, v2] of Object.entries(v)) check(`${key}.${k2}`, v2);
              } else check(key, v);
            }
            this._log({ ev: 'videoLike', msgId: val.msgId, chatType: val.chatType,
              peerUid: val.peerUid, senderUid: val.senderUid, types,
              video: this._safeStr(videoEl, 4000), exists });
          }
        }
        if (val.cmdName && /onRichMediaDownloadComplete/.test(String(val.cmdName))) {
          this._log({ ev: 'richMediaCmd', notifyInfo: this._safeStr(val.payload?.notifyInfo) });
        }
        for (const v of Object.values(val)) scan(v, depth + 1);
      };
      for (const arg of args) scan(arg, 0);
    }

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
    this._log({ ev: 'richMediaDL', raw: this._safeStr(notifyInfo) });
    if (!notifyInfo) return;
    const filePath = String(notifyInfo.filePath || '');
    const msgId = String(notifyInfo.msgId || '');
    if (!filePath || !msgId) return;
    const isPtt = /[\\/]Ptt[\\/]/i.test(filePath)
      || /\.(amr|silk|slk)$/i.test(filePath)
      || Number(notifyInfo.downloadType) === 2;
    this._log({ ev: 'richMediaDL_isPtt', isPtt, filePath, msgId, downloadType: notifyInfo.downloadType });
    if (isPtt && this.pttStore) {
      try {
        const ref = this.pttStore.saveFile(filePath);
        ref.duration = readAmrDuration(filePath);
        this.pttDownloads.set(msgId, ref);
        while (this.pttDownloads.size > this.pendingMediaLimit) {
          this.pttDownloads.delete(this.pttDownloads.keys().next().value);
        }
      } catch { /* file may not exist yet or already cleaned up */ }
      return;
    }
    // Video bodies land under nt_data\Video\...\Ori\<md5>.mp4 once played.
    const isVideo = /[\\/]Video[\\/]/i.test(filePath) && /\.mp4$/i.test(filePath);
    if (isVideo && this.videoStore) {
      try {
        const ref = this.videoStore.saveFile(filePath);
        this.videoDownloads.set(msgId, ref);
        while (this.videoDownloads.size > this.pendingMediaLimit) {
          this.videoDownloads.delete(this.videoDownloads.keys().next().value);
        }
      } catch { /* oversized, unsupported or already cleaned up */ }
    }
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

    this._log({ ev: 'restore', messageId, hasCached: !!cached, hasStored: !!stored,
      origMsgId: info.origMsgId, origMsgSenderUid: info.origMsgSenderUid,
      infoKeys: Object.keys(info) });

    // Voice recalls resolve through the exact message id like every other kind.
    // A "latest voice from the same sender" fallback used to live here; field
    // diagnostics showed 130 of its 131 candidate hits pointed at a different
    // message than the one recalled, so it only ever misattributed content.
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
        const et = Number(element?.elementType);
        if (et === 3 || et === 4) {
          if (!element.pttElement) element.pttElement = {};
          element.pttElement.filePath = pttDownload.absolutePath;
          element.pttElement.duration = element.pttElement.duration || pttDownload.duration || 1;
          element.pttElement.fileSize = String(pttDownload.sizeBytes || 0);
          element.pttElement.voiceChangeType = element.pttElement.voiceChangeType ?? 0;
          element.pttElement.canConvert2Text = element.pttElement.canConvert2Text ?? false;
          element.qqLocalRecallMedia = {
            sha256: pttDownload.sha256,
            relativePath: pttDownload.relativePath,
            sizeBytes: pttDownload.sizeBytes,
          };
        }
      }
    }

    // Attach the saved video body if QQ downloaded it during this session
    const videoDownload = this.videoDownloads.get(messageId);
    if (videoDownload) {
      for (const element of (recovered.elements || [])) {
        if (Number(element?.elementType) === 5 && element.videoElement) {
          element.videoElement.filePath = videoDownload.absolutePath;
          element.videoElement.fileSize = String(videoDownload.sizeBytes);
          element.qqLocalRecallMedia = {
            sha256: videoDownload.sha256,
            relativePath: videoDownload.relativePath,
            sizeBytes: videoDownload.sizeBytes,
          };
        }
      }
    } else {
      for (const element of (recovered.elements || [])) {
        if (Number(element?.elementType) === 5 && element.videoElement) {
          this._log({ ev: 'videoRestorePre', messageId, video: this._safeStr(element.videoElement, 6000) });
          const ve = element.videoElement;
          if (!ve.filePath || !fs.existsSync(ve.filePath)) {
            // Video body not downloaded; fall back to thumbnail so QQNT renders a
            // preview image + play button instead of a 0% download spinner.
            // transferStatus=4 signals "locally available" to the QQNT renderer.
            let thumbFile = null;
            if (ve.thumbPath instanceof Map) {
              for (const [, p] of ve.thumbPath) {
                if (p && typeof p === 'string' && fs.existsSync(p)) { thumbFile = p; break; }
              }
            }
            if (thumbFile) {
              ve.filePath = thumbFile;
              ve.fileSize = String(fs.statSync(thumbFile).size);
              ve.transferStatus = 4;
            } else {
              ve.filePath = '';
              ve.fileSize = '0';
            }
          }
          this._log({ ev: 'videoRestorePost', messageId, video: this._safeStr(element.videoElement, 6000) });
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
            const et = Number(element?.elementType);
            if (et === 3 || et === 4) {
              if (!element.pttElement) element.pttElement = {};
              element.pttElement.duration = element.pttElement.duration || pttDownload.duration || 1;
              element.pttElement.fileSize = String(pttDownload.sizeBytes || 0);
              element.pttElement.voiceChangeType = element.pttElement.voiceChangeType ?? 0;
              element.pttElement.canConvert2Text = element.pttElement.canConvert2Text ?? false;
              element.qqLocalRecallMedia = {
                sha256: pttDownload.sha256,
                relativePath: pttDownload.relativePath,
                sizeBytes: pttDownload.sizeBytes,
              };
            }
          }
        }
        if (videoDownload) {
          for (const element of (persistable.elements || [])) {
            if (Number(element?.elementType) === 5 && element.videoElement) {
              element.videoElement.fileSize = String(videoDownload.sizeBytes);
              element.qqLocalRecallMedia = {
                sha256: videoDownload.sha256,
                relativePath: videoDownload.relativePath,
                sizeBytes: videoDownload.sizeBytes,
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
      const et = Number(element?.elementType);
      if ((et === 3 || et === 4) && this.pttStore) {
        if (!element.pttElement) element.pttElement = {};
        try {
          const absolutePath = this.pttStore.resolve(reference.relativePath);
          element.pttElement.filePath = absolutePath;
          return [element];
        } catch { return []; }
      }
      if (et === 5 && this.videoStore) {
        if (!element.videoElement) element.videoElement = {};
        try {
          const absolutePath = this.videoStore.resolve(reference.relativePath);
          element.videoElement.filePath = absolutePath;
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

module.exports = { RecallProcessor, readAmrDuration };
