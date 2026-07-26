'use strict';

const CHANNELS = Object.freeze({
  list: 'qq-local-recall:list-conversations',
  listRecords: 'qq-local-recall:list-records',
  delete: 'qq-local-recall:delete-conversations',
  deleteRecord: 'qq-local-recall:delete-record',
  deleted: 'qq-local-recall:records-deleted',
  open: 'qq-local-recall:open-manager',
  recovered: 'qq-local-recall:recovered',
  storagePath: 'qq-local-recall:get-storage-path',
  chooseStoragePath: 'qq-local-recall:choose-storage-path',
  persistMedia: 'qq-local-recall:persist-rendered-media',
  settings: 'qq-local-recall:get-settings',
  updateSettings: 'qq-local-recall:update-settings',
});

function createPreloadApi(
  ipcRenderer,
  { includeOpen = false, includeRecovered = false, includeSettings = false } = {},
) {
  const api = {
    listConversations: () => ipcRenderer.invoke(CHANNELS.list),
    listRecords: peerKey => ipcRenderer.invoke(CHANNELS.listRecords, peerKey),
    deleteConversations: peerKeys => ipcRenderer.invoke(CHANNELS.delete, peerKeys),
    deleteRecord: (peerKey, msgId) => ipcRenderer.invoke(CHANNELS.deleteRecord, peerKey, msgId),
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
  if (includeSettings) {
    api.getSettings = () => ipcRenderer.invoke(CHANNELS.settings);
    api.updateSettings = value => ipcRenderer.invoke(CHANNELS.updateSettings, value);
  }
  return Object.freeze(api);
}

module.exports = { CHANNELS, createPreloadApi };
