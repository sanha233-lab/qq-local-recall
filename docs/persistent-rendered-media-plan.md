# QQ 撤回媒体跨重启持久化实施计划

**Goal:** 将 QQ 51246 中仅靠当前页面快照恢复的图片/动画表情保存为本地媒体副本，并在退出、重启 QQ 后继续恢复。

**Architecture:** 渲染层只上报消息 ID、媒体顺序以及 `appimg:` URL；主进程固定 IPC 调用 `MediaStore` 校验 QQ 媒体目录、20 MiB 上限和真实文件魔数，按 SHA-256 复制到记录根目录的 `media/`。处理器把内容寻址引用附加到待持久化消息元素，记录层支持同消息原子更新；重启恢复时先将相对引用解析为当前记录根目录下的绝对路径，再沿用现有 QQ 原生消息恢复链路。非 `appimg:` 来源只允许渲染层 Canvas PNG 降级，不增加生产 `fetch`。

**Tech Stack:** Node.js CommonJS/ESM、Electron IPC、LiteLoaderQQNT、`node:test`、PowerShell 打包与部署。

## Global Constraints

- QQ 固定版本 `9.9.32-51246`；QQ.exe 与 application.asar 不变。
- 媒体根目录是当前记录根目录下的 `media/`，本机当前对应 `G:\QQ\media`。
- 单项上限 `20 MiB`；只接受 GIF、PNG、JPEG、WebP 魔数，Canvas 降级只接受 PNG。
- `appimg:` 路径必须解析到 `Tencent Files/<账号>/nt_qq/nt_data/Pic` 或 `.../Emoji` 内。
- 禁止 `http:`、`https:`、网络下载、子进程、动态执行、任意输出路径 IPC。
- 不支持语音、视频、文件、转发记录或复杂卡片；不创建或更新朋友包。
- `progress.md` 只追加；行为和部署变化同步更新公开 `docs/`。
- 代码修改在最终实机验收通过后统一提交并推送 `origin/main`，不创建中间代码提交。

---

### Task 1: 内容寻址媒体存储

**Files:**
- Create: `src/core/media-store.js`
- Create: `test/media-store.test.js`

**Interfaces:**
- Produces: `MediaStore`, `MAX_MEDIA_BYTES`, `sniffImage`, `parseAppImagePath`。
- `new MediaStore(rootDir)`；`saveAppImage(url)` 和 `saveBytes(bytes, declaredMime, staticFallback)` 返回 `{ sha256, relativePath, mimeType, sizeBytes, staticFallback, absolutePath }`。
- `resolve(reference)` 返回校验后的绝对路径；`copyReferencedTo(nextRoot, references)` 复制引用文件；`sweep(references)` 删除无引用媒体。

- [ ] **Step 1: 写失败测试**

  在 `test/media-store.test.js` 覆盖：
  - `GIF89a` 文件即使扩展名为 `.jpg`、声明为 JPEG，也保存为 `media/<sha>.gif` 和 `image/gif`。
  - PNG/JPEG/WebP 魔数映射固定扩展名。
  - 相同字节只生成一个文件。
  - 超过 `20 * 1024 * 1024`、未知魔数、`http:`、路径逃逸以及不在 `Pic/Emoji` 目录的 `appimg:` 输入被拒绝。
  - 临时文件原子重命名后不存在残留 `.tmp`。
  - `resolve` 拒绝大小或 SHA-256 不一致的文件。
  - `sweep` 只删除无引用媒体。

- [ ] **Step 2: 验证红灯**

  Run: `node --test test/media-store.test.js`

  Expected: FAIL，原因是 `../src/core/media-store` 尚不存在。

- [ ] **Step 3: 最小实现**

  `src/core/media-store.js` 使用以下固定规则：

  ```js
  const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
  const TYPES = [
    { test: b => b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a', mimeType: 'image/gif', extension: 'gif' },
    { test: b => b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), mimeType: 'image/png', extension: 'png' },
    { test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, mimeType: 'image/jpeg', extension: 'jpg' },
    { test: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP', mimeType: 'image/webp', extension: 'webp' },
  ];
  ```

  `parseAppImagePath` 使用 `new URL(value)`，要求 `protocol === 'appimg:'`、单字母盘符 host，解码后用 `path.win32.resolve` 规范化，并要求规范化路径匹配 `\\Tencent Files\\[^\\]+\\nt_qq\\nt_data\\(?:Pic|Emoji)\\`。写入时先读取文件状态并执行上限检查，再读字节、按魔数识别、计算 SHA-256、写同目录临时文件并重命名。

- [ ] **Step 4: 验证绿灯**

  Run: `node --test test/media-store.test.js`

  Expected: 全部通过，且测试临时目录没有 `.tmp` 残留。

---

### Task 2: 撤回记录附加媒体引用与跨重启恢复

**Files:**
- Modify: `src/core/recall.js`
- Modify: `src/core/processor.js`
- Modify: `src/core/store.js`
- Modify: `test/core.test.js`
- Modify: `test/processor.test.js`
- Modify: `test/store.test.js`

**Interfaces:**
- `ConversationStore.upsert(record)`：同 `msgId` 原子替换已有记录，否则沿用新增逻辑。
- `ConversationStore.mediaReferences()`：返回全部元素上的 `qqLocalRecallMedia` 引用。
- `RecallProcessor` 新增构造参数 `mediaStore`。
- `RecallProcessor.persistRenderedMedia({ messageId, mediaIndex, reference })`：补齐待恢复媒体元素并 upsert 记录。

- [ ] **Step 1: 写失败测试**

  覆盖以下行为：
  - `sanitizeMessage` 保留元素上的 `qqLocalRecallMedia` 固定引用字段，但不保留任意额外字段。
  - 首次 `memoryOnly` 撤回后，处理器保留待恢复对象；传入第 0 个媒体引用后，纯表情产生可持久化记录。
  - 混合文字+表情先保存文字，附加媒体后同一记录被原子更新为 `[1,2]`，记录数不增加。
  - 多媒体按媒体元素顺序逐项更新；未附加的媒体继续保持当前会话行为。
  - 新处理器加载记录时调用 `mediaStore.resolve`，将相对引用重建为当前根目录的 `sourcePath/filePath` 或 `staticFacePath/dynamicFacePath`。
  - 损坏引用只丢弃对应媒体，混合消息文字仍恢复。

- [ ] **Step 2: 验证红灯**

  Run: `node --test test/core.test.js test/processor.test.js test/store.test.js`

  Expected: FAIL，缺少 `upsert`、`mediaReferences`、`persistRenderedMedia` 和引用保留逻辑。

- [ ] **Step 3: 最小实现**

  元素引用固定为：

  ```js
  element.qqLocalRecallMedia = {
    sha256: reference.sha256,
    relativePath: reference.relativePath,
    mimeType: reference.mimeType,
    sizeBytes: reference.sizeBytes,
    staticFallback: reference.staticFallback === true,
  };
  ```

  `RecallProcessor.restore` 对 `memoryOnly` 对象写入有界 `pendingMedia` Map；Map 与候选缓存使用同一消息 ID，并在缓存淘汰、记录删除或普通持久化完成时清理。`persistRenderedMedia` 获取第 `mediaIndex` 个 `picElement/marketFaceElement`：图片补齐 `sourcePath`、`filePath`、`fileSize`；商城表情按 `staticFallback` 选择 `staticFacePath`，动画原件选择 `dynamicFacePath`。随后使用 `store.upsert` 保存当前可持久化内容。

  恢复记录前先逐元素调用 `mediaStore.resolve`，以当前根目录重新补齐绝对路径，再调用 `sanitizeMessage`。引用校验失败时删除该媒体元素后继续处理其他元素。

- [ ] **Step 4: 验证绿灯**

  Run: `node --test test/core.test.js test/processor.test.js test/store.test.js`

  Expected: 全部通过；纯表情和混合消息均可在新处理器实例中恢复。

---

### Task 3: 固定 IPC 与渲染捕获

**Files:**
- Create: `src/ui/media-capture.mjs`
- Create: `test/media-capture.test.mjs`
- Modify: `src/preload-api.js`
- Modify: `src/preload.js`
- Modify: `src/main-plugin.js`
- Modify: `src/renderer.mjs`
- Modify: `test/preload-api.test.js`
- Modify: `test/preload-entry.test.js`
- Modify: `test/main-plugin.test.js`
- Modify: `test/renderer-notice.test.mjs`

**Interfaces:**
- 新固定通道 `qq-local-recall:persist-rendered-media`。
- Preload 暴露 `persistRenderedMedia(value)`，不暴露路径或通用文件接口。
- `captureRenderedMedia(content)` 返回按 DOM 顺序排列的 `{ sourceUrl, bytes, mimeType, staticFallback }`。

- [ ] **Step 1: 写失败测试**

  覆盖：
  - `appimg:` `<img>` 返回 `sourceUrl`，不读取或传输任意路径。
  - `http:`、`https:` 图片不产生原始媒体请求；Canvas 可导出时只返回 PNG 字节，失败时返回空数组。
  - `canvas.toBlob` 超过 20 MiB 时拒绝。
  - IPC 参数只接受字符串消息 ID、0 到 31 的媒体序号、`appimg:` URL，或最大 20 MiB 的 PNG `Uint8Array`；拒绝多余键、任意路径和未知 MIME。
  - `onRecovered` 只对 `memoryOnly=true` 的消息在 0、120、1000ms 三个既有渲染稳定点尝试捕获；相同消息/媒体哈希不重复写入。

- [ ] **Step 2: 验证红灯**

  Run: `node --test test/media-capture.test.mjs test/preload-api.test.js test/preload-entry.test.js test/main-plugin.test.js test/renderer-notice.test.mjs`

  Expected: FAIL，固定通道和捕获模块尚不存在。

- [ ] **Step 3: 最小实现**

  `media-capture.mjs` 仅扫描消息正文内 `img,canvas,video,svg`，排除 `.gray-tip-message` 和头像节点。`appimg:` 图片直接上报 URL；其他图片不调用 `fetch`，只尝试画入 Canvas 并通过 `toBlob('image/png')` 生成静态降级。`renderer.mjs` 使用 `findMessageContent(document, messageId)` 定位正文，按媒体 DOM 顺序调用固定 API。

  主进程处理器：

  ```js
  ipcMain.handle(CHANNELS.persistMedia, (_event, value) => {
    const input = validatePersistedMediaInput(value);
    const reference = input.sourceUrl
      ? mediaStore.saveAppImage(input.sourceUrl)
      : mediaStore.saveBytes(Buffer.from(input.bytes), input.mimeType, true);
    processor.persistRenderedMedia({ messageId: input.messageId, mediaIndex: input.mediaIndex, reference });
    return { ok: true, reference: publicReference(reference) };
  });
  ```

  `validatePersistedMediaInput` 使用白名单复制字段，不接受调用者提供的文件路径、哈希或目标目录。

- [ ] **Step 4: 验证绿灯**

  Run: `node --test test/media-capture.test.mjs test/preload-api.test.js test/preload-entry.test.js test/main-plugin.test.js test/renderer-notice.test.mjs`

  Expected: 全部通过；生产源码仍无通用网络 API。

---

### Task 4: 删除清理与记录目录迁移

**Files:**
- Modify: `src/main-plugin.js`
- Modify: `src/core/store.js`
- Modify: `test/main-plugin.test.js`
- Modify: `test/store.test.js`
- Modify: `docs/architecture.md`
- Modify: `docs/installation.md`
- Modify: `docs/testing.md`
- Modify: `README.md`

**Interfaces:**
- 删除会话后执行 `mediaStore.sweep(store.mediaReferences())`。
- 修改记录目录前执行 `mediaStore.copyReferencedTo(nextPath, store.mediaReferences())`，记录切换成功后 `mediaStore.setRoot(nextPath)`。

- [ ] **Step 1: 写失败测试**

  覆盖：
  - 两个会话引用相同 SHA-256 时，删除一个会话不删除媒体；删除最后引用后删除文件。
  - 修改记录目录复制 JSON 和被引用媒体，不复制孤儿文件。
  - 复制或记录切换失败时保持旧 root 生效，已存在的旧记录与媒体不受影响。
  - `-RemoveData` 和管理页删除说明明确媒体文件同步处理。

- [ ] **Step 2: 验证红灯**

  Run: `node --test test/main-plugin.test.js test/store.test.js`

  Expected: FAIL，删除和迁移尚未调用媒体存储。

- [ ] **Step 3: 最小实现与文档同步**

  在主插件删除 IPC 完成记录删除后，以剩余引用执行 sweep。路径迁移顺序固定为“复制引用媒体 → 切换记录 root → 切换媒体 root → 写配置”；失败时将记录和媒体 root 恢复为旧值。README 和 docs 明确 `media/`、20 MiB 单项限制、动画优先/PNG 降级、去重和删除行为。

- [ ] **Step 4: 验证绿灯**

  Run: `node --test test/main-plugin.test.js test/store.test.js`

  Expected: 全部通过。

---

### Task 5: 版本、全量验证、交付与实机验收

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `scripts/install.ps1`
- Modify: `scripts/package.ps1`
- Modify: `scripts/static-audit.js`
- Modify: `scripts/validate-package.js`
- Modify: `delivery/install.ps1`
- Replace: `delivery/QQ-Local-Recall-v1.3.7.zip` with `delivery/QQ-Local-Recall-v1.3.8.zip`
- Replace: `delivery/QQ-Local-Recall-source-v1.3.7.zip` with `delivery/QQ-Local-Recall-source-v1.3.8.zip`
- Modify: `delivery/SHA256SUMS.txt`
- Append: `progress.md`

**Interfaces:**
- 正式版本统一为 `1.3.8`。
- 静态审核继续禁止 `fetch`、WebSocket、EventSource、Node 网络模块、子进程和动态执行，并新增 `http:`/`https:` 字面量审计。

- [ ] **Step 1: 完整自动化验证**

  Run: `npm.cmd test`

  Expected: 所有测试通过，0 fail。

  Run: `npm.cmd run check`

  Expected: 静态审核、Manifest V4、离线 CSP、ZIP 必要入口和六项 SHA-256 全部通过。

  Run: 对 `src/` 全部 `.js/.mjs` 执行 `node --check`。

  Expected: 全部 exit 0。

- [ ] **Step 2: 重建基础交付**

  Run: `npm.cmd run package`

  Expected: 只生成 1.3.8 基础插件 ZIP、源码 ZIP、install/rollback、vendor 和 SHA256SUMS；朋友包 Git 差异为 0。

- [ ] **Step 3: 部署前完整性记录与备份部署**

  记录 `G:\QQ\records` 文件名清单、QQ.exe/application.asar SHA-256 和进程状态；完全退出 QQ 后运行：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\delivery\install.ps1 -QQInstallPath 'D:\QQ'
  ```

  Expected: 新备份点位于 `delivery/backup/9.9.32-51246-<timestamp>`，安装版本 1.3.8。

- [ ] **Step 4: 部署后自动复核**

  - 安装目录文件集合与仓库逐文件 SHA-256 一致。
  - 原有 records 文件全部存在。
  - QQ 正常启动且所有进程 Responding。
  - QQ.exe 与 application.asar 固定哈希不变。
  - 插件源码无临时诊断标记。

- [ ] **Step 5: 最终实机验收**

  - 另一账号发送并撤回一条动画表情，当下仍显示动画。
  - 完全退出 QQ，确认 `G:\QQ\media` 已生成按 SHA-256 命名的 GIF/WebP/PNG/JPEG 文件。
  - 重启 QQ 并打开原会话，确认动画继续显示；若原始字节路径失败，确认静态 PNG 仍显示。
  - 切换会话等待 10 秒后切回，媒体仍显示。
  - 使用新建的测试会话记录验证删除清理，不触碰原有 26 个记录文件；共享引用仍保留，最后引用删除后媒体被清理。

- [ ] **Step 6: 记录、提交和推送**

  在 `progress.md` 末尾追加实现、TDD 红绿证据、包校验、备份点、实机结果、文件清单和回滚命令。最终验收通过后：

  ```powershell
  git add -A
  git diff --cached --check
  git commit -m "feat: persist recalled media across QQ restarts"
  git push origin main
  ```

  Expected: `HEAD` 与 `origin/main` 相同，工作区清洁。
