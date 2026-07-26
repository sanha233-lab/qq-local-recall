# 交接文档：后续可迭代方向（面向下一位接手的 AI/开发者）

> 编写时间：2026-07-26，基于当前仓库状态（版本 1.4.2）核实。以下所有条目均经过源码直接查证，非道听途说或未经验证的推测。

> **2026-07-26 更新（1.4.3/1.4.4 之后）**：本文两条结论已被后续深度评审推翻，请勿沿用——
> 1. 第 4 节"deleteRecord 已调用 sweep、会正确清理孤儿媒体"：字面调用存在，但 MediaStore.sweep 遇到语音 `ptt/` 引用会抛 TypeError，存在语音记录时删除/迁移链路整体失效，已在 1.4.3 修复。
> 2. 第 5 节"1.4.2 已完成展开单条会话、逐条删除"：因 manager-preload.js 未暴露 listRecords/deleteRecord，该功能在 1.4.2 从未真正可用，已在 1.4.3 修复。
>
> 此外：P0-1（README 版本号）、P0-2（开关失败无提示）、P1-4（AMR 无单测）及诊断日志遗留均已在 1.4.3/1.4.4 处理。仍然有效的迭代方向：P0-3 记录内容预览、P1-5 视频/文件支持、P2-6 QQ 版本自检。

## 1. 项目速览（冷启动必读）

`qq-local-recall` 是一个 LiteLoaderQQNT 插件（manifest_version 4），用于拦截并本地保存 QQ 中被撤回的消息，支持文字、图片、语音（AMR）。核心结构：

- `main-plugin.js`：主进程逻辑，注册 `ipcMain.handle`，管理 `ConversationStore` / `MediaStore` / `PttStore`。
- `preload-api.js`：通过 `ipcRenderer.invoke` 暴露 API 给管理页渲染进程，定义 IPC channel 常量。
- `src/ui/manager.mjs`：管理页 UI，纯手写 DOM 操作，无框架，用 `state`（`rows`/`selected`/`expanded`/`recordCache`）管理界面状态。
- `processor.js`：消息处理逻辑，包含 AMR 语音时长解析（`readAmrDuration`，手写二进制帧头解析）。
- 存储：`ConversationStore` 用 JSON 文件持久化撤回记录（peerKey → records，含 byMessageId 索引）；`MediaStore`（图片）和 `PttStore`（语音）均按 SHA-256 去重，并提供 `sweep()` 清理孤儿媒体文件。
- 受限图片回源：复用 QQ 当前 webContents session 的 `event.sender.session.fetch`，做了多层校验（HTTPS/host/port/path/参数/超时/大小上限/magic bytes）。
- 测试：Node 内置测试运行器，`npm test` 执行，当前 129 个测试通过。
- 已验证的运行环境仅有 QQ `9.9.32-51246` Windows x64，代码中**没有**运行时版本自检逻辑（已用 grep 确认 `main-plugin.js` 内无 "version"/"VERSION" 匹配）。

## 2. 当前已知的功能边界（README 已声明，非 bug）

- 不支持撤回消息类型：视频、文件、转发消息、卡片消息。
- 不会随 QQ 版本自动适配（无版本自检，见上）。

## 3. 可迭代方向（已逐条核实，按优先级排列）

### P0 - 低成本、高确定性

1. **README 版本号过期**
   `README.md` 第 5 行仍写 `> 最新版本：**1.4.1**`，但 `manifest.json` / `CHANGELOG.md` 显示当前实际版本已是 1.4.2。纯文案问题，改一行即可，建议顺手核对每次发版是否忘记同步这个位置。

2. **设置开关（网络媒体回源 / 拦截自己撤回）保存失败时用户无感知**
   `src/ui/manager.mjs` 中 `networkMediaRecovery` 与 `preventSelf` 两个 checkbox 的 `change` 监听器，请求失败时仅静默把勾选状态还原（`elements.xxx.checked = !requested`），**没有任何错误提示**给用户。用户只会看到开关"自己弹回去"，不知道发生了什么、也不知道要不要重试。
   对比：同文件中"更改存储路径"(`changeStorage`) 的失败处理是有具体错误文案的（会把错误信息写到 `storagePath` 文本上，虽然这种做法会临时覆盖掉原路径显示，也算是个小瑕疵，但至少不是完全无反馈）。
   建议：给两个开关的失败分支也补一条可见的错误提示（例如复用一个 toast/status 区域），顺便也可以把 `changeStorage` 的错误提示改成不覆盖路径文本，而是用单独的状态提示位。

3. **记录详情视图没有内容预览**
   `manager.mjs` 的 `buildDetailRows` 目前每条撤回记录只渲染：时间、类型标签（语音/图片/文字）、删除按钮。**看不到消息实际内容**——文字记录看不到文字片段，图片/语音记录看不到缩略图或试听。用户想知道撤回的是什么内容，只能靠类型标签猜。这是当前管理页最大的可用性缺口，值得作为下一个迭代重点。

### P1 - 需要设计判断，工作量中等

4. **AMR 语音时长解析缺少单元测试**
   `processor.js` 里的 `readAmrDuration` 是手写的二进制帧头解析算法，`test/core.test.js` 中唯一出现 "amr" 字样的地方只是一个 mock fixture 的文件路径值（`{ elementType: 3, pttElement: { filePath: 'local.amr' } }`），并不是对解析算法本身的测试。`test/media-store.test.js` 也没有覆盖 `PttStore` 相关逻辑。建议补充针对不同帧头/边界情况（空文件、损坏文件、超短语音）的单元测试，避免未来改动这段解析逻辑时没有回归保障。

5. **不支持的消息类型（视频/文件/转发/卡片）**
   README 已经声明这是当前限制，不是 bug。如果要往前推进，需要先确认这几类消息在 QQNT 消息结构里的字段格式（工作量与复杂度可能各不相同，转发/卡片消息结构通常比图片/语音更复杂），建议先做视频或文件这两类相对结构简单的，再评估转发/卡片的可行性。

### P2 - 长期风险，非当前必须处理

6. **无运行时 QQ 版本自检**
   目前仅在 QQ `9.9.32-51246` 上验证过，代码里没有任何版本探测或警告逻辑。QQNT 更新后如果内部消息结构变化，插件可能静默失效或产生不可预期行为，用户无法第一时间知道原因。可以考虑在插件加载时读取当前 QQ 版本并与已验证版本做比对，不匹配时给出明显提示（而不是阻止运行，仅提醒有风险）。

## 4. 已排除的误判条目（供交接者参考，避免重复踩坑）

- ~~"单条记录删除不清理媒体文件"~~ —— **已证伪**。`main-plugin.js` 的 `deleteRecord` handler 中已经调用了 `mediaStore.sweep()` 和 `pttStore.sweep()`，删除单条记录时会正确清理孤儿媒体文件。
- ~~"存储路径修改失败完全没有提示"~~ —— **部分证伪**。`changeStorage` 的 `catch` 分支确实会把具体错误信息写进 UI（见上文第 2 条），不是完全无反馈，只是展示方式（覆盖路径文本）不太好。

## 5. 已在 1.4.2 完成的功能（避免重复实现）

- 管理页支持展开单条会话、逐条删除撤回记录。
- "拦截自己撤回的消息"开关（默认关闭），持久化到设置。
- 语音消息（AMR）拦截与保存（1.4.1 引入）。
