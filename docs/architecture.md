# 架构说明

## 数据流

1. 主进程包装 QQ `webContents.send`，只读取本地 Electron IPC 中的消息列表。
2. 支持的消息进入 10,000 条先进先出内存缓存；图片和表情候选先保留真实元素与路径，撤回时再判断本地文件是否有效，避免 QQ 文件晚于消息事件落盘时提前丢弃候选。
3. 收到撤回灰条时，以消息 ID 查找原消息；保留撤回包的序列、客户端序列和发送状态，并恢复原消息的 `msgAttrs`、`msgMeta`、`generalFlags` 特殊类型后发往渲染层。
4. 首次成功恢复时，按好友或群聊写入独立 JSON 文件；写入采用临时文件加原子重命名。
5. QQ 重启后，撤回灰条再次出现时，从本地记录恢复消息；图片缩略图路径映射会随记录序列化和恢复。

图片与图片表情恢复优先复用 `picElement` 已携带的本地 `sourcePath`、`filePath` 或 `thumbPath`；没有原图/文件落盘时可使用现存缩略图。已存在的原图若与消息 `fileSize` 不一致，按整组路径失真处理，不盲信同组缩略图。商城表情优先复用 `marketFaceElement` 的 `staticFacePath`、`dynamicFacePath`。当前会话中已显示、但文件未落盘或已失真的图片/表情可由渲染层从最多 500 条内存快照恢复，并标记为 `memoryOnly`，不写入跨重启记录。插件不调用网络接口，也不补下载缺失文件。

## 存储

默认数据目录为 `LiteLoaderQQNT/data/qq_local_recall/records`。设置页面可以选择新的本机绝对目录；插件会复制现有记录、原子保存路径配置，并在重启后继续使用新目录。旧目录不会自动删除。会话文件名是 `SHA-256(peerType:peerId).json`，文件内容包含 `schemaVersion: 1`、会话快照和撤回记录数组。

管理窗口通过独立的 `qqLocalRecallManager` Preload 桥接获得会话统计、存储目录读取/选择和固定删除接口，避免与 LiteLoader 注入到所有窗口的主 QQ Preload 发生名称冲突；它不能传入或读取任意文件路径。删除一个会话时删除对应 JSON 文件、持久化索引和内存候选消息。

## 渲染层

渲染层接收已恢复消息 ID、内容类型、操作者角色/名称、原发送者名称、`memoryOnly` 和已删除消息 ID。`operatorRole=0/1/2` 分别按普通成员、管理员、群主呈现；自行撤回显示“尝试撤回此信息/此图片”，管理员或群主撤回他人消息显示“尝试撤回 发送者 的信息/图片”。渲染层在消息仍可见时保存图片节点快照，`memoryOnly` 恢复时按消息 ID 回填；提示文案未变化时不写 `textContent`，避免触发 `MutationObserver` 循环。管理窗口启用 `contextIsolation`、`sandbox` 并禁用 `nodeIntegration`。
