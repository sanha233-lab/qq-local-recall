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

module.exports = { CHANNELS };
