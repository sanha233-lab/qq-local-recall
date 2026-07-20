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

const recalledMessages = new Map();
const pictureSnapshots = new Map();
const persistedMedia = new Set();

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

async function captureKey(messageId, mediaIndex, media) {
  if (media.sourceUrl) return `${messageId}:${mediaIndex}:url:${media.sourceUrl}`;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', media.bytes);
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${messageId}:${mediaIndex}:sha256:${hash}`;
}

async function persistVisibleMedia(messageId) {
  const content = findMessageContent(document, messageId);
  if (!content) return;
  const captures = await captureRenderedMedia(content);
  for (let mediaIndex = 0; mediaIndex < captures.length; mediaIndex += 1) {
    const media = captures[mediaIndex];
    const key = await captureKey(messageId, mediaIndex, media);
    if (persistedMedia.has(key)) continue;
    persistedMedia.add(key);
    const value = media.sourceUrl
      ? { messageId, mediaIndex, sourceUrl: media.sourceUrl }
      : { messageId, mediaIndex, mimeType: media.mimeType, bytes: media.bytes };
    try {
      await window.qqLocalRecall.persistRenderedMedia(value);
    } catch {
      persistedMedia.delete(key);
    }
  }
}

function settleRecovered(messageId, detail) {
  markVisibleMessages();
  if (detail.memoryOnly === true) void persistVisibleMedia(messageId);
}

installStyle();
rememberVisiblePictures();
window.qqLocalRecall?.onRecovered?.(payload => {
  for (const messageId of payload?.messageIds || []) {
    const id = String(messageId);
    const detail = payload?.recallNotices?.[id] || {
      kind: payload?.messageKinds?.[id] === 'picture' ? 'picture' : 'message',
    };
    recalledMessages.set(id, detail);
    setTimeout(() => settleRecovered(id, detail), 0);
    setTimeout(() => settleRecovered(id, detail), 120);
    setTimeout(() => settleRecovered(id, detail), 1000);
  }
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
