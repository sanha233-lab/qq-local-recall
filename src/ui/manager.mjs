import { filterRows, formatBytes, formatTime } from './manager-model.mjs';

const state = { rows: [], selected: new Set(), query: '', expanded: new Set(), recordCache: new Map() };
const api = window.qqLocalRecallManager;
const elements = {
  search: document.getElementById('search'),
  delete: document.getElementById('delete'),
  status: document.getElementById('status'),
  actionError: document.getElementById('action-error'),
  table: document.querySelector('.table-wrap'),
  body: document.getElementById('rows'),
  selectAll: document.getElementById('select-all'),
  totalSize: document.getElementById('total-size'),
  totalCount: document.getElementById('total-count'),
  storagePath: document.getElementById('storage-path'),
  changeStorage: document.getElementById('change-storage'),
  networkMediaRecovery: document.getElementById('network-media-recovery'),
  preventSelf: document.getElementById('prevent-self'),
  versionWarning: document.getElementById('version-warning'),
};

const KIND_LABEL = { voice: '语音', picture: '图片', text: '文字' };

function visibleRows() {
  return filterRows(state.rows, state.query);
}

function showActionError(message) {
  elements.actionError.textContent = message;
  elements.actionError.hidden = !message;
}

function updateActions(rows) {
  elements.delete.disabled = state.selected.size === 0;
  elements.delete.textContent = state.selected.size ? `删除所选（${state.selected.size}）` : '删除所选';
  elements.selectAll.checked = rows.length > 0 && rows.every(row => state.selected.has(row.peerKey));
  elements.selectAll.indeterminate = rows.some(row => state.selected.has(row.peerKey)) && !elements.selectAll.checked;
}

function buildDetailRows(peerKey, records) {
  return records.map(rec => {
    const tr = document.createElement('tr');
    tr.className = 'record-row';
    const td = document.createElement('td');
    td.colSpan = 6;
    const item = document.createElement('div');
    item.className = 'record-item';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'record-time';
    timeSpan.textContent = formatTime(rec.recallTime);

    const kindSpan = document.createElement('span');
    kindSpan.className = `record-kind kind-${rec.kind}`;
    kindSpan.textContent = KIND_LABEL[rec.kind] || rec.kind;

    const contentSpan = document.createElement('span');
    contentSpan.className = 'record-content';
    if (rec.kind === 'voice' && Number(rec.durationSeconds) > 0) {
      contentSpan.textContent = `${rec.durationSeconds}″${rec.text ? ` ${rec.text}` : ''}`;
    } else if (rec.text) {
      contentSpan.textContent = rec.text;
      contentSpan.title = rec.text;
    }

    let thumb = null;
    if (rec.kind === 'picture' && rec.hasMediaPreview) {
      thumb = document.createElement('img');
      thumb.className = 'record-thumb';
      thumb.alt = '图片预览';
      thumb.hidden = true;
      if (rec.previewUrl) {
        thumb.src = rec.previewUrl;
        thumb.hidden = false;
      } else {
        const img = thumb;
        api.getRecordPreview(peerKey, rec.msgId).then(preview => {
          if (!preview?.base64) return;
          rec.previewUrl = `data:${preview.mimeType};base64,${preview.base64}`;
          img.src = rec.previewUrl;
          img.hidden = false;
        }).catch(() => {});
      }
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'record-delete';
    delBtn.type = 'button';
    delBtn.textContent = '删除';
    delBtn.setAttribute('aria-label', `删除此条${KIND_LABEL[rec.kind] || ''}记录`);
    delBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(`确定删除这条${KIND_LABEL[rec.kind] || ''}记录吗？此操作不可恢复。`);
      if (!confirmed) return;
      delBtn.disabled = true;
      try {
        await api.deleteRecord(peerKey, rec.msgId);
        showActionError('');
        await load();
      } catch (error) {
        delBtn.disabled = false;
        showActionError(`删除失败：${error?.message || String(error)}`);
      }
    });

    item.append(timeSpan, kindSpan);
    if (thumb) item.append(thumb);
    item.append(contentSpan, delBtn);
    td.appendChild(item);
    tr.appendChild(td);
    return tr;
  });
}

function render() {
  const rows = visibleRows();
  elements.body.replaceChildren();
  for (const row of rows) {
    const isExpanded = state.expanded.has(row.peerKey);

    const tr = document.createElement('tr');
    const checkCell = document.createElement('td');
    checkCell.className = 'check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = state.selected.has(row.peerKey);
    check.setAttribute('aria-label', `选择 ${row.name}`);
    check.addEventListener('change', () => {
      if (check.checked) state.selected.add(row.peerKey);
      else state.selected.delete(row.peerKey);
      updateActions(rows);
    });
    checkCell.appendChild(check);

    const peerCell = document.createElement('td');
    const peer = document.createElement('div');
    peer.className = 'peer';
    const nameRow = document.createElement('div');
    nameRow.className = 'peer-name-row';
    const name = document.createElement('strong');
    name.textContent = row.name || row.id;
    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-btn';
    expandBtn.type = 'button';
    expandBtn.textContent = isExpanded ? '收起' : '展开';
    expandBtn.setAttribute('aria-expanded', String(isExpanded));
    expandBtn.setAttribute('aria-label', `${isExpanded ? '收起' : '展开'} ${row.name} 的记录`);
    expandBtn.addEventListener('click', async () => {
      if (state.expanded.has(row.peerKey)) {
        state.expanded.delete(row.peerKey);
        render();
      } else {
        state.expanded.add(row.peerKey);
        if (!state.recordCache.has(row.peerKey)) {
          expandBtn.disabled = true;
          const records = await api.listRecords(row.peerKey);
          state.recordCache.set(row.peerKey, records);
        }
        render();
      }
    });
    nameRow.append(name, expandBtn);
    const id = document.createElement('span');
    id.textContent = row.id;
    peer.append(nameRow, id);
    peerCell.appendChild(peer);

    const type = document.createElement('td');
    type.className = 'type';
    type.textContent = row.type === 'group' ? '群聊' : '好友';
    const count = document.createElement('td');
    count.className = 'number';
    count.textContent = String(row.count);
    const size = document.createElement('td');
    size.className = 'number';
    size.textContent = formatBytes(row.sizeBytes);
    const time = document.createElement('td');
    time.textContent = formatTime(row.lastRecallTime);
    tr.append(checkCell, peerCell, type, count, size, time);
    elements.body.appendChild(tr);

    if (isExpanded) {
      const cached = state.recordCache.get(row.peerKey) || [];
      for (const detailTr of buildDetailRows(row.peerKey, cached)) {
        elements.body.appendChild(detailTr);
      }
    }
  }

  elements.status.hidden = rows.length > 0;
  elements.status.textContent = state.rows.length === 0 ? '还没有保存任何撤回记录' : '没有匹配的好友或群聊';
  elements.table.hidden = rows.length === 0;
  updateActions(rows);
  elements.totalSize.textContent = formatBytes(state.rows.reduce((sum, row) => sum + row.sizeBytes, 0));
  elements.totalCount.textContent = `${state.rows.length} 个会话`;
}

async function load() {
  elements.status.hidden = false;
  elements.status.textContent = '正在读取本地记录';
  try {
    state.rows = await api.listConversations();
    state.selected.clear();
    state.expanded.clear();
    state.recordCache.clear();
    render();
  } catch {
    elements.table.hidden = true;
    elements.status.hidden = false;
    elements.status.textContent = '读取失败，请关闭窗口后重试';
  }
}

async function loadStoragePath() {
  try {
    elements.storagePath.textContent = await api.getStoragePath();
  } catch {
    elements.storagePath.textContent = '读取失败';
  }
}

async function loadVersionInfo() {
  try {
    const info = await api.getQqVersion();
    if (info?.current && info.current !== info.verified) {
      elements.versionWarning.textContent = `当前 QQ 版本 ${info.current} 未经本插件验证（已验证：${info.verified}），拦截功能可能失效。`;
      elements.versionWarning.hidden = false;
    }
  } catch { /* 版本信息读取失败时不打扰用户 */ }
}

async function loadSettings() {
  try {
    const settings = await api.getSettings();
    elements.networkMediaRecovery.checked = settings.networkMediaRecovery === true;
    elements.preventSelf.checked = settings.preventSelf === true;
  } catch {
    elements.networkMediaRecovery.checked = true;
    elements.preventSelf.checked = false;
  }
}

elements.search.addEventListener('input', () => { state.query = elements.search.value; render(); });
elements.selectAll.addEventListener('change', () => {
  for (const row of visibleRows()) {
    if (elements.selectAll.checked) state.selected.add(row.peerKey);
    else state.selected.delete(row.peerKey);
  }
  render();
});
elements.delete.addEventListener('click', async () => {
  const selectedRows = state.rows.filter(row => state.selected.has(row.peerKey));
  const bytes = selectedRows.reduce((sum, row) => sum + row.sizeBytes, 0);
  const confirmed = window.confirm(`确定删除 ${selectedRows.length} 个会话的本地撤回记录（${formatBytes(bytes)}）吗？此操作不可恢复。`);
  if (!confirmed) return;
  elements.delete.disabled = true;
  try {
    await api.deleteConversations([...state.selected]);
    showActionError('');
    await load();
  } catch (error) {
    showActionError(`删除失败：${error?.message || String(error)}`);
    updateActions(visibleRows());
  }
});
elements.changeStorage.addEventListener('click', async () => {
  elements.changeStorage.disabled = true;
  try {
    const result = await api.chooseStoragePath();
    if (!result?.canceled) {
      elements.storagePath.textContent = result.path;
      showActionError('');
      await load();
    }
  } catch (error) {
    showActionError(`修改存储位置失败：${error?.message || String(error)}`);
    await loadStoragePath();
  } finally {
    elements.changeStorage.disabled = false;
  }
});
elements.networkMediaRecovery.addEventListener('change', async () => {
  const requested = elements.networkMediaRecovery.checked;
  elements.networkMediaRecovery.disabled = true;
  try {
    const settings = await api.updateSettings({ networkMediaRecovery: requested });
    elements.networkMediaRecovery.checked = settings.networkMediaRecovery === true;
    showActionError('');
  } catch (error) {
    elements.networkMediaRecovery.checked = !requested;
    showActionError(`设置保存失败：${error?.message || String(error)}`);
  } finally {
    elements.networkMediaRecovery.disabled = false;
  }
});
elements.preventSelf.addEventListener('change', async () => {
  const requested = elements.preventSelf.checked;
  elements.preventSelf.disabled = true;
  try {
    const settings = await api.updateSettings({ preventSelf: requested });
    elements.preventSelf.checked = settings.preventSelf === true;
    showActionError('');
  } catch (error) {
    elements.preventSelf.checked = !requested;
    showActionError(`设置保存失败：${error?.message || String(error)}`);
  } finally {
    elements.preventSelf.disabled = false;
  }
});
api.onRecordsDeleted(() => load());

await Promise.all([load(), loadStoragePath(), loadSettings(), loadVersionInfo()]);
