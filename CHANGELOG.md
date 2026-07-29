# Changelog

## [1.4.10] - 2026-07-29

### Fixed

- 图片防撤回：重新打开对话时，已保存且校验通过的撤回图片直接以 `transferStatus=4`（本地可用）重建；若原 `thumbPath` 中所有 QQ 缩略图均已失效，气泡缩略图回退到已验证的本地原图，有效缩略图保持不变。避免每次进入对话都先转圈约一分钟、等待 QQ 自身异步生成缩略图后才显示；实时预取和未落盘候选状态不变。
- 图片防撤回：聊天页面未打开时，最近收到且尚无本地文件的普通图片会通过 QQ 原生富媒体服务按消息 ID 与元素 ID 预取并绑定内存候选；不再尝试缺少 `rkey`、实机返回 HTTP 400 的相对下载地址。重复全量列表不会重复下载，撤回与预取并发时仍会完成正式持久化。

### Verification

- `npm test`: 170 tests passed.
- `npm run check`: passed.
- QQ `9.9.32-51246` 实机验证：目标聊天页面未打开时可以保存新图片；重新进入对话后已保存图片立即显示，不再等待异步刷新。

## [1.4.9] - 2026-07-28

### Fixed

- 图片防撤回：QQ 将原图片节点替换为“加载失败”后，不再覆盖插件已经保存的撤回前页面快照；当前会话内存候选保留临时媒体 URL 供有限回源重试，写入记录时仍会删除。带原图尺寸的 PNG 候选会拒绝 64×64 以内的加载占位，避免把 60×60、846 字节的 QQ 加载动画保存成撤回图片。

### Verification

- `npm test`: 157 tests passed.
- `npm run check`: passed.

## [1.4.8] - 2026-07-27

### Fixed

- 视频防撤回：未播放视频被对方撤回后，界面不再显示"0%"加载圈，改为正常显示缩略图预览。根因：QQNT 以 `transferStatus=0` 判定"未下载"并渲染进度圈；修复后对无本地视频体的恢复消息，将 `filePath` 指向已下载的缩略图文件、`transferStatus` 设为 `4`（本地可用），QQNT 渲染缩略图预览而非进度圈；无缩略图时退回清零行为。已播放视频恢复路径不受影响。

### Added

- 视频防撤回：撤回的视频消息现在会被保留。播放过（本机已下载）的视频保存完整本体到记录目录 `video/`（单个上限 200 MiB，MP4 魔数校验，SHA-256 去重），重启后仍可恢复；未播放的视频保留缩略图与时长、大小信息。撤回提示显示"尝试撤回此视频"；管理页记录列表显示"视频"类型与时长；删除记录、更换存储目录时同步清理/迁移视频文件。基于 QQ 9.9.32-51246 实机结构采集（elementType 5 / videoElement，`onRichMediaDownloadComplete` 视频路径）实现；持久化时剥离 `fileUuid` 等服务端标识，与既有隐私策略一致。

### Verification

- `npm test`: 154 tests passed.
- `npm run check`: passed.

## [1.4.7] - 2026-07-27

### Fixed

- 彻底移除"按发送者最近一条语音"的兜底恢复机制。实机诊断日志（968 次撤回恢复）显示：真实语音撤回 743 次全部经精确消息 ID 命中；而兜底机制 131 次候选命中中 130 次指向与被撤回消息不同的 ID——它几乎每次都在张冠李戴（撤回文件等不支持类型时，把发送者最近一条语音误显示/误存为撤回记录）。语音撤回现在与其他类型一致，仅按精确 ID 恢复，正常功能不受影响。

### Verification

- `npm test`: 149 tests passed.
- `npm run check`: passed.

## [1.4.6] - 2026-07-26

### Changed

- 渲染层 `MutationObserver` 回调改为按帧合并（`requestAnimationFrame`，无该 API 时降级为微任务）：QQ 一次 DOM 变更批次不再触发多次全量提示扫描与图片快照重克隆；批量撤回到达时对 `onRecovered` 载荷内全部消息 ID 只统一刷新一次，而不是逐条刷新。

### Added

- 管理页新增行为级测试（`test/manager-behavior.test.mjs`）：用真实 DOM/preload 桩件驱动 `manager.mjs` 实际运行，覆盖展开预览、单条/批量删除失败反馈、设置开关失败回滚、修改存储位置失败恢复等此前只靠源码正则做"冒烟"断言的路径，防止 1.4.2 那类接口未接通的问题被测试放过。

### Verification

- `npm test`: 149 tests passed.
- `npm run check`: passed.

## [1.4.5] - 2026-07-26

### Added

- 管理页记录内容预览：展开会话后每条记录显示文字片段（60 字内）、语音时长和图片缩略图；缩略图由主进程按已验证的 SHA-256 引用读取（上限 8 MiB），管理页 CSP 仅放开 `img-src data:`。
- QQ 版本自检提醒：读取 QQ `versions/config.json` 与已验证版本（9.9.32-51246）比对，不一致时主进程记录警告、管理页显示横幅，不阻止运行。

### Fixed

- 存储目录切换回曾用过的目录时按 `msgId` 合并两侧记录（当前会话优先），期间新增的记录不再静默丢失。
- 无法解析的记录文件加载时改名为 `.corrupt-<时间戳>` 备份保留，不再可能被同会话新记录覆盖；移除生产代码中的 `broken.json` 测试特判。
- 会话列表对单个记录文件 `stat` 失败降级为占用 0，不再拖垮整个列表。
- `settings.json` 存在但损坏时，`networkMediaRecovery` 回退为保守的关闭状态，不再静默重新开启网络回源（文件缺失时仍默认开启）。

### Verification

- `npm test`: 142 tests passed.
- `npm run check`: passed.

## [1.4.4] - 2026-07-26

### Fixed

- AMR 时长解析：DTX 静音帧（NO_DATA）不再截断计数，AMR-WB 与非 AMR 文件返回 0，语音时长不再显示错误值。
- 语音兜底恢复增加 msgTime 一致性校验：撤回不支持类型的消息时，不再把该发送者最近一条未被撤回的语音误存为撤回记录（此路径待一次实机验收：发语音后撤回、发语音再发文件后撤回文件）。
- 单条记录删除成功后向所有窗口广播 records-deleted，聊天窗口同步清理；管理页单条删除改为权威数据刷新，占用/时间列不再显示过期值。

### Changed

- 诊断日志 `ptt-debug.jsonl` 默认关闭，仅当记录目录存在 `ptt-debug.enabled` 标记文件时写入。
- 语音存储增加 20 MiB 上限与 AMR/SILK 魔数校验（与图片防线对齐）；语音下载索引增加容量上限，避免长期运行内存增长。
- 聊天窗口 preload 移除未使用的 `listConversations`/`deleteConversations` 暴露，收敛渲染进程攻击面。
- 管理页操作失败现在有可见错误提示（设置开关、修改存储位置、批量/单条删除），单条删除增加确认对话框。
- 单条删除 IPC 增加 `friend:`/`group:` 前缀校验，与 security-audit 文档口径一致。

### Maintenance

- `vendor/` 与 `delivery/` 不再入库，发布物统一由 GitHub Releases 承载；本地无交付物时 validate-package 跳过交付校验。
- 删除未被生产代码使用的 `createPreloadApi` 工厂，新增"渲染层调用面必须落在 preload 暴露面内"的对账测试，防止两份手写 preload 再次漂移。

### Verification

- `npm test`: 136 tests passed.
- `npm run check`: passed.

## [1.4.3] - 2026-07-26

### Fixed

- 修复 `manifest.json` 中文字段双重编码损坏（JSON 无法解析，源码无法打包/加载）；同步修复 `package.json` 的乱码 description。
- 管理页 preload 补齐 `listRecords`/`deleteRecord` 桥接，修复 1.4.2 "展开会话/逐条删除"点击即抛 TypeError 且按钮卡死的问题；同步修正 preload 契约测试的期望键列表。
- `MediaStore.sweep`/`copyReferencedTo` 改为过滤非图片引用（与 `PttStore` 对称），修复存在语音撤回记录时单条删除、批量删除、更改存储路径三条链路必现报错的问题。

### Security

- 停止跟踪含隐私信息的内部工作记录 `findings.md` 并加入 `.gitignore`；`docs/testing.md` 中的真实群成员昵称与本机盘符路径已脱敏。

### Verification

- `npm test`: 131 tests passed.
- `npm run check`: passed.

## [1.4.2] - 2026-07-26

### Added

- 管理页支持展开单条会话，逐条删除已保存的撤回记录。
- 新增"拦截自己撤回的消息"开关（默认关闭），可在管理页设置区持久化。

### Verification

- `npm test`: 129 tests passed.

## [1.4.1] - 2026-07-26

### Added

- 拦截并保存语音消息（amr 格式）。

### Verification

- `npm test`: 125 tests passed.

## [1.4.0] - 2026-07-26

### Added

- 默认开启受限 QQ 图片媒体回源；管理页可关闭，并持久化该设置。
- 复用当前 QQ 会话的 `event.sender.session.fetch` 请求图片，校验 HTTPS、主机、端口、`/download`、`appid/fileid/spec/rkey`、pending `fileUuid`、重定向、10 秒超时、20 MiB 上限和图片 magic bytes。
- 对加载完成的真实图片提供 Canvas PNG 兜底，并按原图比例校验静态 PNG。
- 有限重试和最终失败占位，避免加载动画永久转圈。

### Fixed

- 不再把 QQ 的 60 x 60 加载动画保存为历史图片。
- QQ 重建图片节点后重新应用已验证的本地媒体地址。
- 使用 QQ 可读取的 `appimg:` 地址显示当前会话刚保存的媒体。
- 新记录不再保存 `originImageUrl`、相对 `/download` 地址、`fileid` 查询参数或 `rkey`。
- 保留媒体序号稀疏位置，避免前序加载节点导致后续图片错位。

### Scope

- 本版本继续不处理语音、视频、文件、合并转发和复杂卡片。
- QQ 版本要求为 `9.9.32-51246`；升级 QQ 后需要先执行安装脚本的 `-DryRun` 检查。

### Verification

- `npm test`: 125 tests passed.
- `npm run check`: static audit, package validation and SHA-256 delivery checks passed.
- Final live sample: recalled image remained visible after the retry window; no permanent spinner or duplicate media file.
