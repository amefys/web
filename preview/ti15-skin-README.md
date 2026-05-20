# TI15 Skin Preview · 设计稿存档

三版方案，全部按 **策略 B（先用通用 TI 母色系，Valve 官方主题公布后再小调）** 设计。预计 Valve 在 2026-06 ~ 2026-07 公布 TI15 主视觉，届时按需追加 patch。

## 三版方案

| 文件 | 风格 | 主使用场景 |
|---|---|---|
| `ti15-skin-preview.html` | **v1 · Dashboard** — 仪表盘集成式，TI 作为氛围背景 | 日常打开软件，三 skin 自由切换 |
| `ti15-skin-preview-v2.html` | **v2 · Cinematic** — 全屏电影海报，巨型 Aegis 浮于浦东天际 | 站点首屏 / 营销 splash，造势期 |
| `ti15-skin-preview-v3.html` | **v3 · Live Center** — HUD 风直播间，3 列密集信息 | 赛事进行中，软件内"赛事中心"独立页 |

## v1 内嵌的三套 skin

- **Aegis 上海** — 冠军金 × 午夜蓝（主推，致敬 TI 经典 + 上海地缘）
- **Trophy Forge** — 熔金 × 火炉灰（决赛日加冕款）
- **归途 / Homecoming** — 水墨 × 朱砂 × 暗金（CN DOTA Great Again 叙事，CN 战队进 4 强自动激活）

## 关键设计点

- ✅ **6 个核心元素**：上海 / TI / 冠军不朽盾 / 倒计时 / 赛程 / 战队 —— 全部在每版中体现
- ✅ **真实游戏元素**（v3 已落地）：英雄头像 + 装备图标走 Valve 公开 CDN `cdn.cloudflare.steamstatic.com/apps/dota2/...`，零版权风险
- ✅ **战队 logo 抽象化**：用初字 + 渐变背景，避免直接复刻商标
- ✅ **选手不出现**：肖像权高风险，通过英雄池暗示（Spectre/Anti-Mage/Terrorblade）做隐性致敬
- ✅ **倒计时**：JS 实时计算到 2026-09-15 12:00 CST（占位日期，Valve 公布正式开赛日后替换）
- ✅ **合规底线**：抽象 Aegis 纹章（菱形 + 翼 + TI15 阴刻），不抄 Valve 原图
- ✅ **动效门控**：`prefers-reduced-motion` 全套尊重

## 下一步实施路径

```
阶段 1 · 现在 → 2026-06
  ├─ 把 Aegis 上海 skin 实装到 amefys 主程序（参考 cyberpunk-v1）
  ├─ Dashboard 加 TI15 倒计时 widget（v1 风格的 ti-banner 简化版）
  └─ Steam Web API + Liquipedia + CF Worker 缓存：实时比分数据管道

阶段 2 · 2026-06-下 → 2026-07
  └─ 等待 Valve TI15 主题官宣 → 评估视觉调整

阶段 3 · 2026-07 → 2026-09
  ├─ 实装 Trophy Forge + 归途两套补充 skin
  ├─ v3 风格"赛事中心"页面上线
  ├─ amefys.com 首屏临时切到 v2 cinematic 风（hype 期）
  └─ TI15 开赛 → 全功能上线
```
