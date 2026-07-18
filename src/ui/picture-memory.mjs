export function rememberPictureContent(snapshots, messageId, content, limit = 500) {
  if (!snapshots || !content?.querySelector?.('img, canvas, video, svg')) return false;
  const id = String(messageId);
  snapshots.delete(id);
  snapshots.set(id, content.cloneNode(true));
  while (snapshots.size > limit) snapshots.delete(snapshots.keys().next().value);
  return true;
}

export function restorePictureContent(snapshots, messageId, target) {
  const id = String(messageId);
  const snapshot = snapshots?.get(id);
  if (!snapshot || !target?.replaceChildren) return false;
  if (target.dataset?.qqLocalRecallMemoryId === id
    && target.querySelector?.('img, canvas, video, svg')) return true;
  const clone = snapshot.cloneNode(true);
  target.replaceChildren(...clone.childNodes);
  if (target.dataset) target.dataset.qqLocalRecallMemoryId = id;
  return true;
}
