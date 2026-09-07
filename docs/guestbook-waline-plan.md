# 官网留言板落地方案 — Waline on Cloudflare Workers + D1

> 2026-09-07 · 基于用户草案整理，所有事实项已对照源码 / 线上 API 核实。
> 目标：amefys.com 增加一个「留言板」页面，玩家不注册即可留言，管理员审核后公开；全部跑在 Cloudflare 边缘，无需 ICP 备案。

---

## 0. 结论先行

| 项 | 决定 |
|---|---|
| 后端 | Fork [`lsy-404/Waline_On_Worker`](https://github.com/lsy-404/Waline_On_Worker) **main（afce3d5）**——比 v1.1.0 标签多了完整测试套件和 markdown XSS 修复，所以不用标签；fork 放 `amefys/waline-worker`，分支 `amefys`；部署为 Worker `waline`，自定义域 `waline.amefys.com` |
| 存储 | Cloudflare D1 `waline-db`（免费额度 5 GB / 500 万读 / 10 万写每天，留言板量级远够） |
| 前端 | `@waline/client` 3.15.2（MIT），**自托管**到 `assets/vendor/waline/`，不走 unpkg / jsdelivr |
| 页面 | 新增 `guestbook.html` + `en/guestbook.html`，导航加「留言板」；**昵称、邮箱均为必填**（2026-09-07 拍板） |
| 审核 | 全量先审后发（`AUDIT=1` + 面板 `comment_default_status=waiting` 双保险） |
| 反机器人 | Cloudflare Turnstile（前端已支持，**服务端需在 fork 里补校验**）+ WAF 速率限制规则 |
| 通知 | 第一阶段不做邮件；第二阶段用 Resend HTTP API（项目已在用）在 fork 里实现管理员通知 + 回复通知 |
| 不做 | R2 图片上传、社交登录、GIF 搜索、浏览量统计 |

草案里有 7 处与实际不符，见 §1，照草案直接部署会踩坑。

---

## 1. 草案核对结果（必读）

| # | 草案写法 | 实际情况（源码核实 2026-09-07） | 处理 |
|---|---|---|---|
| 1 | 仓库 `wuyilingwei/Waline_On_Worker` | 已迁移为 `lsy-404/Waline_On_Worker`，GitHub 返回 301。v1.1.0，GPL-3.0，15 star / 10 fork，最近提交 2026-09-05。README 明示**代码主要由 AI 生成，生产前自行评估** | 用新地址；fork 到自己账号锁版本 |
| 2 | `ALLOWED_ORIGINS = "https://…"` | 变量名是 **`SECURE_DOMAINS`**。上游注释说「不带协议」，但代码拿完整的 `Origin` 头做 `===` 比较，**不带协议反而全部拒绝**（2026-09-07 实测）；`endsWith('.'+d)` 分支只对子域生效 | `SECURE_DOMAINS = "https://amefys.com,https://www.amefys.com"` |
| 3 | `COMMENT_AUDIT = "true"` | 变量名是 **`AUDIT`**（非空即开）；且面板设置 `comment_default_status` 优先级更高，面板若改成 approved 会覆盖环境变量 | 两处都设 waiting |
| 4 | `IPQPS = "60"` | 类型里声明了，**代码里没有任何地方读取**，README 自己说「可直接配置 Cloudflare 安全规则实现」 | 用 WAF 速率限制规则代替（§4.3） |
| 5 | `AKISMET_KEY = "false"` | 不设即关；写 "false" 会被当成密钥去请求 Akismet | 直接省略 |
| 6 | 创建 R2 存图片 | Worker 端**没有任何上传接口**；Waline 的图片上传是前端 `imageUploader` 钩子，默认把图片 base64 塞进正文 | 不建 R2；前端 `imageUploader: false` |
| 7 | 后台配 Turnstile 即生效 | 前端 3.15.2 支持 `turnstileKey` 并会把 `turnstile` 字段 POST 上来；**服务端 `comment.ts` 完全没有校验**，`TURNSTILE_SECRET` 只是类型声明 | fork 补 siteverify（§3.1），否则等于没开 |
| 8 | 邮件不行就走 Webhook | 功能列表里 SMTP 和 Webhook **都是未实现** | 第二阶段用 Resend HTTP API 自己实现（§3.4） |
| 9 | 草案未提 | **`JWT_SECRET` 是必需 secret**，不设登录 token 无法签发 | `wrangler secret put JWT_SECRET` |
| 10 | 草案未提 | 头像用 `gravatar.com`，国内基本打不开 | fork 改 `cravatar.cn`（§3.2） |
| 11 | 草案未提 | 前端默认表情包、后台面板都从 `unpkg.com` 加载，国内慢 | 前端自托管；后台仅维护者用，可忍 |
| 12 | 草案未提 | Worker 根路径 `/` 会渲染一个从 unpkg 拉资源的演示评论页 | fork 改为 302 到 `amefys.com/guestbook.html` |

已核实**没有问题**的点：公开接口返回的评论已去掉 `mail` / `ip`（只在管理员态返回）；第一个注册用户自动成为管理员；JWT 有效期 30 天；支持 TOTP 二步验证；正文上限 64 KB，昵称 / 邮箱 / 链接 255 字符；Markdown 有 XSS 过滤。

---

## 2. 架构

```
玩家浏览器
  │  amefys.com/guestbook.html（GitHub Pages，经 Cloudflare 代理）
  │    ├─ /assets/vendor/waline/waline.js + .css（自托管，94 KB gz）
  │    └─ challenges.cloudflare.com/turnstile（人机验证脚本）
  ▼
waline.amefys.com  ──►  Worker `waline`（Hono，fork 版）
  │   CORS 白名单 amefys.com · Turnstile 校验 · 审核状态 · 反垃圾
  ├─► D1 `waline-db`（wl_Comment / wl_Users / wl_Counter / wl_Settings）
  └─► （P3）Resend API 发通知邮件
管理员：waline.amefys.com/ui（@waline/admin 0.34.2）审核 / 删除 / 导出
```

现有设施可复用：
- 域 `amefys.com` 已在 Cloudflare（Free 计划），Workers 自定义域一键绑定。
- `amefys/.env` 里的 `CLOUDFLARE_API_TOKEN` 已验证可读 Workers / D1 / Turnstile / Zone，wrangler 直接读该环境变量，**不需要 `wrangler login`**。**实测 `wrangler d1 create` 返回 Authentication error 10000**：token 缺 `Account · D1 · Edit`。要补的权限：`D1:Edit`、`Workers Scripts:Edit`（部署）、`Turnstile:Edit`（建 widget）、`Zone · Workers Routes:Edit` + `Zone · DNS:Edit`（自定义域）、`Zone · Firewall Services:Edit`（WAF 限速规则）。不想放大 token 的话，Turnstile / 自定义域 / WAF 三项也可以在控制台手动点。
- 现有 worker 部署惯例（`worker/README.md`）：脚本 + API token，不进 CI。本方案同样不进 CI，用 wrangler。

**备选方案为什么不选**：Giscus / utterances 要 GitHub 登录，国内玩家门槛高；Twikoo 走腾讯云函数需备案，Vercel 版国内不通；官方 Waline 依赖 Vercel + LeanCloud，Vercel 国内不稳、LeanCloud 国内版要备案；Artalk 需要自己养服务器。Worker + D1 是唯一「免备案、国内可达、零服务器」的组合。

---

## 3. Fork 需要改的 5 处代码

fork 到 `amefys/waline-worker`（GPL 对「自己部署服务」没有义务），在上游 main（afce3d5）上打 `amefys` 分支。改动都很小，方便以后 rebase 上游。**状态（2026-09-07）：本地已完成并通过 142 个测试（上游 132 + fork 10），提交 `6307871`，等 GitHub 仓库建好后推送。** 说明见 fork 里的 `FORK.md`。

### 3.1 Turnstile 服务端校验（必做，约 40 行）
`src/router/comment.ts` POST 开头，非管理员请求时：
```ts
if (c.env.TURNSTILE_SECRET && !userInfo?.type?.includes('administrator')) {
  const token = body.turnstile
  if (!token) return c.json({ errno: 1, errmsg: 'captcha required' }, 400)
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: c.env.TURNSTILE_SECRET, response: token, remoteip: ip })
  }).then(r => r.json<{ success: boolean }>())
  if (!r.success) return c.json({ errno: 1, errmsg: 'captcha failed' }, 403)
}
```
`TURNSTILE_SECRET` 用 `wrangler secret put`；站点密钥放前端 `turnstileKey`。测试在 `tests/integration/fork.test.ts`：直接调用 Hono `app.request()` 并覆盖 env，用 `vi.stubGlobal('fetch')` 模拟 siteverify（当前版本的 vitest-pool-workers 已不导出 `fetchMock`）。

### 3.2 头像换国内可达源（必做，1 行）
`src/utils/avatar.ts`：`https://gravatar.com/avatar/` → `https://cravatar.cn/avatar/`（Cravatar 是 Gravatar 国内镜像，同 md5 协议，未注册邮箱回退默认头像）。

### 3.3 根路径与注册口收口（建议，约 15 行）
- `app.get('/')` 改为 `c.redirect('https://amefys.com/guestbook.html', 302)`。
- `POST /api/user`：当 `wl_Users` 已有管理员且未设置 `ALLOW_REGISTER=1` 时返回 403。留言板不需要玩家注册，关掉可避免有人抢注、也少一个攻击面。

### 3.4 Resend 邮件通知（P3，约 80 行）
在评论写入成功后用 `c.executionCtx.waitUntil()` 异步调用 `https://api.resend.com/emails`：
- 新留言 → 发给管理员邮箱（含审核链接 `…/ui`）。
- 管理员在后台回复（`pid` 指向的父评论有 `mail`）→ 发给留言者「你的留言有回复」。
Secret：`RESEND_API_KEY`；发件域用现有 Resend 里已验证的域。**只做这两条**，不做每条评论都通知，避免打扰。

### 3.5 面板 CDN 版本钉死（1 处配置）
部署后进 `/ui/worker-setting`，`waline_admin_version` 填 `0.34.2`、`waline_client_version` 填 `3.15.2`，避免 `latest` 漂移。

---

## 4. 实施步骤

> **进度 2026-09-07**：P0 全部完成——fork 已推 `amefys/waline-worker`（默认部署分支 `amefys`），D1 `waline-db` 已建表，Worker `waline` 已部署并绑定 `waline.amefys.com`（302 / 列表 / CORS / 审核 waiting 均已冒烟验证），`JWT_SECRET` 已写入，`wl_Settings` 已种入审核默认值与版本钉子。**待用户**：注册管理员；Turnstile widget（token 无 Turnstile 写权限）；WAF 规则恢复见 §4.2。

### 4.1 P0 · 后端上线（约半天）

```bash
# 0. fork 后克隆（用 amefys-ai 的 SSH 别名）
git clone git@github.com-amefys-ai:amefys/waline-worker.git && cd waline-worker
pnpm install

# 1. 用现有 token，不要 wrangler login
export CLOUDFLARE_API_TOKEN=…   # 取自 amefys/.env
export CLOUDFLARE_ACCOUNT_ID=…

# 2. D1
npx wrangler d1 create waline-db          # 记下 database_id
cp wrangler.toml.example wrangler.toml     # 填 database_id，见下
npx wrangler d1 execute waline-db --remote --file=./schema.sql

# 3. Secrets
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET
npx wrangler secret put TURNSTILE_SECRET   # §4.2 创建 widget 后填

# 4. 部署
npx wrangler deploy
```

`wrangler.toml`：
```toml
name = "waline"
main = "src/index.ts"
compatibility_date = "2026-09-07"

[vars]
SITE_NAME = "AMEFYS"
SITE_URL = "https://amefys.com"
SECURE_DOMAINS = "https://amefys.com,https://www.amefys.com"  # 必须带协议，见 §1 第 2 条
AUDIT = "1"                        # 全量先审后发
# 不写 AKISMET_KEY / IPQPS / SMTP_*

[[d1_databases]]
binding = "DB"                     # 名字不能改
database_name = "waline-db"
database_id = "<上一步输出>"
```

绑定域名：Dashboard → Workers & Pages → `waline` → Settings → Domains & Routes → Add custom domain → `waline.amefys.com`。DNS 和证书自动生成，几分钟生效。

**马上做**（先于任何公开）：打开 `https://waline.amefys.com/ui/register` 注册管理员（首个用户即管理员），登录后在个人页开 **2FA**；进 `/ui/worker-setting` 把 `comment_default_status` 与 `user_comment_default_status` 都设为 `waiting`，钉死两个版本号（§3.5）。之后按 §3.3 部署关闭注册。

验收：`curl -sI https://waline.amefys.com/api/comment?path=/guestbook` 返回 200 且带 `x-waline-version: 1.1.0`；`/ui` 能登录；用 `SECURE_DOMAINS` 之外的 Origin 发 OPTIONS 预检不返回 `Access-Control-Allow-Origin`。

### 4.2 P1 · 反滥用（约 2 小时）

1. **Turnstile**：Dashboard → Turnstile → Add widget，域名 `amefys.com`，模式 Managed。站点密钥进前端，Secret 进 `wrangler secret put TURNSTILE_SECRET`，部署 §3.1 的 fork 改动。
2. **WAF 速率限制**（Free 计划含 1 条，**账号里已有一条保护 `cdn.amefys.com/skins/index.json` 的规则**，只能合并成一条 OR 表达式，阈值沿用 10 次 / 10 秒 / IP）：Security → WAF → Rate limiting rules：
   - 表达式：`(http.host eq "waline.amefys.com" and http.request.uri.path eq "/api/comment" and http.request.method eq "POST")`
   - 同一 IP 10 秒内超过 3 次 → Block 10 秒（Free 只有 10 秒窗口，够挡脚本）。
3. **Bot Fight Mode** 对 `waline.amefys.com` 开启（Security → Bots）。
4. 面板反垃圾模式先设 **关**；若上线后出现垫底垃圾再评估 Akismet（个人站免费 key）或 LLM 模式（可接现有火山 / Azure 端点）。

### 4.3 P2 · 官网页面（约半天）

1. **自托管客户端**：
   ```bash
   mkdir -p assets/vendor/waline
   curl -sL https://cdn.jsdelivr.net/npm/@waline/client@3.15.2/dist/waline.js  -o assets/vendor/waline/waline.js
   curl -sL https://cdn.jsdelivr.net/npm/@waline/client@3.15.2/dist/waline.css -o assets/vendor/waline/waline.css
   ```
   在 `licenses.html` 加 `@waline/client` (MIT) 条目；`credits.html` 加一句「留言板由 Waline 驱动」。
2. **`guestbook.html`**（沿用 changelog.html 的 nav / footer / 主题变量）：
   ```html
   <div id="waline"></div>
   <link rel="stylesheet" href="/assets/vendor/waline/waline.css">
   <script type="module">
     import { init } from '/assets/vendor/waline/waline.js'
     init({
       el: '#waline',
       serverURL: 'https://waline.amefys.com',
       path: '/guestbook',              // 固定，中英文页共用一条线程
       lang: 'zh-CN',
       login: 'disable',                // 不做账号体系，也就不依赖第三方 OAuth 代理
       meta: ['nick', 'mail'],
       requiredMeta: ['nick', 'mail'],  // 都必填；邮箱只用于收回复通知，不公开
       wordLimit: [0, 500],
       pageSize: 20,
       imageUploader: false,
       search: false,                   // 关掉 Giphy
       pageview: false,
       reaction: false,
       emoji: false,                    // 默认表情包走 unpkg；P3 若要再自托管一套
       turnstileKey: '<Turnstile 站点密钥>',
       placeholder: '欢迎留言：功能建议、bug 反馈、想加的英雄语音都可以。留言需审核后显示；邮箱选填，仅用于回复通知，不会公开。',
       dark: 'auto'
     })
   </script>
   ```
   Waline 的 CSS 变量（`--waline-theme-color`、`--waline-bgcolor` 等）映射到站点 token（金色主题 `var(--gold)`），保证与全站一致。
3. **英文页** `en/guestbook.html`：同上 `lang: 'en-US'`，`path` 相同。
4. **导航**：7 个手写中文页 + 2 个英文页 + `_generator/build.mjs` 的 `nav()` 加「留言板 / Guestbook」，重新生成英雄 / 装备页；`sitemap.xml` 加两条。
5. **合规文案**：
   - `privacy.html` 第三方表加一行：`Cloudflare Workers / D1｜留言板：昵称、留言内容、可选邮箱、IP、浏览器 UA｜cloudflare.com/privacy`；「你的权利」加「留言可联系我们删除」。
   - `compliance.html` 加「留言板为互动内容，全部人工审核后展示」。
   - `guestbook.html` 表单上方一句：「提交即同意《隐私政策》；禁止广告、外挂、账号交易等内容」。
6. **上线**：push main → Pages 部署 → `pages.yml` 已自动清 CF 缓存；`changelog.html` 补一条「官网新增留言板」。

### 4.4 P3 · 可选增强

- Resend 通知（§3.4）。
- **备份**：在 fork 仓库加 GitHub Actions 每周 `npx wrangler d1 export waline-db --remote --output=backup.sql` 存为 artifact（保留 90 天），token 用仓库 secret。
- **运维面板**：`scripts/ops-dashboard` 加一张卡，用 D1 REST API `POST /accounts/{id}/d1/database/{uuid}/query` 跑 `SELECT status, COUNT(*) FROM wl_Comment GROUP BY status`，显示待审数并在 >0 时给告警；现有 token 已能读 D1。
- 每个版本的更新日志条目下挂评论：`path: '/changelog/0.23.2'`，复用同一 Worker。

---

## 5. 安全与合规清单

- [ ] `SECURE_DOMAINS` 只含 `amefys.com`，不用 `*`。
- [ ] `JWT_SECRET`、`TURNSTILE_SECRET`（P3：`RESEND_API_KEY`）全部走 `wrangler secret`，不进 `wrangler.toml`、不进 git。
- [ ] 管理员先于公开注册完成并开 2FA；随后关闭注册（§3.3）。
- [ ] `AUDIT=1` 且面板两项默认状态为 `waiting`；所有留言人工审核后可见。
- [ ] 隐私政策已列出 D1 中保存的字段与用途；提供删除渠道（现有 about 页邮箱）。
- [ ] 公开接口不泄露邮箱 / IP（已核实 `formatComment` 仅管理员态附带）。
- [ ] Turnstile 服务端校验有测试覆盖；WAF 速率规则生效（用 `curl` 连发 5 次验证第 4 次起 429）。
- [ ] 前端资源全部同源，页面在无法访问 unpkg / gravatar 的网络下正常渲染。
- [ ] `licenses.html` 标注 `@waline/client` MIT；Worker fork 保留 GPL-3.0 LICENSE。

---

## 6. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 上游为 AI 生成、维护者少 | 潜在边界 bug | fork 锁 v1.1.0，改动最小化；管理面板每周看一眼；D1 每周备份 |
| Workers 免费额度 10 万请求/天 | 被刷爆则当日 5xx | 只影响留言板；WAF 限速 + Turnstile 基本挡住；超了再考虑 $5 付费 |
| 审核不及时 | 留言长时间不可见 | P3 Resend 管理员通知；面板待审数进运维面板 |
| unpkg 加载后台面板慢 | 只影响维护者 | 可忍；必要时把 `@waline/admin` 也自托管到 Worker Assets |
| 留言含违法内容被举报 | 站点风险 | 先审后发是硬门槛；隐私 / 合规页写明责任与删除渠道 |

---

## 7. 工时与顺序

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 | fork、D1、secrets、部署、自定义域、管理员 + 2FA、面板配置 | 3 小时 |
| P1 | Turnstile 校验 + 测试、头像镜像、根路径/注册收口、WAF 规则 | 2 小时 |
| P2 | 自托管客户端、guestbook 中英页、导航 / 生成器 / sitemap、隐私 / 合规文案、changelog | 4 小时 |
| P3 | Resend 通知、备份 Action、运维面板卡片 | 3 小时（可后置） |

P0 → P1 → P2 顺序做，P1 完成前**不要公开页面链接**。总计约 1.5 个工作日可上线。
