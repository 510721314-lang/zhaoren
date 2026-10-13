---
name: zhaoren-perf-baseline
description: 找人帮忙小程序性能基线实测——测量包体成分、启动链路、云函数保温与触发器现状，先测量后立项。Use when 用户要求做性能评估/性能优化/首屏提速/包体瘦身/竞品性能对标，或要给「主包多大/首屏几秒」类结论时。Do not use for 纯 UI 视觉美化（走 mini-ui-beautify/wxapp-ui-polish）或无障碍审计（走 mini-a11y-perf-check）。
---

# 性能基线实测（zhaoren）

**铁律：性能结论必须实测，禁止凭推断。** 已实证教训：一份凭推断的 P0 性能报告
5 项中 4 项（分包/骨架屏/SWR+并发/预热）经核实**早已实现**，包体推断值偏差约 4 倍。
不先测量就产出优化方案 = 幻觉。

## 第 0 步：先核实「是否已做」（避免重复立项）

性能优化前必须逐项确认现状，很多"优化项"项目早已实现：

| 常被误判为"缺失" | 实际位置 |
|---|---|
| 分包加载 | `miniprogram/app.json` 的 `subPackages` + `preloadRule` + `lazyCodeLoading:"requiredComponents"` |
| 骨架屏 | `miniprogram/components/ui-skeleton` |
| 首屏并发 | 首页 `fetchUser()` + `fetchSquare()` 不 await（各自 .then） |
| SWR 缓存 | square 10 分钟 / scene_groups 独立缓存，冷启先渲染旧数据 |
| 云函数保温 | `zz-warmup` 函数 + 定时触发器（每 5 分钟唤醒 home-action / user-login） |
| 启动让路 | `utils/bootstrap.js` 拉运营配置已延后 3s |

## 第 1 步：实测包体成分

```powershell
# 各子目录体积（源码未压缩）
Get-ChildItem c:\zhaoren\miniprogram -Directory | ForEach-Object {
  $s=(Get-ChildItem $_.FullName -Recurse -File -EA SilentlyContinue | Measure-Object Length -Sum).Sum
  [PSCustomObject]@{ Dir=$_.Name; KB=[math]::Round($s/1KB) } } | Sort-Object KB -Descending

# 总量 + 最大文件
[math]::Round((Get-ChildItem c:\zhaoren\miniprogram -Recurse -File | Measure-Object Length -Sum).Sum/1KB)
Get-ChildItem c:\zhaoren\miniprogram -Recurse -File | Sort-Object Length -Descending | Select -First 25 KB,Path
```

**判读要点**：
- 分清「主包」与「分包」——主包 = `app.json.pages` 内页面 + components + utils + config
- 核对 `packOptions.ignore`（本项目已排除 `*.md` 与 mock，约 300KB）
- 图片资产：本项目**本地仅几 KB**，图片全走云端/CDN ⇒ 图片不是本地体积问题
- 源码→编译体积：微信会 minify JS/WXSS/WXML，经验压缩比约 0.5~0.65

**已知基线（2026-10 实测，勿重复推翻）**：源码总量 1210KB；主包≈635KB、pkg-low 227KB；
编译后主包约 320-400KB，**远低于 2MB 上限**⇒ 包体不是瓶颈。

## 第 2 步：实测启动链路

精读 4 个文件，画出真实调用顺序与串并行：
```
miniprogram/app.js            # onLaunch: wx.cloud.init / cloudReady 门控 / waitMs / timeout
miniprogram/utils/bootstrap.js# 运营配置拉取时机
miniprogram/utils/cloud.js    # callCloud 包装、重试、超时
miniprogram/pages-v2/index/index.js  # 首页首屏请求编排
```
记录：哪些是平台固有等待（`wx.cloud.init` 握手不可省）、哪些可并发/可延后。

## 第 3 步：云函数保温与触发器现状

```powershell
& "c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat" cloud functions info --env cloud1-d9gkefwcp5c777088 --names zz-warmup --project c:\zhaoren
Get-Content c:\zhaoren\cloudfunctions\zz-warmup\config.json   # 看 triggers cron
Get-Content c:\zhaoren\cloudfunctions\zz-warmup\index.js      # 看 ACTIVE_START/ACTIVE_END 时窗
```

**触发器三处同改**（只改其一无效）：`config.json` 的 `triggers[].config`、函数内时窗常量、
以及创建脚本 `scripts/create-warmup-trigger.js` 的独立 `CRON` 硬编码。
**触发器更新通道**：DevTools CLI 不支持触发器；唯一程序化通道是 `miniprogram-ci` 的
`ci.cloud.createTimeTrigger`，受「小程序代码上传」IP 白名单限制（`-10008 invalid ip`）。
未加白名单 → 云开发控制台手动改。

## 第 4 步：竞品对标 + 归因

对标国内同类（跑腿/代办/陪诊）：美团跑腿/闪送/UU 跑腿小程序首屏 2-3s，陪诊垂直类 3-5s。
本项目**首次**冷启偏高（首次包体下载 + `wx.cloud.init` 握手 + 云函数首次冷启动），
**二次秒开**。归因时务必区分「平台固有」与「代码缺陷」——前者不值得改代码。

## 输出结构

1. 测量方法（说明是源码级还是编译级，别混淆）
2. 实测结果（包体成分表 / 启动链 / 保温现状）
3. 关键判定（明确哪些"不是瓶颈"）
4. **剩余有依据的小项**（逐项标注：依据、收益量级、风险）——量级 <1s 的诚实标注，
   不与"10s"混淆
5. 结论与建议（先测量后动手；不解决根本就不动结构）

## 反模式

- ❌ 未读 `app.json` 就断言"无分包"
- ❌ 未测量就给"主包 X MB / 首屏 Y 秒"
- ❌ 把"平台固有的首次下载/握手/冷启"当作代码缺陷立项
- ❌ 为 <1s 收益做结构性改动（动分包/首页编排会牵连 miniprogram-audit 对齐与 A/B 门禁）
