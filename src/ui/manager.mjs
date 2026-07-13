import { filterRows, formatBytes, formatTime } from './manager-model.mjs';

const state = { rows: [], selected: new Set(), query: '' };
const elements = {
  search: document.getElementById('search'),
  delete: document.getElementById('delete'),
  status: document.getElementById('status'),
  table: document.querySelector('.table-wrap'),
  body: document.getElementById('rows'),
  selectAll: document.getElementById('select-all'),
  totalSize: document.getElementById('total-size'),
  totalCount: document.getElementById('total-count'),
  storagePath: document.getElementById('storage-path'),
  changeStorage: document.getElementById('change-storage'),
};

function visibleRows() {
  return filterRows(state.rows, state.query);
}

function updateActions(rows) {
  elements.delete.disabled = state.selected.size === 0;
  elements.delete.textContent = state.selected.size ? `删除所选（${state.selected.size}）` : '删除所选';
  elements.selectAll.checked = rows.length > 0 && rows.every(row => state.selected.has(row.peerKey));
  elements.selectAll.indeterminate = rows.some(row => state.selected.has(row.peerKey)) && !elements.selectAll.checked;
}

function render() {
  const rows = visibleRows();
  elements.body.replaceChildren();
  for (const row of rows) {
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
    const name = document.createElement('strong');
    name.textContent = row.name || row.id;
    const id = document.createElement('span');
    id.textContent = row.id;
    peer.append(name, id);
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
    state.rows = await window.qqLocalRecall.listConversations();
    state.selected.clear();
    render();
  } catch {
    elements.table.hidden = true;
    elements.status.hidden = false;
    elements.status.textContent = '读取失败，请关闭窗口后重试';
  }
}

async function loadStoragePath() {
  try {
    elements.storagePath.textContent = await window.qqLocalRecall.getStoragePath();
  } catch {
    elements.storagePath.textContent = '读取失败';
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
  await window.qqLocalRecall.deleteConversations([...state.selected]);
  await load();
});
elements.changeStorage.addEventListener('click', async () => {
  elements.changeStorage.disabled = true;
  try {
    const result = await window.qqLocalRecall.chooseStoragePath();
    if (!result?.canceled) {
      elements.storagePath.textContent = result.path;
      await load();
    }
  } catch (error) {
    elements.storagePath.textContent = `修改失败：${error?.message || String(error)}`;
  } finally {
    elements.changeStorage.disabled = false;
  }
});
window.qqLocalRecall.onRecordsDeleted(() => load());

await Promise.all([load(), loadStoragePath()]);
