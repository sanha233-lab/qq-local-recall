export function filterRows(rows, query) {
  const normalized = String(query || '').trim().toLocaleLowerCase('zh-CN');
  if (!normalized) return [...rows];
  return rows.filter(row => `${row.name} ${row.id}`.toLocaleLowerCase('zh-CN').includes(normalized));
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${Number(amount.toFixed(1))} ${units[unit]}`;
}

export function formatTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '未知';
  const milliseconds = numeric < 100000000000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return '未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

