# 🔄 zhaoren 找人帮忙 — 新电脑衔接启动提示词

> **用法**：在新电脑 clone 仓库后，打开 Trae 新建会话，将本文件全文作为第一条用户消息发送。
> **目标**：让新 Agent 在 2 分钟内理解项目全貌，零重复劳动接手。
> **最后校准**：2026-09-22（对应 commit `8a61a0d`，全量核对过：Git / 云函数 timeout / 备份 / 合规脚本 / 数据量）

---

## 0. 启动第一步（必须先读）

```
请先按顺序读取以下文件，读完后再开始任何工作：
1. .trae/rules.md — 全局红线约束 + 第九章产品战略铁律与提审清单
2. .trae/skills/zhaoren-config-sync/SKILL.md — 场景白名单 SSOT 同步规范
3. miniprogram/config/enums.js — 前端侧枚举 SSOT（SCENES + ORDER_STATUS 13 态）
4. miniprogram/config/index.js — 前端侧 CONFIG 常量（兜底默认值）
5. .trae/skills/error-message-tracing/SKILL.md — 报错溯源方法论（血泪教训，排障前必读）
```

---

## 1. 项目身份

| 项 | 值 |
|---|---|
| 项目名 | zhaoren 找人帮忙（WeChat Mini Program） |
| 技术栈 | 微信原生小程序 + 微信云开发（CloudBase） |
| 云环境 ID | `cloud1-d9gkefwcp5c777088` |
| AppID | `wxbc4a4afacdf234f5` |
| Git remote | `https://github.com/510721314-lang/zhaoren.git` |
| 微信开发者工具 CLI | 本机实测路径：`C:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`（用 glob 桌面一级目录动态发现，勿写中文字面量） |
| HTTP 网关 | `https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com`（**触发路径为空，API 挂在网关根**：`GET /health`、`/debug`、`POST /api`） |
| admin_web_key | 不入库不上文档；向管理员索取，或 `init-db generate_admin_web_key` 重新生成；脚本用 `-AdminKey` 参数或 `ADMIN_WEB_KEY` 环境变量传入 |

---

## 2. 部署命令模板（所有云函数部署通用）

**铁律：部署任何云函数前必须先过预检门（全量 node --check，拦截 SyntaxError）：**

```powershell
# 推荐：预检 + 部署一条龙
powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1 -Deploy <函数名>

# 仅预检不部署
powershell -ExecutionPolicy Bypass -File .trae\predeploy.ps1
```

退出码：0 成功 / 1 语法错误（部署已拦截）/ 2 未装 Node / 3 函数名不存在 / 4 部署失败 / 5 未找到 CLI / 6 目标函数有未提交改动。

**工作流顺序铁律：先改代码 → git commit → 再过预检门部署。**

**CLI 裸命令（预检不可用时）**，PS5 下必须用 `Start-Process` 分文件重定向（`& cli 2>&1` 会把 stderr 包装成 NativeCommandError 中断脚本）：

```powershell
$cli='C:\Users\DC\Desktop\微信WEB开发者工具\cli.bat'
$p = Start-Process -FilePath $cli -ArgumentList @('cloud','functions','deploy','--e','cloud1-d9gkefwcp5c777088','--project','c:\Users\DC\Desktop\zhaoren','--names','<函数名>') `
     -RedirectStandardOutput "$env:TEMP\dep.out.txt" -RedirectStandardError "$env:TEMP\dep.err.txt" -NoNewWindow -Wait -PassThru
```

**⚠️ CLI deploy 不同步 config.json 的 timeout**（已实测证实）：timeout 只能在 **CloudBase 控制台**手动改，或在 IDE 里右键「上传并部署」。改完用下面的命令验证：

```powershell
$args=@('cloud','functions','info','--env','cloud1-d9gkefwcp5c777088','--project','c:\Users\DC\Desktop\zhaoren','--names','<函数名列表，空格分隔>')
# ⚠️ info 必须带 --names，缺了只打印帮助
```

---

## 3. 当前 Git 锚点

```
8a61a0d (HEAD -> master, origin/master) chore(admin-web): config.json timeout 对齐云端 20s 并清除模板占位 env
```

**工作区状态**：干净，所有改动已推送 GitHub，18 个云函数已部署，env=prod。

今日（2026-09-22）提交序列：
```
8a61a0d chore(admin-web): config.json timeout 对齐云端 20s 并清除模板占位 env
26b1905 chore(cloudfunctions): 本地 config.json timeout 对齐规范
80c11a2 fix(miniprogram): 页面层 SCENES.find 全量迁移 getScene
226d1aa feat(miniprogram): 组件与接单链路接入动态场景兜底
fb5a243 feat(config): 新增 config_public 免鉴权公开配置入口
4940c16 docs(skills): 错误溯源方法论与 admin-web 发版 checklist
86a3f87 fix(predeploy): backup.ps1 CLI 发现与 L5 调用修复
0541fe2 fix(miniprogram): 发布/接单/实名门禁链路修复
d566d13 feat(cloudfunctions): 场景数据链路打通与导出白名单对齐
056cc3c fix(cloudfunctions): 统一修复 admin_config 查询结果解包
```

---

## 4. SSOT 架构（场景白名单 + 前端配置）

```
admin_config.scene_list (云端集合, SSOT)
  └─ 当前云端 9 个(2026-09-22 放开): W1就医陪诊 / W2学习陪伴 / W3健身陪伴 / W4游玩陪伴 / W7情绪陪伴 / W8生活协助 / W9宠物陪伴 / W10出行陪伴 / W11线上陪伴
  └─ W5探店陪伴、W6演出陪伴 已拍板终止不做(勿再加)
  └─ 每个 scene 对象含: code, name, options(3), disclaimer_type, builtin(true=后台不可删)
  └─ 免责声明双写: 云端 admin_config.legal_scene_disclaimers {code: 全文} + 前端 enums.js SCENES[].disclaimer
     │
     ├── home-action       ✅ loadSceneList() 动态读，输出 scene_options(发布页服务项数据源)
     ├── demand-publish    ✅ 发布校验链: content_options 非空 + 每项 ∈ 场景 options + ≤3 项
     ├── demand-match / payment-mock / order-create / order-action / im-* / partner-* / blog-action
     │                     ✅ 均动态读 config.scene_list（详见 .trae/handoff-prompt 第 8 节清单）
     │
     └── 前端侧：
         ├── miniprogram/config/enums.js → SCENES（兜底默认值，含 disclaimer 全文）
         ├── miniprogram/utils/redline.js → getScene() 统一入口（硬编码优先 → globalData.availableScenes 兜底）
         └── miniprogram/utils/bootstrap.js → 调 admin-action config_public 覆盖 CONFIG 兜底值
```

**⚠️ 前端拉云端配置的唯一入口是 `admin-action config_public`（免鉴权例外）**，不是 `config_get`：

| action | 鉴权 | 用途 |
|--------|------|------|
| `config_public` | 免鉴权 | 小程序启动时 bootstrap 拉运营参数（仅返回公开字段白名单，无 admin_openids/密钥/env） |
| `config_get` | **需 admin_openids 白名单** | 仅 admin 页面用；普通用户调用必然失败，不要再在业务代码里依赖它 |

**场景查找统一走 `miniprogram/utils/redline.js` 的 `getScene(code)`**：全项目 `SCENES.find` 已清零（仅 redline.js 内部保留硬编码兜底）；`app.globalData.availableScenes` 存的是**完整场景对象数组**（不是 code 数组），填充点=首页/发布页/接单配置三处（三处均已同步）。

---

## 5. `getSceneCodes()` 模式（每云函数独立实现）+ get() 解包语义陷阱

```javascript
// 模板（每个云函数独立实现，不抽共享模块——部署单元隔离）
const SCENE_CODES_FALLBACK = ['W1', 'W2', 'W8', 'W10', 'W11'];
let _sceneCodesCache = null;
async function getSceneCodes() {
  if (_sceneCodesCache) return _sceneCodesCache;
  try {
    const r = await db.collection('admin_config').doc('global').get();
    const cfg = r.data;
    const list = (cfg && Array.isArray(cfg.scene_list) && cfg.scene_list.length > 0)
      ? cfg.scene_list.map((s) => s.code).filter(Boolean)
      : SCENE_CODES_FALLBACK;
    _sceneCodesCache = list;
    return list;
  } catch (e) {
    _sceneCodesCache = SCENE_CODES_FALLBACK;
    return SCENE_CODES_FALLBACK;
  }
}
```

**🩸 血泪教训：CloudBase `get()` 有两种解包语义，混用不报错、只会静默出错**

| 写法 | 返回 | 取法 |
|------|------|------|
| `where({...}).get()` | `r.data` 是**数组** | `r.data[0]`（单文档也要取 `[0]`） |
| `doc('global').get()` | `r.data` 是**单个对象** | 直接用，**禁止** `[0]` / 判 `.length` |

批量把 `where({_id:'global'})` 改成 `doc('global')` 属于**语义耦合改动**：必须逐个调用点复查结果解包，否则静默走 fallback（曾一次性波及 9 处 / 8 个云函数的 getConfig，导致「服务内容不在可选项内」类故障）。

**另一个坑**：`openid.js` 的 env 缓存是**每个云函数独立进程内存**，`invalidateEnvCache()` 只清本函数进程；跨函数感知 env 变更必须直接读 DB。

---

## 6. LEGACY 命名约定（这些硬编码可接受，不要删除）

**规则**：凡变量名带 `_LEGACY` 后缀的，或注释明确说明"仅用于旧数据显示名映射/兜底，不再作为准入校验"，则**可接受**。

| 文件 | 变量 | 用途 |
|---|---|---|
| demand-publish | `SCENE_WHITELIST_LEGACY` / `SCENE_OPTIONS_FALLBACK` | 旧需求文档兼容 / 子服务选项兜底 |
| demand-publish | `DISCLAIMER_TYPE_MAP` | 场景→免责声明类型兜底（优先读 admin_config） |
| home-action | `SCENE_NAMES_LEGACY` | 历史订单中文名兜底 |
| order-action / im-send / im-conv / payment-mock | 局部 `SCENE_NAME` | 同上，显示名兜底 |
| partner-action | 腾讯地图 Key | 密钥分发，可接受 |

---

## 7. 免责声明类型映射（已动态化 ✅）

- demand-publish / order-create 的 `sign_disclaimer`：优先读 `admin_config.scene_list[].disclaimer_type`（SSOT）→ 兜底本地映射 → 最终 fallback `general_disclaimer`
- init-db 种子已升级字段级比对迁移；云端 scene_list **已带** disclaimer_type（2026-09-22 核对通过，此项已完成，不再是待办）

---

## 8. 已确认无问题清单（不要重复审查）

- ✅ 全项目 `SCENES.find` 零残留：页面/组件/工具 13 处已全部迁移到 `redline.getScene()`（2026-09-22）
- ✅ 15+ 云函数 `getConfig()` 解包语义已统一修复（`doc('global').get()` → 直接用 `r.data`）
- ✅ `bootstrap.js` 实名门禁唯一可信来源 = `userInfo.is_realname_done`（直读，禁止再造二次缓存标记）
- ✅ night-mask 16/16 全带 `bind:reserve`；`config/index.js` SSOT 硬编码 0
- ✅ 全量语法门：20 云函数 + 67 前端 js，`node --check` 0 错
- ✅ 18 个云端函数 timeout 全部与规范一致（见第 10 节表）
- ✅ 5 个内置场景 builtin=true 不可删；后台新增场景→首页/发布页/接单配置全链路可选中可发布（W123 实测通过）
- ✅ demo 级实测：需求发布成功（真机，含新增场景）

---

## 9. 项目红线铁律（从 .trae/rules.md 提取）

| 规则 | 说明 |
|---|---|
| **resolveOpenid 强制** | 所有云函数必须 `const { resolveOpenid } = require('./openid'); const openid = await resolveOpenid(cloud, event);` |
| **mock_openid 守卫** | 必须 `admin_config.env === 'dev'` 才允许 mock_openid，prod 强制忽略 |
| **admin_openids** | 从 admin_config.admin_openids 读取，**禁止硬编码兜底**，fail-closed |
| **auto_approve_partner** | prod 必须 false（当前已 false ✅） |
| **金额整数分** | 所有金额存整数分（fen），total_fen 服务端重算，前端禁止直接写金额 |
| **order_id 双格式** | 接受 32 位 hex `_id` 和 ORD 开头 order_no |
| **order-status 归一化** | 云端用 S3.5，前端 wxml 用 S3_5；读取先经 `normalizeStatus()` |
| **cloudbase aggregate** | 必须 `.aggregate().match(cond)`，不是 `.where().aggregate()` |
| **登录态 Storage key** | 是 `v2_login_ok`，**不是 openid** |
| **packOptions.ignore** | 勿再加 `{ value: "pages", type: "folder" }`（会导致 v1 页面无法注册） |
| **privacy API** | `wx.requirePrivacyAuthorize` 不存在；用官方隐私弹窗处理 wx.getLocation/chooseLocation |
| **showModal 4 字限制** | confirmText/cancelText 超过 4 字符在真机上静默失败、弹窗不渲染 |
| **WXML wx:for+wx:elif** | 不能同一元素共存，用 `<block wx:elif>` 嵌套 |
| **WXSS 禁止 BOM** | UTF-8 BOM(EF BB BF) 导致编译拒绝 |
| **timeout 只能控制台改** | CLI deploy 不同步 config.json timeout（见第 2 节） |

---

## 10. 云函数清单（18 个已部署，timeout 为 2026-09-22 云端实测值）

| 函数 | timeout | 主要 action |
|---|---|---|
| admin-action | 20s | claim_admin / dashboard / user_list / scene_list / scene_update / config_get / config_set / **config_public(免鉴权)** / export_admin_config / export_collection |
| admin-web | 20s | HTTP 触发（根路径）：静态 SPA + `/health` + `/debug`(探针) + `POST /api` proxy→admin-action（X-Admin-Key 鉴权） |
| order-action | 20s | confirm / reject / start / finish / detail / my_orders / cancel / evaluate / safety / modify / resume |
| order-create | 20s | create_from_take / sign_disclaimer |
| demand-publish | 20s | publish / my_demands / cancel / edit |
| demand-match | 20s | take / select / reject / list |
| blog-action | 20s | feed_list / detail / publish / like / comment_* / my_list / author_home |
| im-conv | 20s | open / messages / my_convs |
| im-send | 20s | send_template / send_text |
| init-db | 20s | 种子/迁移；`lookup`/`force_migrate_scenes`/`check_pp`/`force_set_env` 需管理员 |
| partner-apply | 20s | apply |
| payment-mock | 10s | cashier_info / mock_pay / mock_refund / mock_tip / mock_ins / withdraw / fast_withdraw / balance_info / income_list / aa_record |
| partner-action | 8s | apply / set_switch / update_config / my_profile / review / detail / route_plan |
| home-action | 8s | index / square / scene_groups / scene_list |
| user-login | 8s | login / bind / phone_login(预留) |
| safety-report | 8s | report / resolve / resolve_sos |
| evaluation-submit | 8s | submit |
| order-timer | 60s | 定时触发（`0 */5 * * * * *`），匿名调用返回 `ot_forbidden` |

**本地有、云端未部署的 2 个目录**：`admin-test`（冒烟测试）、`export-config`（头注"临时云函数…上线前删除"）。按 rules 临时函数须 `zz-` 前缀 + 登记 `.trae/zz-registry.md`（该登记表当前缺失，属待补治理项）。

---

## 11. 测试账号

| 身份 | openid | 说明 |
|---|---|---|
| Admin | `oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c` | admin_config.admin_openids 当前仅此 1 个 |
| Partner | `test_partner_001` | 测试耍伴（exam_scores 100） |

---

## 12. 待办与未决项（2026-09-22 盘点）

**P0 · 提审前必须处理**
1. ~~W123 测试场景 / W10 脏选项~~ → **已清理**（2026-09-22）
2. **mock 支付注释口径冲突**：`payment-mock/index.js` 守卫写成 `if (false && env === 'prod' ...)` 且注释写「[临时放开测试]…上线前恢复」，但 commit `b2ccef7` 已决策「mock 支付为 MVP 正式方案」（rules 第 91/94 条：商业化放上线之后）。→ 需把注释改成与决策一致，避免未来误判为"漏恢复的临时闸门"；收银台「内测版不产生真实扣款」提示已到位
3. **场景口径已拍板 = 9 个**（W3/W4/W7/W9 已放开；W5/W6 终止）。rules.md 第 90 条「11 个场景全开」表述已过期，需同步修正
4. **4 份新场景免责声明待法务终审**（已按草稿上线）：W7 心理危机检测口径（与 MVP 禁做清单冲突）/ W9 宠物照料授权凭证链路未建 / W3 健身教练资质与题库（PRD 3.9 每场景 ≥100 题）未建

**P1 · 提审清单未跑项（rules 第 13/14/15 条）**
4. TRAE-security-review 全仓安全扫描 — 未跑
5. mp-pre-release-audit 微信审核 7 项 — 未跑
6. 真机双身份完整闭环复核（发布已通；接单→四确认→支付→履约→评价 待完整走一遍）

**P1 · 治理机制缺口**
7. `.trae/zz-registry.md` 缺失；`export-config` 未按 `zz-` 规则命名/登记（未部署仍属仓库违规）
8. 本文件已刷新，但 `.trae/rules.md` 第 90 条、`miniprogram/components/partner-card/微信小程序 detail页与广场接云端.md` 等旧文档仍含过时口径
9. `predeploy.ps1` 无 `-Audit` 模式、`.trae/cloudfunctions.whitelist` 缺失 → 「云函数漂移检查 + 临时代码翻转（`if(false && ...)`）扫描」机制未落地

**P2 · 低优先**
10. admin-web 网关 3s 硬限 vs 函数 20s：经网关的大批量导出有 504 风险（当前数据量可通过）
11. v1 旧页面 7 个仍注册在 app.json（已知可接受，非活跃入口）

---

## 13. 经验教训备忘

**排障方法论（详见 `.trae/skills/error-message-tracing/SKILL.md`）**
- 报错文案先 grep 前端+云函数**全部出处** → 弹窗形态反推来源（白 showModal=前端 / 深色 toast=云函数 msg）→ 生产数据验证守卫是否真能触发 → **才**改代码；连续 2 轮未修复立即停止改代码回到溯源第一步

**CloudBase 数据访问**
- `where().get()` 返数组 / `doc().get()` 返对象（见第 5 节）
- `openid.js` env 缓存是每函数独立进程内存
- aggregate 必须 `.aggregate().match()`

**前端**
- showModal confirmText ≤ 4 字符
- WXML 不能同元素 `wx:for`+`wx:elif`；WXSS 禁 BOM
- 第三方组件查不到新场景 = 组件内硬编码 SCENES.find → 统一走 `getScene()`

**运维/工具链**
- CLI `cloud functions info` 必须带 `--names`；PS5 调用 cli.bat 必须 `Start-Process` 分文件重定向
- CLI deploy 不同步 timeout（控制台改）
- 🩸 **命令行内联中文必被破坏成 `?`（字数不变）**：含中文的载荷必须先 Write 成 UTF-8 JSON 文件，再 `ReadAllText(UTF8) | ConvertFrom-Json` → `ConvertTo-Json`（PS5 转义 `\uXXXX` 天然安全）后 POST；禁止命令行内联中文（W10 脏选项 `????` 与本次 scene_add 全部踩此坑）
- `config_set` 无 `scene_rename`：场景写错只能「清空 options → scene_delete → scene_add 重加」
- `config_set` 的 `legal_scene_disclaimers` 是**整体替换**，写入需带全量
- 备份脚本 `backup.ps1`：cli.bat 用 glob 桌面一级目录发现（避免中文字面量 GBK 乱码 + 全盘扫描卡死）
- 恢复桌面/历史记录：`.trae/skills/cloud-backup-restore/SKILL.md`

**业务**
- 订单安全：CAS 防并发（status check-then-set 必须在同一 update 语句里）
- 敏感数据：phone/idcard 加密存储，绝不进入 blog_post author_snapshot
- 四确认前禁止自由文本 + 联系方式交换（IM 红线）
- W11 线上陪伴红线检测 6 类：引流/虚拟币/赌博/色情/政治/暴力

---

## 14. 备份与环境工具

**三重备份铁律（.trae/rules.md 第八章）**：GitHub push + git bundle + robocopy 热备份，每次必做完整性检查。

**一键全量备份脚本（L1-L5）**：

```powershell
powershell -ExecutionPolicy Bypass -File .predeploy\backup.ps1 -BackupDir 'C:\zhaoren_backup_YYYYMMDD' -AdminKey '<key>'
```

覆盖：L1 代码三通道 / L2 admin_config 快照（密钥只回布尔）/ L3 数据库全量导出（31 表，脱敏，SHA256 逐表）/ L5 云函数元数据 + manifest.json（git_head 一致性校验）。
恢复：`.predeploy\restore.ps1 -BackupDir <路径>`（先 dry-run 校验 SHA256，确认后 `-Force`）。

**env 切换（dev ⇄ prod）**：`POST /api {"action":"init_db","__init_db_action":"force_set_env","env":"dev","reason":"..."}`；dev 有 **4 小时自毁**自动切回 prod；prod 下 `send_sms_code` 不返回 dev_code（真机验证码登录必须 dev）。

---

## 15. Git Commit 规范

```
type(scope): description
例: fix(cloudfunctions): 统一修复 admin_config 查询结果解包
例: feat(config): 新增 config_public 免鉴权公开配置入口
```

---

## 16. skills 与脚本清单（.trae/skills/）

| skill | 用途 |
|-------|------|
| zhaoren-audit | 提审就绪度审计 + 防偏离检查（新会话/commit/部署前必跑） |
| error-message-tracing | 报错溯源 5 步法 + get() 解包坑 |
| cloud-backup-restore | 云端全量备份与恢复 |
| zhaoren-config-sync | 场景配置 SSOT 同步 |
| zhaoren-ops | 云函数运维 / openid 映射 / 身份双角色 |
| admin-web-deploy-checklist | admin-web 发版 checklist |
| admin-web-remote-access | 后台网络配置与远程访问排查 |
| mp-privacy-release | 隐私指引配置 + 真机发布链路调试 |
| mp-pre-release-audit | 提审前未开发功能全量审计 |
| miniprogram-audit / mini-a11y-perf-check / mini-interaction-motion / mini-ui-beautify | 小程序审计与 UI 打磨 |
| wechat-cloudfunction-deploy / wx-cloud-deploy | 云函数部署规范 |
| powershell-windows-traps | PS5 陷阱（GBK/&&/stderr/robocopy） |
| cloud-console-test-driver | 微信开发者工具云控制台批量测试 |

脚本：`scripts/check-nightmask.js`、`scripts/check-ssot.js`（commit 前跑，exit 0 为通过）

---

**新电脑初始化检查清单**：

- [ ] 安装微信开发者工具（获取 cli.bat）+ Node.js LTS
- [ ] 安装 Git + 配置 user.name / user.email
- [ ] `git clone https://github.com/510721314-lang/zhaoren.git`
- [ ] 微信开发者工具登录并设置 AppID=`wxbc4a4afacdf234f5`
- [ ] 云开发控制台绑定 env `cloud1-d9gkefwcp5c777088`
- [ ] 微信开发者工具添加 `https://apis.map.qq.com` 到 request 合法域名（腾讯地图 API）
- [ ] 跑一次 `init-db`（GUI 云测试面板）确保 admin_config 种子完整
- [ ] 跑 `node scripts/check-nightmask.js` + `node scripts/check-ssot.js` 确认合规门通过
- [ ] 向管理员索取 admin_web_key（或重新生成）验证 admin-web 后台可登录

---

## 📋 单条提示词（直接复制粘贴版）

```
你好，我接手 zhaoren 找人帮忙微信小程序项目的开发。以下是完整上下文——请先读完再行动：

【项目定位】同城功能性陪伴服务撮合小程序（非社交非交友），首发成都，测试名「找人帮忙」，MVP 核心闭环: 注册认证→需求发布→匹配(广场广播+定向邀约)→IM沟通→四确认下单→模拟支付→履约确认→安全报备→评价结算→基础风控→最小管理后台

【技术栈（不可更换）】
- 微信原生小程序 JavaScript（不用 TypeScript/uni-app/任何 npm 构建）
- 后端: 微信云开发 CloudBase——云函数 Node.js(wx-server-sdk) + 云数据库 + 云存储
- 环境 ID 唯一入口: miniprogram/envList.js 中的 CLOUD_ENV 常量
- 禁止: 第三方 UI 库、云函数之外的 npm 依赖、非 wx-server-sdk 依赖

【身份与环境】
- 云环境: cloud1-d9gkefwcp5c777088 / AppID: wxbc4a4afacdf234f5
- Git: https://github.com/510721314-lang/zhaoren.git
- 最新 commit: 8a61a0d，工作区干净，全部已推送，18 个云函数已部署，env=prod
- HTTP 网关: https://cloud1-d9gkefwcp5c777088-1482004365.ap-shanghai.app.tcloudbase.com（触发路径为空，API 挂在根）

【启动前必读文件（按顺序）】
1. .trae/rules.md — 红线 + 第九章产品战略铁律与提审清单
2. .trae/skills/zhaoren-config-sync/SKILL.md — 场景白名单 SSOT 同步规范
3. .trae/skills/error-message-tracing/SKILL.md — 报错溯源方法论
4. miniprogram/config/enums.js + miniprogram/config/index.js — 前端侧 SSOT

【场景白名单 SSOT 与前端配置入口】
- admin_config.scene_list 是唯一可信源；云端当前 9 个: W1就医陪诊/W2学习陪伴/W3健身陪伴/W4游玩陪伴/W7情绪陪伴/W8生活协助/W9宠物陪伴/W10出行陪伴/W11线上陪伴（全部 builtin 不可删）；W5探店/W6演出 已终止不做
- 前端拉云端配置唯一入口 = admin-action config_public（免鉴权，仅公开字段）；config_get 仅 admin 可用，普通用户必失败
- 场景查找统一走 miniprogram/utils/redline.js getScene()（全项目 SCENES.find 已清零）；app.globalData.availableScenes 存完整场景对象数组
- 场景口径已拍板 = 9 场景（W3/W4/W7/W9 放开、W5/W6 终止）；新场景免责声明已双写云端+前端，但 4 份全文待法务终审（W7 心理危机检测 / W9 宠物授权凭证 / W3 资质题库 三项配套未建）

【CloudBase 数据访问血泪坑（必记）】
- where().get() 的 r.data 是数组（取 [0]）；doc().get() 的 r.data 是单对象（禁止 [0]/判 length）——混用不报错、只会静默走 fallback
- 批量把 where({_id:'global'}) 改 doc('global') 是语义耦合改动，必须逐个调用点复查解包
- openid.js 的 env 缓存是每云函数独立进程内存，跨函数感知 env 变更必须直接读 DB
- aggregate 必须 .aggregate().match()

【部署铁律】
- 先 git commit → 过预检门 powershell -File .trae\predeploy.ps1 -Deploy <函数名> → 部署
- CLI 必须用 Start-Process 分文件重定向（PS5 下 & cli 2>&1 会中断脚本）；info 必须带 --names
- CLI deploy 不同步 config.json timeout，timeout 只能控制台改
- 云端 timeout 实测: 20s=admin-action/admin-web/blog-action/demand-match/demand-publish/im-conv/im-send/init-db/order-action/order-create/partner-apply；10s=payment-mock；8s=partner-action/home-action/user-login/safety-report/evaluation-submit；60s=order-timer

【业务红线速查】
- 订单状态机 13 态: S0待支付/S1待确认/S2已支付待履约/S3履约中/S3.5履约中断/S4部分完成/S5已完成/S6已取消/S7已退款/S8已评价/S9评价超时/S10已关闭/S10.5争议处理中（normalizeStatus 点转下划线）
- 超时: S1 15min→S6 / S0 30min→S6 / S3.5 24h→S4 / S5 48h未评价→S9默认4星
- 信用分: 初始800/满分1000/及格600/冻结400
- 四确认: 时间/地点/内容/费用，双方各确认共8位，任一项修改全重置；四确认前仅系统模板消息
- 模拟支付: 无真实微信支付（MVP 禁做真实支付），走 payment-mock，收银台显著提示"内测版不产生真实扣款"
- 需求发布: 不可篡改实时精确定位 + publish_distance_max_km(默认50km) 距离校验；定向邀约不入广场
- 订单详情履约阶段(S2/S3/S3.5/S4)必须显示 Safety Center

【提审前必跑清单（rules 第九章 9-16 条）】
9. night-mask: node scripts/check-nightmask.js exit 0 ✅(16/16)
10. admin_openids 非空 ✅(1 个)
11. 云端越权回归: 匿名调 init-db lookup / order-timer 必须 forbidden ✅(静态确认)
12. node --check 全量 ✅(20+67 文件 0 错)
13. TRAE-security-review 安全扫描 ⏳未跑
14. mp-pre-release-audit 微信审核 7 项 ⏳未跑
15. 真机双身份闭环（发布已通；接单→四确认→支付→履约→评价 待复核）⏳
16. 三重备份验证 ✅(今日通过)

【当前待办（按优先级）】
P0: ① 修正 payment-mock「临时放开」注释口径（决策见 commit b2ccef7: mock 支付为 MVP 正式方案）② 4 份新场景免责声明送法务终审 + W3/W9 资质配套、W7 危机检测口径拍板 ③ 同步修正 rules.md 第90条「11 场景」为 9 场景
P1: ④ 跑提审终检 13/14/15 ⑤ 补 .trae/zz-registry.md + 处理 export-config 临时函数 ⑥ predeploy 补 -Audit 漂移检查
P2: ⑦ admin-web 网关 3s 硬限 vs 大批量导出 504 风险

【备份铁律】重大改动前后必须三重备份（GitHub push + git bundle verify + robocopy SHA256 比对）；一键脚本 .predeploy\backup.ps1（L1-L5 + manifest 校验）

【测试账号】Admin: oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c / Partner: test_partner_001 (exam_scores 100)

请确认你已理解，然后告诉我接下来要做什么。
```