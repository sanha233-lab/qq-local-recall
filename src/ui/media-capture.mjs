export const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;

function isExcluded(node) {
  return Boolean(node?.closest?.(
    '.gray-tip-message, .avatar, [class*="avatar"], [class*="loading"], [class*="spinner"]',
  ));
}

function canvasBlob(canvas) {
  return new Promise(resolve => canvas.toBlob?.(resolve, 'image/png'));
}

async function renderPng(node) {
  try {
    const tagName = String(node?.tagName || '').toUpperCase();
    if (tagName === 'IMG' && node.complete !== true) return null;
    const width = Number(tagName === 'CANVAS' ? node.width : node.naturalWidth || 0);
    const height = Number(tagName === 'CANVAS' ? node.height : node.naturalHeight || 0);
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) return null;
    let canvas = node;
    if (tagName !== 'CANVAS') {
      canvas = node?.ownerDocument?.createElement?.('canvas');
      if (!canvas) return null;
      canvas.width = width;
      canvas.height = height;
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
      width,
      height,
      node,
    };
  } catch {
    return null;
  }
}

export async function captureRenderedMedia(content) {
  const results = [];
  const containers = content?.querySelectorAll?.(
    '.pic-element, [class*="pic-element"], [class*="market-face"]',
  ) || [];
  for (const container of containers) {
    if (isExcluded(container)) continue;
    const mediaIndex = results.length;
    results.length += 1;
    const nodes = container?.querySelectorAll?.('img, canvas') || [];
    const node = [...nodes].find(candidate => !isExcluded(candidate));
    if (!node) continue;
    const tagName = String(node?.tagName || '').toUpperCase();
    const sourceUrl = String(node?.currentSrc || node?.src || '');
    if (tagName === 'IMG' && sourceUrl.startsWith('appimg:')) {
      const fallback = await renderPng(node);
      results[mediaIndex] = fallback
        ? { ...fallback, sourceUrl, staticFallback: false }
        : { sourceUrl, staticFallback: false, node };
      continue;
    }
    if (tagName === 'IMG' && sourceUrl.startsWith('https:')) {
      const fallback = await renderPng(node);
      results[mediaIndex] = fallback
        ? { ...fallback, sourceUrl, staticFallback: false }
        : { sourceUrl, staticFallback: false, node };
      continue;
    }
    const fallback = await renderPng(node);
    if (fallback) results[mediaIndex] = fallback;
  }
  return results;
}
