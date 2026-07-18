export const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;

function isExcluded(node) {
  return Boolean(node?.closest?.('.gray-tip-message, .avatar, [class*="avatar"]'));
}

function canvasBlob(canvas) {
  return new Promise(resolve => canvas.toBlob?.(resolve, 'image/png'));
}

async function renderPng(node) {
  try {
    let canvas = node;
    if (String(node?.tagName || '').toUpperCase() !== 'CANVAS') {
      canvas = node?.ownerDocument?.createElement?.('canvas');
      if (!canvas) return null;
      canvas.width = Number(node.naturalWidth || node.videoWidth || node.clientWidth || 0);
      canvas.height = Number(node.naturalHeight || node.videoHeight || node.clientHeight || 0);
      if (!canvas.width || !canvas.height) return null;
      const context = canvas.getContext?.('2d');
      if (!context) return null;
      context.drawImage(node, 0, 0, canvas.width, canvas.height);
    }
    const blob = await canvasBlob(canvas);
    if (!blob || blob.size < 1 || blob.size > MAX_CAPTURE_BYTES) return null;
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: 'image/png',
      staticFallback: true,
    };
  } catch {
    return null;
  }
}

export async function captureRenderedMedia(content) {
  const results = [];
  const nodes = content?.querySelectorAll?.('img,canvas,video,svg') || [];
  for (const node of nodes) {
    if (isExcluded(node)) continue;
    const tagName = String(node?.tagName || '').toUpperCase();
    const sourceUrl = String(node?.currentSrc || node?.src || '');
    if (tagName === 'IMG' && sourceUrl.startsWith('appimg:')) {
      results.push({ sourceUrl, staticFallback: false });
      continue;
    }
    const fallback = await renderPng(node);
    if (fallback) results.push(fallback);
  }
  return results;
}
