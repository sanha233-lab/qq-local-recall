'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqLocalRecallManager', Object.freeze({
  listConversations: () => ipcRenderer.invoke('qq-local-recall:list-conversations'),
  listRecords: peerKey => ipcRenderer.invoke('qq-local-recall:list-records', peerKey),
  getRecordPreview: (peerKey, msgId) => ipcRenderer.invoke('qq-local-recall:record-preview', peerKey, msgId),
  getQqVersion: () => ipcRenderer.invoke('qq-local-recall:qq-version'),
  deleteConversations: peerKeys => ipcRenderer.invoke('qq-local-recall:delete-conversations', peerKeys),
  deleteRecord: (peerKey, msgId) => ipcRenderer.invoke('qq-local-recall:delete-record', peerKey, msgId),
  getStoragePath: () => ipcRenderer.invoke('qq-local-recall:get-storage-path'),
  chooseStoragePath: () => ipcRenderer.invoke('qq-local-recall:choose-storage-path'),
  getSettings: () => ipcRenderer.invoke('qq-local-recall:get-settings'),
  updateSettings: value => ipcRenderer.invoke('qq-local-recall:update-settings', value),
  onRecordsDeleted: callback => {
    ipcRenderer.on('qq-local-recall:records-deleted', (_event, payload) => callback(payload));
  },
}));
