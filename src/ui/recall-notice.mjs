const noticeId = messageId => `qq-local-recall-notice-${String(messageId)}`;

export function findMessageRow(document, messageId) {
  const id = String(messageId);
  const row = document.getElementById(id) || document.getElementById(`ml-${id}`);
  if (row) return row;
  const direct = document.getElementById(`${id}-msgContainerMsgContent`)
    || document.getElementById(`${id}-msgContent`);
  return direct?.closest?.('.ml-item') || direct?.parentElement || null;
}

export function findMessageContent(document, messageId) {
  const id = String(messageId);
  const direct = document.getElementById(`${id}-msgContainerMsgContent`)
    || document.getElementById(`${id}-msgContent`);
  if (direct) return direct.parentElement || direct;
  const row = document.getElementById(id) || document.getElementById(`ml-${id}`);
  return row?.querySelector?.('.msg-content-container') || row || null;
}

export function formatRecallNotice(detail = {}) {
  const subject = detail.kind === 'picture' ? '图片' : '信息';
  const operatorName = String(detail.operatorName || '对方').trim() || '对方';
  const senderName = String(detail.senderName || '').trim();
  const operatorUid = String(detail.operatorUid || '');
  const senderUid = String(detail.senderUid || '');
  const sameSender = operatorUid && senderUid
    ? operatorUid === senderUid
    : Boolean(senderName && senderName === operatorName);
  const operatorRole = Number(detail.operatorRole);
  const roleName = operatorRole === 1 ? '管理员' : operatorRole === 2 ? '群主' : '';
  if (roleName && senderName && !sameSender) return `${roleName} ${operatorName} 尝试撤回 ${senderName} 的${subject}`;
  if (roleName) return `${roleName} ${operatorName} 尝试撤回此${subject}`;
  if (operatorName === '对方') return `对方尝试撤回此${subject}`;
  if (senderName && !sameSender) return `${operatorName} 尝试撤回 ${senderName} 的${subject}`;
  return `${operatorName} 尝试撤回此${subject}`;
}

export function placeRecallNotice(document, row, messageId, detail = {}) {
  if (!row?.parentElement) return false;
  let notice = document.getElementById(noticeId(messageId));
  if (!notice) {
    notice = document.createElement('div');
    notice.id = noticeId(messageId);
    notice.className = 'qq-local-recall-notice';
    const pill = document.createElement('span');
    pill.className = 'qq-local-recall-notice__pill';
    notice.appendChild(pill);
  }
  const pill = notice.querySelector?.('.qq-local-recall-notice__pill') || notice.children?.[0];
  const label = formatRecallNotice(typeof detail === 'string' ? { kind: detail } : detail);
  if (pill && pill.textContent !== label) pill.textContent = label;
  if (row.previousElementSibling !== notice) row.parentElement.insertBefore(notice, row);
  return true;
}

export function removeRecallNotice(document, messageId) {
  document.getElementById(noticeId(messageId))?.remove();
}

export function removeOrphanRecallNotices(document) {
  const prefix = 'qq-local-recall-notice-';
  const notices = document.querySelectorAll?.('.qq-local-recall-notice') || [];
  for (const notice of notices) {
    const id = String(notice.id || '');
    if (!id.startsWith(prefix)) continue;
    const row = findMessageRow(document, id.slice(prefix.length));
    if (!row || row.previousElementSibling !== notice) notice.remove();
  }
}
