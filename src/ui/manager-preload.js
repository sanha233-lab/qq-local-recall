'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqLocalRecall', Object.freeze({
  listConversations: () => ipcRenderer.invoke('qq-local-recall:list-conversations'),
  deleteConversations: peerKeys => ipcRenderer.invoke('qq-local-recall:delete-conversations', peerKeys),
  onRecordsDeleted: callback => {
    ipcRenderer.on('qq-local-recall:records-deleted', (_event, payload) => callback(payload));
  },
}));
