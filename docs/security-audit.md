# 安全与依赖审计

## Candidate review

| Candidate | Result |
|---|---|
| LiteLoaderQQNT-Anti-Recall 0.3.0 | MIT、范围集中；移除其 LevelDB 依赖、媒体下载和第三方 RKey 服务后作为功能基线。 |
| QQNT Toolbox 0.6.3 | 明确验证 QQ 9.9.32，但范围过大且为 AGPL；只参考公开兼容说明，不复制源码。 |
| lite-tools 4.0.1 | 活跃但包含大量无关功能和依赖，不作为最终基线。 |
| QwQNT | 停止接收新用户，无法形成可获得交付。 |

## Plugin audit boundary

- `package.json` 没有 `dependencies` 或 `devDependencies`。
- 只有 `src/core/qq-media-fetch.js` 可以调用注入的 `fetch`；其他 `src/` 继续禁止网络 API、HTTP/HTTPS/TCP/UDP 模块、子进程、`eval`、动态函数和原生 `.node/.dll` 引用。
- 媒体请求只复用当前 QQ IPC 发送方的登录会话，不使用全局或 Node 请求；初始地址限定 HTTPS、443、`multimedia.nt.qq.com.cn`/`gchat.qpic.cn`、精确 `/download`、数字 `appid/spec`、非空 `rkey` 和匹配待处理元素的 `fileid`。
- 最多跟随 2 次到 `.qq.com`、`.qpic.cn`、`.gtimg.cn` 的 HTTPS 重定向；单次 10 秒、响应 20 MiB，并按 GIF/PNG/JPEG/WebP magic bytes 验证。
- 完整临时 URL、`fileid` 和 `rkey` 只存在于当前内存请求生命周期，不写入 JSON、媒体引用、日志或 IPC 返回值。
- 诊断日志默认关闭：仅当记录目录存在 `ptt-debug.enabled` 标记文件时才写入本机 `ptt-debug.jsonl`（语音链路排查用），正式使用无需开启。
- 数据文件名由 SHA-256 生成，删除 API 只接受 `friend:` 或 `group:` 开头的会话键；存储路径只能通过主进程原生文件夹选择器修改。
- 损坏的数据文件不会自动删除，只记录诊断并跳过。

## Loader assets

| Asset | SHA-256 | Signature |
|---|---|---|
| LiteLoaderQQNT-1.4.1.zip | `3B2D9B7214BDFEF16D5007B1F277A9F70688785BA11FC03EF091AA8214CDC343` | ZIP，无 Authenticode |
| dbghelp_x64-1.1.2.dll | `4BB8CD08D7E96BD085FA2AFA46D7B36E3F312A6C4D633363411EF763449D700F` | 未签名 |

两个文件均从对应官方 GitHub Release URL 下载。`dbghelp_x64.dll` 是加载桥接，不属于插件；安装前脚本必须核对上述哈希。安装方案不会替换 `D:\QQ\QQ.exe`。

LiteLoader 1.4.1 的插件目录扫描仍使用旧 Node `Dirent.path`。QQ 9.9.32 的运行时已经改用 `Dirent.parentPath`，因此安装脚本对解压后的 `src/main/store.js` 应用一行兼容修正：`dirent.parentPath ?? dirent.path`。修正不改变插件权限、网络行为或 QQ 文件。
