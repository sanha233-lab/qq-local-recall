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

export function placeRecallNotice(document, row, messageId) {
  if (!row?.parentElement) return false;
  let notice = document.getElementById(noticeId(messageId));
  if (!notice) {
    notice = document.createElement('div');
    notice.id = noticeId(messageId);
    notice.className = 'qq-local-recall-notice';
    const pill = document.createElement('span');
    pill.className = 'qq-local-recall-notice__pill';
    pill.textContent = '对方尝试撤回一条消息';
    notice.appendChild(pill);
  }
  if (row.previousElementSibling !== notice) row.parentElement.insertBefore(notice, row);
  return true;
}

export function removeRecallNotice(document, messageId) {
  document.getElementById(noticeId(messageId))?.remove();
}
