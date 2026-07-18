# Findings

- 本机当前 QQ 内核版本为 `9.9.32-50969`，Windows x64；启动器位于 `D:\QQ\QQ.exe`。
- 当前未检测到 LiteLoaderQQNT、QwQNT 或相关插件数据目录。
- `MeiYongAI/QQNT-Toolbox` v0.6.3 明确声明实机验证 QQ 9.9.32-50969，但为 AGPL-3.0 且包含大量无关功能和原生模块。
- `xh321/LiteLoaderQQNT-Anti-Recall` v0.3.0 为 MIT 专用插件，但依赖 `level-party`，图片恢复会访问第三方 RKey 服务，且公开兼容说明停留在较早 QQ 版本。
- QwQNT 已停止接收新用户，不能作为可获得的交付加载框架。
- 已审核的第三方 LiteLoader 安装器会替换 `QQ.exe`，且只声明测试 `9.9.30-48517`，不采用。
- LiteLoaderQQNT 1.4.1 在 QQ 9.9.32 的 Node 运行时中因读取已移除的 `Dirent.path` 而无法扫描插件；唯一兼容点为改用 `Dirent.parentPath ?? dirent.path`。

## QQ 9.9.32-51246 compatibility findings
- `package.json` 官方入口为 `./application.asar/app_launcher/index.js`；ASAR 内 `app_launcher` 仅含 `adm-zip.js`、`index.js`、`launcher.js`，三个 80 字节条目的内置 SHA-256 均验证一致。
- `application.asar` SHA-256 为 `65338430A607D4F936CF2A4B497BE5DEC22DCAB1ED9845F2F4E513BBD7421A62`。
- LiteLoaderQQNT 1.4.1 已固定转发到上述官方入口，因此兼容改动只需切换版本门禁并增加 ASAR/入口校验，无需修改 ASAR 或 QQ.exe。
- 实机安装后 QQ 正常启动，设置页识别 LiteLoaderQQNT 与 `qq_local_recall` 1.3.1；原撤回数据保留。
## 1.3.2 group recall rendering findings
- 2026-07-18 14:18 的群记录已保存被撤回正文“不如兔子”，PC 页面同时显示插件撤回提示，证明识别、缓存、持久化和提示链均已执行；故障位于恢复对象的群渲染字段。
- 现有清洗器保留的是旧字段 `senderMemberName`，QQ 51246 原始群消息使用 `sendNickName`、`sendMemberName`、`sourceType`、`isOnlineMsg`，元素还带 `elementId` 与 `extBufForUI`。
- 1.3.2 只补齐上述字段，不改变撤回识别、自撤回放行或媒体过滤边界。
## 1.3.3 local picture findings
- QQ 51246 `picElement` 的本地语义由 `sourcePath`、`filePath` 和 `thumbPath` 承载；本机已确认 `nt_data\Pic\2026-07\Ori` 与 `Thumb` 存在同批落盘图片和多档缩略图。
- 图片恢复仅需保留原消息的 `picElement`、`elementId`、`extBufForUI` 和缩略图路径映射；所有本地候选路径缺失时跳过该图片即可，无需增加网络访问。
## 1.3.4 group text transport findings
- 15:02 实机记录证明群文字和图片均已进入识别与持久化链；图片渲染成功而文字为空，差异位于 QQ 文字渲染依赖的撤回传输状态和特殊类型对象。
- QQ 51246 原始群文字包含 `msgMeta`、`generalFlags`（`Uint8Array`）、`msgAttrs`（`Map`）以及 `clientSeq` 等字段；恢复时需以撤回包为对象骨架，再覆盖原消息内容，并保留撤回包序列与状态字段。

## 1.3.5 operator and message-matrix investigation
- `G:\QQ\records` 当前确有 25 个记录文件；只读汇总中已保存元素为文字 `elementType=1`、普通图片 `2`、原生小表情 `6`、回复 `7`。现有清洗器会丢弃未知元素，因此这些历史记录不足以证明商城/动画表情的实际元素结构，仍需 QQ 51246 IPC 证据。
- 历史记录中 `qqLocalRecall.operatorName` 已能保存 `revokeElement` 的操作者显示名，但旧实现没有保留操作者 UID、被撤回消息发送者 UID 或角色字段，不能仅凭显示名可靠判定管理员操作。
- QQ 本机资源目录已确认存在 `D:\QQ\Tencent Files\1551669549\nt_qq\nt_data\Emoji\marketface`、按月 `Emoji\emoji-recv\YYYY-MM\Ori|Thumb`、`Emoji\personal_emoji\Ori|Thumb`；表情恢复应只接受这些消息元素实际引用的现存本地路径，不补下载。
- QQ 51246 实机 IPC 已确认撤回字段为 `operatorRole`、`operatorUid`、`operatorNick/operatorRemark/operatorMemRemark`、`origMsgSenderUid`、`origMsgSenderNick/origMsgSenderRemark/origMsgSenderMemRemark`。普通成员自行撤回样本为角色 `0` 且操作者 UID 等于原发送者 UID；管理员样本 `Q群管家` 为角色 `1` 且两个 UID 不同；群主样本 `see` 为角色 `2` 且两个 UID 不同，QQ 原生列表同时明确显示“群主 see 撤回了你的一条消息”。
- QQ 51246 商城/动画表情为 `elementType=11` + `marketFaceElement`，本机资源字段是 `staticFacePath` 与 `dynamicFacePath`；实机同时存在路径已落盘和两条路径均缺失的样本，适合直接验证“有任一本地资源则保留、全部缺失则跳过”。
- 图片表情仍为 `elementType=2` + `picElement`，实机主要以 `picSubType=1`、`summary='[动画表情]'`、`picType=2000` 表示，并引用 `Emoji\emoji-recv\YYYY-MM\Ori|Thumb`；普通图片主要为 `picSubType=0`，另有 GIF 图片样本 `picSubType=11`。现有本地图片路径门禁可复用，但需补明确矩阵测试。
- 51246 同一元素对象包含大量值为 `null` 的其他元素槽，真实有效载荷仍由 `elementType` 决定。当前矩阵保持语音 `3`、视频 `5`、文件、卡片/转发等不支持，不扩大到远端或复杂媒体渲染。

## 1.3.6 expression rendering investigation
- 20:36 实机样本 `7663815090537781667` 为 `elementType=2`、`picSubType=1` 动画表情；收到和撤回时 `sourcePath` 与全部 `thumbPath` 均不存在，证明候选不能在首次收到时按文件存在性提前丢弃。
- 20:55 实机样本 `7663850754641619068` 被 QQ 编码为 `elementType=2`、`picSubType=0`，说明用户语义上的图片型表情不只使用 `picSubType=1`。其 `sourcePath` 虽存在，但实际长度 `311059` 与消息 `fileSize=262637` 不符，且文件 MD5 与 `md5HexStr` 不同；QQ 恢复对象后正文仍为空，证明同名旧文件不能视为有效资源。
- 21:42 实机样本 `7663862948448229539` 为 `picSubType=1`；核心输出 `memoryOnly=true`，渲染层从撤回前 DOM 快照回填后用户确认表情保留。插件没有增加网络或下载代码，内存快照不持久化。
- 撤回他人消息使用“管理员/群主 名称 尝试撤回 发送者 的信息/图片”；“的此信息/的此图片”已删除。自行撤回继续使用“尝试撤回此信息/此图片”。
- 混合消息需按“是否有媒体被本地门禁过滤”设置 `memoryOnly`，不能按整条消息是否仍有可持久化文字判断；操作者与发送者关系优先比较 `operatorUid`、`senderUid`，仅在 UID 缺失时回退名称比较。

## 1.3.7 conversation reopen investigation
- 首次撤回恢复后表情短暂显示、切换会话约 5 秒后消失的根因不在 DOM 定时器：`memoryOnly` 原消息候选在首次恢复末尾被无条件删除，再次打开会话时 QQ 重新发送撤回提示，核心已没有原表情可用于替换。
- 同一处理器内连续处理首次撤回和重新加载的撤回列表可稳定复现：修复前第二次 `recoveredIds=[]`；仅对 `memoryOnly` 恢复保留有界候选后，第二次仍恢复原图片元素。
- 自检确认混合文字与缺失媒体在首次恢复后已有文字记录，二次加载若优先读取记录会只剩文字；当前会话需优先使用仍存在的完整候选，同时继续以门禁后的文字版本作为持久化边界。
- 自检发现删除记录回调调用 `findMessageContent` 时漏传 `document`，会在当前页面更新删除状态时抛错；补齐参数并加入渲染回归检查。
