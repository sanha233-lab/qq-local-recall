export const MEDIA_RETRY_DELAYS = Object.freeze([0, 250, 1000, 3000, 8000]);

function canvasInput(messageId, mediaIndex, candidate) {
  return {
    messageId,
    mediaIndex,
    mimeType: 'image/png',
    bytes: candidate.bytes,
    width: candidate.width,
    height: candidate.height,
  };
}

function inputsFor(messageId, mediaIndex, candidate) {
  const inputs = [];
  if (candidate.sourceUrl) inputs.push({ messageId, mediaIndex, sourceUrl: candidate.sourceUrl });
  if (candidate.bytes) inputs.push(canvasInput(messageId, mediaIndex, candidate));
  return inputs;
}

function markUnavailable(node) {
  if (!node) return;
  const notice = node.ownerDocument?.createElement?.('span');
  if (!notice) return;
  notice.className = 'qq-local-recall-media-unavailable';
  notice.textContent = '图片暂不可用';
  node.replaceWith?.(notice);
}

export function createMediaRetryCoordinator({ capture, persist, schedule = setTimeout, finalize = () => {} }) {
  const completed = new Map();
  const inFlight = new Set();
  const started = new Set();

  async function attempt(messageId, finalAttempt) {
    const candidates = await capture(messageId);
    for (let mediaIndex = 0; mediaIndex < candidates.length; mediaIndex += 1) {
      if (!candidates[mediaIndex]) continue;
      const identity = `${messageId}:${mediaIndex}`;
      const candidate = candidates[mediaIndex];
      if (completed.has(identity)) {
        const displayUrl = completed.get(identity);
        if (displayUrl && candidate.node) candidate.node.src = displayUrl;
        continue;
      }
      if (inFlight.has(identity)) continue;
      inFlight.add(identity);
      let saved = false;
      try {
        for (const input of inputsFor(messageId, mediaIndex, candidate)) {
          try {
            const result = await persist(input);
            completed.set(identity, String(result?.displayUrl || ''));
            if (result?.displayUrl && candidate.node) candidate.node.src = result.displayUrl;
            saved = true;
            break;
          } catch {
            // The next fixed retry or the local Canvas fallback remains eligible.
          }
        }
      } finally {
        inFlight.delete(identity);
      }
      if (!saved && finalAttempt) markUnavailable(candidate.node);
    }
    if (finalAttempt) finalize(messageId);
  }

  function start(messageId) {
    if (started.has(messageId)) return;
    started.add(messageId);
    MEDIA_RETRY_DELAYS.forEach((delay, index) => {
      schedule(() => { void attempt(messageId, index === MEDIA_RETRY_DELAYS.length - 1); }, delay);
    });
  }

  return { attempt, start };
}
