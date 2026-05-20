# AMEFYS · 合规白皮书 / Compliance White Paper

> 最后更新：2026-05-20
> 适用版本：v0.3.2 及以上

本文档为 AMEFYS 项目的合规姿态总结，覆盖：

- 与 Valve / Dota 2 用户协议（SSA）的关系
- 用户数据处理 / 隐私政策
- 第三方服务清单
- 源码状态
- 验证方法（哪些承诺可以独立核实）

中英双语 / Bilingual：本文档以中文为主，重要条款附 English notes。

---

## 1. 项目政策摘要 / Project Policy Summary

AMEFYS 是一个面向 Dota 2 玩家的桌面端助手。设计原则：

1. **永久免费使用**，不卖会员、不卖广告、不卖用户数据
2. **本地优先**，所有数据默认仅存本机；云同步可选且对每类数据可独立开关
3. **零反作弊豁免**，仅使用 Valve 公开接口（GSI）和游戏内置机制（.cfg / alias / bind）
4. **应用源码当前未公开**；网站 / 安装包分发 / 快捷回复包内容采用 MIT 协议公开

> **In English**: AMEFYS is a desktop assistant for Dota 2 players. Free forever for users, local-first by default, uses only Valve's public GSI interface and the game's own keybind / cfg mechanisms. The application source code is currently not public; the website, distribution pipeline, and quick-reply pack content are MIT-licensed at <https://github.com/amefys/web>.

---

## 2. Valve / Dota 2 合规 / Valve Compliance

### 2.1 红线条款

下表对应 Dota 2 / Steam Subscriber Agreement 中关于"第三方软件"的禁止项，以及 AMEFYS 的实现选择：

| Valve 禁止项 | AMEFYS 实现 |
|---|---|
| 修改游戏文件 / 注入 DLL / dylib | ❌ 不做。唯一向 Steam 目录写入的是 GSI 配置文件（Valve 官方推荐位置）|
| 读取游戏进程内存 | ❌ 不做。全项目无 `ptrace` / `OpenProcess` / `ReadProcessMemory` 类调用 |
| 拦截 / 修改游戏网络流量 | ❌ 不做。无 `pcap` / 代理注入相关依赖 |
| 提供玩家敌方隐藏信息（雾内单位、技能 CD 等）| ❌ 不做。GSI 推送字段本身就是 Valve 过滤过的"玩家可见"子集；我们只透传不补全 |
| 自动化获得不公平竞争优势 | ❌ 不做。出装推荐 = 显示建议，不操作游戏；聊天发送 = 用户主动点击触发，与手动键入等价 |
| 通过 GSI（官方推送）读取对局状态 | ✅ 是。Dota 2 启动选项 `-gamestateintegration` + Valve 官方 .cfg 触发推送 |
| 通过游戏内置 keybind 发送消息 | ✅ 是。剪贴板 + 模拟 Enter 键，所有按键事件与玩家手动操作完全等价 |

> **English summary**: AMEFYS only uses Valve's public GSI interface to read match state, and the game's built-in keybind mechanism (clipboard paste + Enter key simulation) to send chat. We do not modify game files, read game memory, intercept game traffic, reveal hidden information, or automate gameplay-affecting actions.

### 2.2 灰区说明 · 自动化输入

聊天发送链路使用 `@jitsi/robotjs` 模拟键盘事件，技术上是"自动化输入"。

我们对此的立场：

1. 每条消息都需要用户**主动点击**快捷回复 chip 或按下发送按钮；没有任何"基于游戏状态自动触发"的逻辑
2. 模拟的按键序列（Enter → 粘贴 → Enter）与玩家在键盘上手动操作产生的 input event **完全等价**
3. 发送间隔默认 200ms，可配置范围 100ms–10s，体现"批量发送多条消息"的意图与玩家手动连续按键无本质区别
4. 不存在"以高于人类反应速度执行操作以获得优势"的场景

如果未来 Valve 政策对此类工具明确发声，我们会**立即调整或下线相关功能**。

> **English**: Our chat-send pipeline uses robotjs to simulate keyboard events, which is technically input automation. However: (a) every message is user-initiated via explicit chip-tap or send-button click — no game-state-triggered automation; (b) the simulated keypress sequence is identical to manual user input; (c) the 100ms–10s configurable interval mirrors batch typing by a human; (d) no behaviour exceeds human-achievable reaction speeds. If Valve's policy on such tools clarifies in the future, we will adjust or remove the affected feature immediately.

---

## 3. 数据处理 / Data Handling

### 3.1 默认收集的数据 · 仅本机存储

下列数据由 AMEFYS 在用户使用过程中自动捕获，**默认仅存本机** SQLite（`better-sqlite3`），不上传任何服务器：

| 数据类别 | 字段示例 | 存储位置 | 用途 |
|---|---|---|---|
| 对局状态 | 英雄、等级、GPM、装备、击杀 | 本地 SQLite | 出装推荐 + 复盘 |
| 聊天事件 | 队友 / 全频道发言原文 | 本地 SQLite + 翻译缓存 | 实时翻译 + 复盘回放 |
| 翻译结果 | 原文 → 译文映射 | 本地翻译缓存表 | 复用避免重复调用 |
| 用户偏好 | 主题 / 语言 / 快捷回复包 | electron-store JSON | 还原 UI 状态 |
| 应用日志 | 错误堆栈、IPC 调用记录 | pino-roll 滚动日志 | 故障诊断 |

### 3.2 用户可选上传的数据 · 云同步

仅当用户**显式登录**并**开启对应同步开关**时，下列数据通过 Supabase 上传到我们的云端：

| 数据类别 | 同步开关 | Supabase 表 | 是否端到端加密 |
|---|---|---|---|
| 用户偏好（主题 / 语言 / 快捷键）| 默认 ✅ | `user_settings` | ❌ 明文，行级安全（RLS）确保仅本人可读 |
| 自定义快捷回复包 | 默认 ✅ | `quick_replies` | ❌ 明文，RLS 保护 |
| 对局记录元数据（开始时间、英雄、胜负） | 默认 ❌ | `matches` | ❌ 明文，RLS 保护 |

**绝不上传**：聊天原文、翻译结果、应用日志、API key、本地缓存。

### 3.3 第三方 API Key

用户在设置中配置的第三方 API Key（Claude / OpenAI / DeepL / 火山 / 阿里 / Gemini）：

- 通过 `safeStorage.encryptString()` 加密后存入 OS 系统 keychain（macOS Keychain / Windows Credential Manager）
- **永不进入** 应用 SQLite、应用日志、Supabase、Sentry、任何文件
- 用户可随时在设置中查看 / 编辑 / 删除

### 3.4 数据保留 / 删除

- 本地 SQLite：用户随时可点设置 → 隐私 → 清除全部本地数据
- Supabase 云端：用户可点设置 → 账号 → 删除账号，触发服务端级联删除（RLS + cascade）
- 应用日志：默认 30 天滚动，超出自动删除（`pino-roll` 配置）

> **English**: All match data, chat history, translations, and logs are stored locally by default. Cloud sync (Supabase) is opt-in per-data-type and only covers settings, custom quick-reply packs, and (optionally) match metadata. Third-party API keys live in the OS keychain via `safeStorage` and never enter our app database, logs, or cloud. Users can wipe local data instantly and request account deletion which triggers RLS-cascade removal.

---

## 4. 第三方服务清单 / Third-party Services

| 服务 | 用途 | 何时调用 | 用户数据流向 |
|---|---|---|---|
| **Supabase**（自托管） | 用户认证 + 云同步 | 仅在用户登录且开启同步时 | 仅 §3.2 表中数据，RLS 保护 |
| **Sentry**（self-hosted DSN）| 错误堆栈收集 | 应用崩溃或捕获异常时 | 仅匿名错误事件 + 平台版本，无 PII；用户可在设置中关闭 |
| **OpenDota API** | 英雄 / 装备元数据、Meta 数据预生成 | 仅在 CI 数据预生成阶段，应用运行时不调用 | 不发送用户数据，仅请求公开统计 |
| **用户自选 LLM**（Claude/OpenAI/DeepL/火山/阿里/Gemini）| 翻译 + 复盘文本生成 | 仅在用户配置 API Key 且功能开启时 | 仅发送待翻译的聊天文本片段；不附带用户身份信息 |
| **GitHub Releases**（amefys/web）| 应用分发 + 演示视频托管 | 用户下载安装包 / 自动更新 | 不上传用户数据 |
| **Cloudflare**（amefys.com Worker）| `/dl/*` 反向代理 + 包下载统计 | 用户点 download 按钮时 | 仅匿名命中计数，无用户身份信息 |

---

## 5. 源码状态 / Source Code Status

**应用源代码（`amefys/amefys` 仓库）目前未公开**，处于商业开发阶段。我们保留未来根据产品发展和社区需要将其开源的可能性。

下列部分**已经公开**，采用 MIT 协议（`amefys/web` 仓库）：

- 站点全部源码（HTML / CSS / JS）
- Cloudflare Worker（`/dl/*` 反代 + `/p/*` 包统计）
- 8 个社区快捷回复包（`packs/*.amefys-replies.json`）
- 站点持续集成 workflow

> **English**: The application source code (`amefys/amefys` repository) is currently not public; it is under active commercial development. We reserve the option to open-source it in the future based on product direction and community demand. The publicly-released components (website, Cloudflare worker, quick-reply pack content) are MIT-licensed in the `amefys/web` repository.

---

## 6. 验证方法 / How to Verify

应用源码未公开的情况下，下列方式仍可由第三方独立验证本文档的合规承诺：

### 6.1 网络流量审查（无需源码）

使用 mitmproxy / Wireshark 等抓包工具拦截 AMEFYS 出站流量：

```bash
# 期望看到的连接：
#  - 127.0.0.1:4000     ← GSI 监听端口（仅本地）
#  - api.opendota.com   ← 仅 CI 数据生成时，应用运行时不连接
#  - *.supabase.co      ← 仅登录 + 同步时
#  - *.sentry.io        ← 仅错误事件
#  - 用户配置的 LLM 端点 ← 仅翻译时
#  - amefys.com         ← 仅下载 / 自动更新检查

# 不应看到：
#  - Steam / Dota 2 服务器
#  - 任何抓包工具能识别为 Dota 2 协议的流量
```

如发现与本文档不符的流量，请通过 §8 联系方式报告，我们承诺核实后公开说明。

### 6.2 GSI 数据范围核实（外部可查）

GSI 推送的所有字段由 Valve 控制并主动 filter。可对比 Valve 官方文档验证我们只申请了文档公开的字段：

- Valve 官方文档：https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/SDK/Game_State_Integration
- 社区维护：https://dota2.fandom.com/wiki/Game_State_Integration

GSI 推送的字段都标注为"玩家在客户端已可见的信息"，AMEFYS 不可能从这个接口获取雾内单位或敌方隐藏信息。

### 6.3 文件系统行为审查（无需源码）

可用 `fs_usage` (macOS) / Process Monitor (Windows) 监控 AMEFYS 的所有文件读写：

```bash
# macOS
sudo fs_usage -w -f filesys | grep -i amefys

# 期望看到的写入路径：
# - $HOME/Library/Application Support/AMEFYS/   ← 本地数据库 + 配置
# - /Library/Application Support/Steam/.../game/dota_addons/.../cfg/gamestate_integration_amefys.cfg
#   ← GSI 配置写入，Valve 官方推荐位置
# - $TMPDIR/                                     ← 临时文件
#
# 不应看到：
# - 任何 Steam 进程相关路径以外的 Steam 文件
# - Dota 2 客户端二进制或 resource 文件的读写
```

### 6.4 安装包签名 / 完整性

未来引入代码签名后，可通过：

```bash
# Windows
signtool verify /pa /v AMEFYS-Setup.exe

# macOS
codesign --verify --deep --verbose=2 /Applications/AMEFYS.app
spctl -a -t exec -vv /Applications/AMEFYS.app
```

验证安装包未被篡改且来源可信。

---

## 7. 待办 / Todo

- [ ] Windows 代码签名（SignPath OSS / Azure Trusted Signing 路径评估中）
- [ ] 设置端添加"导出我的全部数据"按钮，一键生成 JSON 包含本地 + 云端用户相关全部数据（GDPR 第 15 / 20 条响应）
- [ ] 设置端添加"撤回云同步授权"按钮，逐项数据类别撤回
- [ ] 第三方依赖年度 SBOM（待 v0.4.0）
- [ ] 引入自动化合规检查脚本（启动后自动写一份"今天我连接了哪些 IP / 写入了哪些文件"的报告，用户随时可查）

---

## 8. 变更记录 / Changelog

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-05-20 | 初版发布，覆盖 v0.3.2 |

---

## 9. 联系方式 / Contact

发现合规问题或有疑问：

- GitHub Issue: https://github.com/amefys/web/issues
- Email: amefys@gmail.com
- 微信: amefys（请备注「合规」）

我们承诺 **5 个工作日内**响应合规相关咨询。

---

*本文档采用 MIT 协议公开维护于 `amefys/web` 仓库，欢迎社区基于此文档提交 PR 修正条款。*
