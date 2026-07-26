'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isLocalStoragePath } = require('./storage-path');

function peerFileName(peerKey) {
  return `${crypto.createHash('sha256').update(String(peerKey), 'utf8').digest('hex')}.json`;
}

function jsonMap(key, value) {
  if (value instanceof Map) return { __qqLocalRecallMap: [...value] };
  if (value instanceof Uint8Array) return { __qqLocalRecallUint8Array: [...value] };
  return value;
}

function reviveMap(key, value) {
  if (value?.__qqLocalRecallMap) return new Map(value.__qqLocalRecallMap);
  if (value?.__qqLocalRecallUint8Array) return new Uint8Array(value.__qqLocalRecallUint8Array);
  return value;
}

function peerAccount(entry) {
  if (entry.peer.uin) return String(entry.peer.uin);
  for (const record of entry.records) {
    const account = record?.message?.peerUin || record?.message?.senderUin;
    if (account) return String(account);
  }
  return '';
}

function peerDisplayName(entry) {
  const rawName = String(entry.peer.name || '').trim();
  if (entry.peer.type === 'group') return rawName || '群聊';
  if (rawName && !/^u_[A-Za-z0-9_-]+$/.test(rawName)) return rawName;
  const account = peerAccount(entry);
  return account ? `好友（QQ号：${account}）` : '好友';
}

class ConversationStore {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.recordsDir = path.join(this.rootDir, 'records');
    this.byMessageId = new Map();
    this.conversations = new Map();
    this.diagnostics = [];
    fs.mkdirSync(this.recordsDir, { recursive: true });
    this.load();
  }

  load() {
    this.byMessageId.clear();
    this.conversations.clear();
    this.diagnostics.length = 0;

    for (const name of fs.readdirSync(this.recordsDir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const filePath = path.join(this.recordsDir, name);
      try {
        const document = JSON.parse(fs.readFileSync(filePath, 'utf8'), reviveMap);
        if (document.schemaVersion !== 1 || !document.peer?.key || !Array.isArray(document.records)) {
          throw new Error('unsupported record document');
        }
        const entry = { filePath, peer: document.peer, records: document.records };
        this.conversations.set(document.peer.key, entry);
        for (const record of document.records) {
          if (record?.msgId) this.byMessageId.set(String(record.msgId), record);
        }
      } catch (error) {
        this.diagnostics.push({ file: name, error: String(error.message || error) });
        // Move the unreadable file aside so a new record for the same peer cannot
        // silently overwrite it; the backup stays recoverable by hand.
        try { fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`); } catch { /* keep in place */ }
      }
    }
  }

  save(record) {
    if (!record?.msgId || !record.peer?.key || !record.message) {
      throw new TypeError('record requires msgId, peer and message');
    }
    const msgId = String(record.msgId);
    if (this.byMessageId.has(msgId)) return false;

    const peerKey = String(record.peer.key);
    let entry = this.conversations.get(peerKey);
    if (!entry) {
      entry = {
        filePath: path.join(this.recordsDir, peerFileName(peerKey)),
        peer: { ...record.peer },
        records: [],
      };
      this.conversations.set(peerKey, entry);
    } else {
      entry.peer = { ...entry.peer, ...record.peer };
    }
    entry.records.push(record);
    this.writeEntry(entry);
    this.byMessageId.set(msgId, record);
    return true;
  }

  upsert(record) {
    if (!record?.msgId || !record.peer?.key || !record.message) {
      throw new TypeError('record requires msgId, peer and message');
    }
    const msgId = String(record.msgId);
    const previous = this.byMessageId.get(msgId);
    if (!previous) return this.save(record);
    const peerKey = String(record.peer.key);
    const entry = this.conversations.get(peerKey);
    if (!entry) throw new Error('existing record conversation is missing');
    const index = entry.records.findIndex(item => String(item?.msgId) === msgId);
    if (index < 0) throw new Error('existing record index is missing');
    entry.peer = { ...entry.peer, ...record.peer };
    entry.records[index] = record;
    this.writeEntry(entry);
    this.byMessageId.set(msgId, record);
    return false;
  }

  mediaReferences() {
    const references = [];
    for (const entry of this.conversations.values()) {
      for (const record of entry.records) {
        for (const element of record?.message?.elements || []) {
          if (element?.qqLocalRecallMedia) references.push(element.qqLocalRecallMedia);
        }
      }
    }
    return references;
  }

  writeEntry(entry) {
    const document = {
      schemaVersion: 1,
      peer: entry.peer,
      records: entry.records,
    };
    const tempPath = `${entry.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(document, jsonMap, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, entry.filePath);
  }

  get(messageId) {
    return this.byMessageId.get(String(messageId));
  }

  changeRoot(newRootDir) {
    const nextRoot = path.resolve(newRootDir);
    if (!isLocalStoragePath(nextRoot)) throw new TypeError('storage path must be an absolute local path');
    if (nextRoot === this.rootDir) return this.rootDir;
    const nextRecordsDir = path.join(nextRoot, 'records');
    fs.mkdirSync(nextRecordsDir, { recursive: true });
    for (const name of fs.readdirSync(this.recordsDir)) {
      if (!name.endsWith('.json')) continue;
      const source = path.join(this.recordsDir, name);
      const destination = path.join(nextRecordsDir, name);
      if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
      else this.mergeRecordFiles(source, destination);
    }
    this.rootDir = nextRoot;
    this.recordsDir = nextRecordsDir;
    this.load();
    return this.rootDir;
  }

  // Called when returning to a storage root that already holds a file for the
  // same peer: current-session records win, records written while the target
  // root was previously active are appended instead of being silently dropped.
  mergeRecordFiles(sourcePath, destinationPath) {
    let sourceDoc;
    try {
      sourceDoc = JSON.parse(fs.readFileSync(sourcePath, 'utf8'), reviveMap);
    } catch {
      return;
    }
    let destinationDoc;
    try {
      destinationDoc = JSON.parse(fs.readFileSync(destinationPath, 'utf8'), reviveMap);
    } catch {
      try { fs.renameSync(destinationPath, `${destinationPath}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      fs.copyFileSync(sourcePath, destinationPath);
      return;
    }
    if (!Array.isArray(sourceDoc?.records) || !Array.isArray(destinationDoc?.records)) {
      fs.copyFileSync(sourcePath, destinationPath);
      return;
    }
    const known = new Set(sourceDoc.records.map(record => String(record?.msgId)));
    const merged = sourceDoc.records.concat(
      destinationDoc.records.filter(record => record?.msgId && !known.has(String(record.msgId))),
    );
    const document = { schemaVersion: 1, peer: sourceDoc.peer, records: merged };
    const tempPath = `${destinationPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(document, jsonMap, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, destinationPath);
  }

  listConversations() {
    return [...this.conversations.entries()].map(([peerKey, entry]) => {
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(entry.filePath).size; } catch { /* file missing or locked */ }
      const last = entry.records.reduce((value, record) => {
        const time = Number(record.recallTime || 0);
        return time > value ? time : value;
      }, 0);
      return {
        peerKey,
        type: entry.peer.type,
        id: entry.peer.type === 'friend' ? (peerAccount(entry) || entry.peer.id) : entry.peer.id,
        name: peerDisplayName(entry),
        count: entry.records.length,
        sizeBytes,
        lastRecallTime: last ? String(last) : '',
      };
    }).sort((left, right) => right.sizeBytes - left.sizeBytes || left.name.localeCompare(right.name, 'zh-CN'));
  }

  getRecordSummaries(peerKey) {
    const entry = this.conversations.get(String(peerKey));
    if (!entry) return [];
    return entry.records.map(record => {
      const elements = record?.message?.elements || [];
      let kind = 'text';
      let text = '';
      let durationSeconds = 0;
      let hasMediaPreview = false;
      for (const el of elements) {
        if (el?.textElement?.content) text += String(el.textElement.content);
        if (kind === 'text' && el?.pttElement) kind = 'voice';
        else if (kind === 'text' && el?.videoElement) kind = 'video';
        else if (kind === 'text' && (el?.picElement || el?.marketFaceElement)) kind = 'picture';
        if (el?.pttElement && Number(el.pttElement.duration) > 0) durationSeconds = Number(el.pttElement.duration);
        if (el?.videoElement && Number(el.videoElement.fileTime) > 0) durationSeconds = Number(el.videoElement.fileTime);
        if ((el?.picElement || el?.marketFaceElement) && el?.qqLocalRecallMedia) hasMediaPreview = true;
      }
      if (text.length > 60) text = `${text.slice(0, 60)}…`;
      return {
        msgId: String(record.msgId),
        recallTime: record.recallTime ? String(record.recallTime) : '',
        kind,
        text,
        durationSeconds,
        hasMediaPreview,
      };
    });
  }

  deleteRecord(peerKey, msgId) {
    const key = String(peerKey);
    const id = String(msgId);
    const entry = this.conversations.get(key);
    if (!entry) return false;
    const index = entry.records.findIndex(r => String(r?.msgId) === id);
    if (index < 0) return false;
    entry.records.splice(index, 1);
    this.byMessageId.delete(id);
    if (entry.records.length === 0) {
      fs.rmSync(entry.filePath, { force: true });
      this.conversations.delete(key);
    } else {
      this.writeEntry(entry);
    }
    return true;
  }

  deleteConversations(peerKeys) {
    const deletedPeerKeys = [];
    const deletedMessageIds = [];
    for (const value of new Set(peerKeys.map(String))) {
      const entry = this.conversations.get(value);
      if (!entry) continue;
      fs.rmSync(entry.filePath, { force: true });
      for (const record of entry.records) {
        const messageId = String(record.msgId);
        this.byMessageId.delete(messageId);
        deletedMessageIds.push(messageId);
      }
      this.conversations.delete(value);
      deletedPeerKeys.push(value);
    }
    return { deletedPeerKeys, deletedMessageIds };
  }
}

module.exports = { ConversationStore, peerFileName };
