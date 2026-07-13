# Installation and rollback

## Supported environment

- Windows x64
- QQ installation root: auto-detected; use `-QQInstallPath` to override
- QQ kernel: `9.9.32-50969`
- LiteLoader destination: `%USERPROFILE%\Documents\LiteLoaderQQNT`

## Install

完全退出所有 QQ 进程，然后在交付目录运行。脚本会自动检查常见 QQ 目录和 Windows 卸载注册表，只接受版本为 `9.9.32-50969` 的候选目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

如果检测到多个兼容目录，脚本会列出候选并停止；此时手动指定：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -QQInstallPath "C:\你的QQ目录"
```

脚本将执行以下固定动作：

1. 校验 QQ 当前版本和两个官方运行时文件的 SHA-256。
2. 在交付目录 `backup` 下备份 `package.json`、已有加载入口、已有 `dbghelp.dll` 和已有插件。
3. 安装 LiteLoaderQQNT 1.4.1 与 `qq_local_recall` 插件。
4. 对 LiteLoader 1.4.1 应用一行 Node 新版兼容修正：优先读取 `Dirent.parentPath`，旧运行时回退到 `Dirent.path`。
5. 将当前版本的 `package.json` 主入口改为本地 LiteLoader 启动入口。
6. 将官方 QQNTFileVerifyPatch 的 x64 加载桥接复制为 `$QQInstallPath\dbghelp.dll`。

脚本不会替换 `QQ.exe`，也不会启动或登录 QQ。

## Dry run

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
```

## Rollback

完全退出 QQ 后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\rollback.ps1
```

默认恢复最近一次备份，移除本插件，但保留撤回数据和 LiteLoader 文件。需要一并删除本插件数据时添加 `-RemoveData`；需要删除本次新建的 LiteLoader 目录时添加 `-RemoveLoader`。
