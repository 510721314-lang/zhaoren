# 全项目代码 Bug 静态扫描报告（2026-11-08）

> 执行方式：技能 `miniprogram-audit`（C1–C6）+ 项目门禁 `npm run verify:offline` + 经验驱动专项扫描（导航兜底 / 静默失败 / 金额浮点 / 空 catch / 配置一致性）。
> 取证环境：仓库工作区 `c:\zhaoren`，HEAD 与 `origin/master` 存在 3 笔未推提交（详见 §6）。
> 本报告只读产出，未修改任何代码。

## 1. 结论

- **核心正确性全绿**：C2/C3/C4/C5/C6 全部 PASS；`verify:offline` 通过，A/B 等价 **456 例**（237 explicit + 219 auto；79 known-evolution）。
- **发现 3 类真实缺陷（P2，不阻断提审）**：
  1. **导航缺 `fail` 兜底 31 处**（共 129 次跳转调用），其中动态 url 的 **12 行 / 6 文件为真风险**；
  2. **`fail: () => {}` 静默兜底 40 处**，其中通知中心 6 处动态跳转、exam 1 处落主链路（原记的 bootstrap 2 处经复核为 `showModal` 弹窗兜底，非跳转，已移出）；
  3. **错误 API 1 处**：`pkg-low/kefu/kefu.js:96` 用 `navigateTo` 指向 tabBar 页，微信必拒绝（见 §4.3）。
- 三类共同特征：**不报错、不崩溃，但用户点击无反应且无提示**——属 §7 明令要防的「静默失败」形态。
- **金额与配置维度无缺陷**：云函数浮点金额运算 0 处；`app.json` 合规项全达标。

## 2. 审计步骤结果

| 步骤 | 内容 | 结果 |
|---|---|---|
| C1 | IDE 编译 + 诊断 | ✅ **PASS**（用户回报已编译；IDE 红线/白屏以用户目视为准，本轮无错误截图留证） |
| C2 | 路由对齐（v1 死链） | ✅ **PASS** — `url: '/pages/...` 命中 **0** |
| C3 | WXML bind 事件 vs JS 方法 | ✅ **PASS** — `WXML handlers vs JS methods all aligned` |
| C4 | 云函数 action 契约 | ✅ **PASS** — `all cloud action contracts aligned (12 functions)` |
| C5 | 本地图片资源引用 | ✅ **PASS** — WXML 中 `.png/jpg/jpeg/svg/gif/webp` 命中 **0** |
| C6 | 工程合规 | ✅ **PASS** — 见 §3 |
| C7 | 发布打包（zip/tag） | ⚪ 未执行（发布动作，需用户批准） |
| 附加 | `npm run verify:offline` | ✅ **PASS** — `A/B EQUIVALENT: 456 cases (237 explicit + 219 auto; 79 known-evolution)` |

## 3. C6 工程合规实测

```text
privacy: true | requiredPrivateInfos: ["getLocation","chooseLocation"]
pages: 19 | v1 pages: 0
tabBar: pages-v2/index/index, pages-v2/square/square, pages-v2/message/message, pages-v2/profile/profile
subPackages: pages-v2/admin, pages-v2/agreement, pages-v2/privacy, pages-v2/pkg-low
```

- `__usePrivacyCheck__: true` ✔；`requiredPrivateInfos` 已声明 getLocation/chooseLocation ✔
- `pages[]` 19 页 **全部 `pages-v2/`**，v1 残留 0 ✔
- tabBar 4 项全 v2 ✔
- 分包 4 个，主包未见新增依赖 ✔

## 4. FAIL-1｜导航缺 `fail` 兜底（P2，31 / 129）

扫描口径：`wx.navigateTo|redirectTo|reLaunch({...})` 调用点后 260 字符内无 `fail:`。

### 4.1 真风险（动态 url，12 行 / 6 文件，建议修）

| 文件:行 | 目标 | 失败后果 |
|---|---|---|
| `miniprogram/pages-v2/index/index.js:344` | `activity-detail?id=` + id | 运营活动下线/参数异常 → 点击无反应 |
| `miniprogram/pages-v2/square/square.js:171` | `activity-detail?id=` + id | 同上（广场入口） |
| `miniprogram/pages-v2/index/index.js:332` | `publish?scene=` + scene（动态 url） | 运营位跳发布页失败 → 点击无反应 |
| `miniprogram/pages-v2/square/square.js:158` | `publish?scene=` + scene（动态 url） | 同上（广场入口） |
| `miniprogram/pages-v2/blog/blog.js:163` | `blog-detail?post_id=` + id | 帖子跳转静默失败 |
| `miniprogram/pages-v2/blog/blog.js:175` | `blog?tag=` 编码参数 | 标签筛选静默失败 |
| `miniprogram/pages-v2/blog/blog.js:191` | 确认后跳 login | 未登录态无反馈 |
| `miniprogram/pages-v2/blog/blog.js:196` | `blog-publish` | 去发帖无反应 |
| `miniprogram/pages-v2/blog-detail/blog-detail.js:92` | `blog?tag=` | 标签筛选静默失败 |
| `miniprogram/pages-v2/blog-detail/blog-detail.js:159` | 确认后跳 login | 未登录态无反馈 |
| `miniprogram/pages-v2/profile/profile.js:450` | `publish` | 去发单无反馈 |
| `miniprogram/pages-v2/my-demands/my-demands.js:86` | `publish` | 去发单无反馈 |

> 共 12 行，按文件计 6 个。
> 2026-11-08 评审订正：原文写「8 处」但表格列 10 行；补入 `index.js:332`、`square.js:158`（与已列各项同类：path 固定 + query 动态）后为 12 行。
> 口径说明：`blog.js:191`、`blog-detail.js:159` 指向的 login 为静态注册页，失败概率低，但属「确认后跳转、失败即无反馈」的用户可感知场景，故仍列入本表。

### 4.2 低风险（10 处，已补 9 / 不修 1）

`admin/admin.js:62-67` 6 处后台子页 `navigateTo`、`blog-publish.js:38` / `profile.js:457` 跳 login、`pkg-low/exam/exam.js:128` 的 `navigateBack` 兜底跳转 —— 均已补 `fail` 提示。`app.js:150` 的 `reLaunch` 目标为 tabBar 页（`reLaunch` 合法、失败率极低），登记不修。

> 计数：4.1（12）+ 4.2（10）+ 4.3（9）= 31，与 §4 总数对齐。
> **2026-11-08 二次复核**：原把 `admin/*.js` 的 `redirectTo('/pages-v2/index/index')` 归入本表「低风险」，实测该目标是 tabBar 页，`redirectTo` 必被拒绝 → 已移入 §4.3 并改为 `reLaunch`。

### 4.3 错误 API（9 处，必修，已全部修复）

| 文件:行 | 现状 | 问题 | 修法 |
|---|---|---|---|
| `miniprogram/pages-v2/pkg-low/kefu/kefu.js:96` | `wx.navigateBack({ fail: () => wx.navigateTo({ url: '/pages-v2/index/index' }) })` | `/pages-v2/index/index` 是 **tabBar 页**，`navigateTo` 必被微信拒绝 → 兜底链整条失效（客服页返回键点了无反应） | 改为 `wx.switchTab({ url: '/pages-v2/index/index' })` |
| `miniprogram/pages-v2/admin/{admin,users,partners,demands,orders,finance,config,user-detail}.js`（8 处） | `setTimeout(() => wx.redirectTo({ url: '/pages-v2/index/index' }), 800)` | 同上：目标是 tabBar 页，`redirectTo` 必失败 → 非管理员进入后台时静默停在空白页 | 改 `wx.reLaunch` + 补 `fail` toast |

> 2026-11-08 评审新发现：原文把这两类都当作「静态注册路由·低风险」，漏掉了「目标页是 tabBar 页」这一硬失败条件。

## 5. FAIL-2｜`fail: () => {}` 静默兜底（P2，40 处）

### 5.1 主链路（建议修）

| 文件:行 | 场景 |
|---|---|
| `miniprogram/pages-v2/pkg-low/notices/notices.js:146/148/150/154/157` | 通知点击 → order-detail / pay / demand-detail / accept-config 动态跳转，失败无任何提示 |
| `miniprogram/pages-v2/pkg-low/notices/notices.js:152` | 通知点击 → switchTab profile |
| `miniprogram/pages-v2/pkg-low/exam/exam.js:66` | 切换科目（P3-14b 同类） |

> 2026-11-08 评审订正：`bootstrap.js:259`、`:334` 实测为 `wx.showModal({ ... fail: () => {} })` 的**弹窗**兜底（不是跳转兜底），已移出本表，归入 §5.2 不修。

### 5.2 合理静默（不修）

`custom-tab-bar` / `nav-bar` 的 `switchTab` 兜底、各页 `navigateBack` 兜底、`wx.vibrateShort` 可选能力、`bootstrap.js:259/334` 的 `showModal` 弹窗兜底、`publish.js` 已有二级兜底（`navigateBack → switchTab`）等，共约 31 处。

## 6. 观察项（非缺陷，不改）

| # | 观察 | 判定 |
|---|---|---|
| OBS-1 | 前端空 catch **75 处**；抽查 `chat.js:441` 为「模板格式化失败→回退原文」 | 良性；按技术债 P3-1「有意设计」口径不动 |
| OBS-2 | 前端金额 35 处 `/100 + toFixed(2)` 为展示层；元→分写入处用 `Math.round(x*100)` 整数化；**云函数浮点金额运算 0 处**（统一 `Math.round(total * rate / 10000)`） | 符合红线附录A 第 7 条（评审订正：原表述「前端仅展示层」漏记元→分整数化写入） |
| OBS-3 | 云端 `admin_config.scene_list` 9 场景 vs 前端 `enums.js` 11 个（W11 `visible:false`） | 非 bug，属待定的可见性口径（HANDOFF T-7.18 ①A） |
| OBS-4 | `verify:offline` 唯一 KNOWN：`create_from_take` → `location_untrusted` | 已声明为有意演进 |
| OBS-5 | 本机 3 笔提交未推（`7e18038` / `5d84bcb` / `9a16a65`）；GitHub 443 被重置、22 可达但无 SSH 密钥 | 环境问题，非代码缺陷 |

## 7. 修复建议（分批，遵守 §1 ≤3 文件/批）

| 批次 | 范围 | 文件数 | 处数 | 需真机 |
|---|---|---|---|---|
| 1 | blog + blog-detail | 2 | 6 | iOS/Android 各一遍 |
| 2 | index + square（含新补 2 处） | 2 | 4 | 同上 |
| 3 | profile + my-demands | 2 | 2 | 同上 |
| 4 | notices（含 6 处） | 1 | 6 | 同上 |
| 5 | **kefu（`navigateTo`→`switchTab`）** | 1 | 1 | **必验**（P2 硬失败） |
| 6 | exam（原含 bootstrap 2 处，已剔除） | 1 | 1 | 同上 |

> **执行状态（2026-11-08）**：已按「A 全部 6 批」修完，共 **9 文件 / 20 处**（blog 4、blog-detail 2、index 2、square 2、profile 1、my-demands 1、notices 6、kefu 1、exam 1）；同日续做 §4.2 / §4.3 剩余 **9 文件 / 16 处**（admin 8 文件 14 处、blog-publish 1、exam 1）→ 本轮**合计 18 文件 / 36 处**。门禁：`SYNTAX ALL OK (283)` / `tests 866 pass 0 fail` / `A/B EQUIVALENT 456` / `SHARED SYNC ALL OK` / `SSOT 0` / `RULES-SIZE OK 16643B`。

统一修法（不新增工具函数，逐处最小改）：

```js
wx.navigateTo({ url, fail: () => wx.showToast({ title: '页面打开失败，请重试', icon: 'none' }) });
```

边界（评审补充）：tabBar 页一律用 `wx.switchTab`，**不得用 `navigateTo`**；`redirectTo` 会销毁当前页，失败后必须另有回退目标（如 `switchTab`）；给 `navigateBack` 加兜底前先判 `getCurrentPages().length > 1`。

`notices.js` 建议按「目标页名称」给差异化文案，避免统一提示无法定位。

## 8. 回归验证清单

| # | 项 | 步骤 | 预期 | 谁验 |
|---|---|---|---|---|
| 1 | C2 死链 | `Grep "url: '/pages/"` | 0 命中 | AI（已 PASS） |
| 2 | C3 handler | 跑 `c3-bind-handler-alignment.ps1` | all aligned | AI（已 PASS） |
| 3 | C4 契约 | 跑 `c4-cloud-contract.ps1` | 12 函数对齐 | AI（已 PASS） |
| 4 | C5 资源 | Grep WXML 图片后缀 | 0 命中 | AI（已 PASS） |
| 5 | C6 合规 | 解析 `app.json` | 19 页全 v2 / privacy true | AI（已 PASS） |
| 6 | A/B 等价 | `npm run verify:offline` | 456 例通过 | AI（已 PASS） |
| 7 | IDE 编译 | 开发者工具点编译 | 无红线、无白屏 | 用户（已回报） |
| 8 | 修复后真机 | 逐批点击被改入口 | 失败时有 toast、成功时正常跳转 | 用户（真机） |

## 9. 未做与阻塞

1. **C7 发布打包未做**：需用户批准后 `git tag` + `git archive` 出 zip。
2. **真机回归未做**：本报告为静态扫描，交互类缺陷须真机验证。
3. **3 笔提交未推**：GitHub 443 被重置；22 端口可达但本机 `~/.ssh` 无 `id_*` 私钥，需「起 7890 代理 / 建 SSH 密钥 / 换网」三选一。
4. **云函数侧专项未扫**：鉴权旁路、外呼超时、静默吞错不在本次「前端静态扫描」范围（评审提出但无实证，登记为后续专项）。

## 10. 评审与订正记录（2026-11-08）

双代理交叉评审（代理 A 事实核验 / 代理 B 完整性偏离）+ 复跑同口径扫描（`TOTAL_CALLS=129 / MISSING_FAIL=31`，与 §4 一致）。订正 5 处：

1. §1 / §4.1「8 处」→「12 行 / 6 文件」，补入 `index.js:332`、`square.js:158`（与已列各项同类）。
2. 新增 §4.3「错误 API」：`kefu.js:96`（评审实测新发现，原文误判为低风险）。
3. §5.1 移出 `bootstrap.js:259/334`（实测为 `showModal` 弹窗 `fail`，非跳转兜底）。
4. §6 OBS-2 补记「元→分 `Math.round(x*100)` 整数化写入」。
5. §7 补修复边界（tabBar 页必须 `switchTab` / `redirectTo` 需回退目标 / `navigateBack` 先判页面栈），批次拆为 6 批。

未采纳：代理 B「31 处偏低」（复跑一致，31 为口径内准确值）、「云函数鉴权/超时/静默吞错未覆盖」（无 `文件:行号` 实证且超出本报告范围，已登记 §9-4）。
口径局限：260 字符窗口会串读相邻调用的 `fail`，`publish.js:1079` 因此漏检（实际有 1082–1087 二级兜底，不修）。
