# Changelog

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
