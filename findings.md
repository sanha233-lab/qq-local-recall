# Findings

- 本机当前 QQ 内核版本为 `9.9.32-50969`，Windows x64；启动器位于 `D:\QQ\QQ.exe`。
- 当前未检测到 LiteLoaderQQNT、QwQNT 或相关插件数据目录。
- `MeiYongAI/QQNT-Toolbox` v0.6.3 明确声明实机验证 QQ 9.9.32-50969，但为 AGPL-3.0 且包含大量无关功能和原生模块。
- `xh321/LiteLoaderQQNT-Anti-Recall` v0.3.0 为 MIT 专用插件，但依赖 `level-party`，图片恢复会访问第三方 RKey 服务，且公开兼容说明停留在较早 QQ 版本。
- QwQNT 已停止接收新用户，不能作为可获得的交付加载框架。
- 已审核的第三方 LiteLoader 安装器会替换 `QQ.exe`，且只声明测试 `9.9.30-48517`，不采用。
- LiteLoaderQQNT 1.4.1 在 QQ 9.9.32 的 Node 运行时中因读取已移除的 `Dirent.path` 而无法扫描插件；唯一兼容点为改用 `Dirent.parentPath ?? dirent.path`。
