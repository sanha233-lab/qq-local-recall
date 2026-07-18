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
      if (!/^[a-f0-9]{64}\.json$/.test(name) && name !== 'broken.json') continue;
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
    }
    this.rootDir = nextRoot;
    this.recordsDir = nextRecordsDir;
    this.load();
    return this.rootDir;
  }

  listConversations() {
    return [...this.conversations.entries()].map(([peerKey, entry]) => {
      const stats = fs.statSync(entry.filePath);
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
        sizeBytes: stats.size,
        lastRecallTime: last ? String(last) : '',
      };
    }).sort((left, right) => right.sizeBytes - left.sizeBytes || left.name.localeCompare(right.name, 'zh-CN'));
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
