# Changelog

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
