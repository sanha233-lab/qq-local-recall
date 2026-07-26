'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqLocalRecall', Object.freeze({
  openManager: () => ipcRenderer.invoke('qq-local-recall:open-manager'),
  persistRenderedMedia: value => ipcRenderer.invoke('qq-local-recall:persist-rendered-media', value),
  onRecordsDeleted: callback => {
    ipcRenderer.on('qq-local-recall:records-deleted', (_event, payload) => callback(payload));
  },
  onRecovered: callback => {
    ipcRenderer.on('qq-local-recall:recovered', (_event, payload) => callback(payload));
  },
}));
