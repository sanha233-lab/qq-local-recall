# QQ 本地防撤回 1.3.1 安装教程

## 适用版本

- Windows x64
- QQ `9.9.32-51246`
- 好友和群聊均支持

如果 QQ 是其他版本，安装脚本会停止并提示版本不匹配，不会强行修改 QQ。

## 功能范围

- 对方撤回文字、QQ 表情、回复及这些类型的混合消息时，保留原消息。
- 在对应消息正上方显示“对方尝试撤回一条消息”的 QQ 原生风格灰色提示。
- 好友和群聊分别保存撤回记录。
- 图片、语音、视频、文件和复杂卡片不恢复，保持 QQ 原撤回灰条。
- 默认不拦截自己撤回的消息。
- 所有记录只保存在本机，不上传服务器，不访问第三方服务。

## 安装前

1. 完全退出 QQ，包括任务栏托盘中的 QQ。
2. 将整个分发文件夹解压到一个有写入权限的位置，不要直接在 ZIP 压缩包内运行脚本。
3. 建议先运行 DryRun 检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1" -DryRun
```

## 安装

直接运行自动检测安装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1"
```

脚本会检查常见安装目录和 Windows QQ 卸载注册表，只接受版本为 `9.9.32-51246` 的目录，并校验该版本的官方 ASAR 入口。

如果检测到多个 QQ，或者你想强制指定目录，使用 `-QQInstallPath`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\install.ps1" `
  -QQInstallPath "C:\你的QQ目录"
```

脚本会：

- 检查 QQ 版本和运行时文件哈希；
- 安装官方 LiteLoaderQQNT 1.4.1 及兼容补丁；
- 添加插件加载入口；
- 保留原有本地撤回记录；
- 不替换 `QQ.exe`。

安装完成后启动 QQ，在设置列表中可以看到“QQ 本地防撤回”。

在“管理记录”窗口的“记录位置”区域可以查看当前保存目录，并选择新的本机磁盘目录。已有记录会复制到新目录，旧目录不会自动删除。

## 回滚

完全退出 QQ 后，在本文件夹运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ".\rollback.ps1"
```

回滚会恢复安装前的 QQ 加载配置、加载器和插件。默认不会删除本地撤回记录；`-RemoveData` 只删除默认 LiteLoader 数据目录，自定义记录目录需要按需手动处理。

## 常见问题

### 为什么图片没有恢复？

当前版本只恢复文字、QQ 表情和回复消息，不下载或补取图片等媒体内容。

### 群聊是否支持？

支持。好友和群聊的记录会分开保存，并可在记录管理页面整组删除。

### QQ 更新后怎么办？

新版本 QQ 不会自动修改。重新运行安装前先执行 `-DryRun`；如果版本不再是 `9.9.32-51246`，请不要强行安装，等待兼容检查。

### 记录保存在哪里？

`%USERPROFILE%\Documents\LiteLoaderQQNT\data\qq_local_recall\records`

记录属于当前 Windows 用户。给其他人安装时只需要分发包，不要复制自己的 `data\qq_local_recall` 目录。

## 校验文件

`SHA256SUMS.txt` 列出了本分发包内每个文件的 SHA-256。若校验不一致，请重新解压或重新获取分发包，不要继续安装。
