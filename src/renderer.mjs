import { requestManagerOpen } from './ui/open-manager.mjs';
import {
  findMessageContent,
  findMessageRow,
  placeRecallNotice,
  removeRecallNotice,
} from './ui/recall-notice.mjs';

const recalledMessageIds = new Set();

function installStyle() {
  if (document.getElementById('qq-local-recall-style')) return;
  const style = document.createElement('style');
  style.id = 'qq-local-recall-style';
  style.textContent = `
    .qq-local-recall-notice {
      display: flex; justify-content: center; width: 100%; margin: 8px 0;
      color: var(--text_secondary, #8b8f97); font-size: 12px; line-height: 20px;
      user-select: none; pointer-events: none;
    }
    .qq-local-recall-notice__pill {
      padding: 2px 10px; border-radius: 12px;
      background: var(--background_secondary, rgb(0 0 0 / 8%));
    }
    .qq-local-recall-deleted { color: var(--text_secondary, #6b7280); font-size: 13px; }
  `;
  document.head.appendChild(style);
}

function markMessage(messageId) {
  return placeRecallNotice(document, findMessageRow(document, messageId), messageId);
}

function markVisibleMessages() {
  for (const messageId of recalledMessageIds) markMessage(messageId);
}

function replaceDeletedMessage(messageId) {
  recalledMessageIds.delete(String(messageId));
  removeRecallNotice(document, String(messageId));
  const target = findMessageContent(String(messageId));
  if (!target) return;
  const notice = document.createElement('span');
  notice.className = 'qq-local-recall-deleted';
  notice.textContent = '本地撤回记录已删除';
  target.replaceChildren(notice);
}

installStyle();
window.qqLocalRecall?.onRecovered?.(payload => {
  for (const messageId of payload?.messageIds || []) recalledMessageIds.add(String(messageId));
  setTimeout(markVisibleMessages, 0);
  setTimeout(markVisibleMessages, 120);
});
window.qqLocalRecall?.onRecordsDeleted?.(payload => {
  for (const messageId of payload?.messageIds || []) replaceDeletedMessage(messageId);
});

const observer = new MutationObserver(() => markVisibleMessages());
observer.observe(document.documentElement, { childList: true, subtree: true });

export async function onSettingWindowCreated(view) {
  const menu = document.createElement('plugin-menu');
  const item = document.createElement('setting-item');
  item.setAttribute('data-direction', 'row');
  const copy = document.createElement('div');
  const title = document.createElement('setting-text');
  title.textContent = '本地撤回记录';
  const description = document.createElement('div');
  description.className = 'secondary-text';
  description.textContent = '按好友或群聊查看占用，并整组删除本地保存内容。';
  const button = document.createElement('button');
  button.className = 'q-button q-button--small q-button--primary';
  button.textContent = '管理记录';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = '正在打开';
    const result = await requestManagerOpen(window.qqLocalRecall);
    button.textContent = result.ok ? '管理记录' : '打开失败';
    button.title = result.message;
    button.disabled = false;
  });
  copy.append(title, description);
  item.append(copy, button);
  menu.appendChild(item);
  view.appendChild(menu);
}
