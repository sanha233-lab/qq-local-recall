export async function requestManagerOpen(api) {
  try {
    const opened = await api.openManager();
    return opened === true
      ? { ok: true, message: '管理窗口已打开' }
      : { ok: false, message: '管理窗口未能打开' };
  } catch (error) {
    return { ok: false, message: `打开失败：${error?.message || String(error)}` };
  }
}

