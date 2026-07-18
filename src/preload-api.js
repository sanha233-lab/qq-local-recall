'use strict';

const CHANNELS = Object.freeze({
  list: 'qq-local-recall:list-conversations',
  delete: 'qq-local-recall:delete-conversations',
  deleted: 'qq-local-recall:records-deleted',
  open: 'qq-local-recall:open-manager',
  recovered: 'qq-local-recall:recovered',
  storagePath: 'qq-local-recall:get-storage-path',
  chooseStoragePath: 'qq-local-recall:choose-storage-path',
  persistMedia: 'qq-local-recall:persist-rendered-media',
});

function createPreloadApi(ipcRenderer, { includeOpen = false, includeRecovered = false } = {}) {
  const api = {
    listConversations: () => ipcRenderer.invoke(CHANNELS.list),
    deleteConversations: peerKeys => ipcRenderer.invoke(CHANNELS.delete, peerKeys),
    onRecordsDeleted: callback => {
      ipcRenderer.on(CHANNELS.deleted, (_event, payload) => callback(payload));
    },
  };
  if (includeOpen) api.openManager = () => ipcRenderer.invoke(CHANNELS.open);
  if (includeRecovered) {
    api.persistRenderedMedia = value => ipcRenderer.invoke(CHANNELS.persistMedia, value);
    api.onRecovered = callback => {
      ipcRenderer.on(CHANNELS.recovered, (_event, payload) => callback(payload));
    };
  }
  return Object.freeze(api);
}

module.exports = { CHANNELS, createPreloadApi };
