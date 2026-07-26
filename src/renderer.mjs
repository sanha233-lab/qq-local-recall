import { requestManagerOpen } from './ui/open-manager.mjs';
import {
  rememberPictureContent,
  restorePictureContent,
} from './ui/picture-memory.mjs';
import {
  findMessageContent,
  findMessageRow,
  placeRecallNotice,
  removeOrphanRecallNotices,
  removeRecallNotice,
} from './ui/recall-notice.mjs';
import { captureRenderedMedia } from './ui/media-capture.mjs';
import { createMediaRetryCoordinator } from './ui/media-retry.mjs';

const recalledMessages = new Map();
const pictureSnapshots = new Map();

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
    .qq-local-recall-media-unavailable {
      display: inline-flex; align-items: center; min-height: 32px; padding: 6px 10px;
      color: var(--text_secondary, #6b7280); font-size: 13px;
    }
  `;
  document.head.appendChild(style);
}

function markMessage(messageId, detail) {
  return placeRecallNotice(document, findMessageRow(document, messageId), messageId, detail);
}

function rememberVisiblePictures() {
  const nodes = document.querySelectorAll?.('[id$="-msgContainerMsgContent"], [id$="-msgContent"]') || [];
  for (const node of nodes) {
    const id = String(node.id || '').replace(/-(?:msgContainerMsgContent|msgContent)$/, '');
    if (id) rememberPictureContent(pictureSnapshots, id, node.parentElement || node);
  }
}

function markVisibleMessages() {
  removeOrphanRecallNotices(document);
  rememberVisiblePictures();
  for (const [messageId, detail] of recalledMessages) {
    if (detail.memoryOnly === true) {
      restorePictureContent(pictureSnapshots, messageId, findMessageContent(document, messageId));
    }
    markMessage(messageId, detail);
  }
}

function replaceDeletedMessage(messageId) {
  recalledMessages.delete(String(messageId));
  removeRecallNotice(document, String(messageId));
  const target = findMessageContent(document, String(messageId));
  if (!target) return;
  const notice = document.createElement('span');
  notice.className = 'qq-local-recall-deleted';
  notice.textContent = '本地撤回记录已删除';
  target.replaceChildren(notice);
}

async function captureVisibleMedia(messageId) {
  markVisibleMessages();
  const content = findMessageContent(document, messageId);
  return content ? captureRenderedMedia(content) : [];
}

function finalizeVisibleMedia(messageId) {
  const content = findMessageContent(document, messageId);
  const nodes = content?.querySelectorAll?.('img, [class*="loading"], [class*="spinner"]') || [];
  for (const node of nodes) {
    if (node.complete !== false && !node.closest?.('[class*="loading"], [class*="spinner"]')) continue;
    const notice = document.createElement('span');
    notice.className = 'qq-local-recall-media-unavailable';
    notice.textContent = '图片暂不可用';
    node.replaceWith?.(notice);
  }
}

const mediaRecovery = createMediaRetryCoordinator({
  capture: captureVisibleMedia,
  persist: value => window.qqLocalRecall.persistRenderedMedia(value),
  finalize: finalizeVisibleMedia,
});

installStyle();
rememberVisiblePictures();

// QQ's own DOM churn (scrolling, typing, animations) fires many mutations per
// frame; coalesce them into a single markVisibleMessages() per frame instead
// of a full-document rescan and re-clone for every mutation record.
let markScheduled = false;
function scheduleMarkVisibleMessages() {
  if (markScheduled) return;
  markScheduled = true;
  const run = () => { markScheduled = false; markVisibleMessages(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else queueMicrotask(run);
}

window.qqLocalRecall?.onRecovered?.(payload => {
  const memoryOnlyIds = [];
  for (const messageId of payload?.messageIds || []) {
    const id = String(messageId);
    const detail = payload?.recallNotices?.[id] || {
      kind: payload?.messageKinds?.[id] === 'picture' ? 'picture' : 'message',
    };
    recalledMessages.set(id, detail);
    if (detail.memoryOnly === true) memoryOnlyIds.push(id);
  }
  markVisibleMessages();
  for (const id of memoryOnlyIds) mediaRecovery.start(id);
});
window.qqLocalRecall?.onRecordsDeleted?.(payload => {
  for (const messageId of payload?.messageIds || []) replaceDeletedMessage(messageId);
});

const observer = new MutationObserver(() => scheduleMarkVisibleMessages());
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
