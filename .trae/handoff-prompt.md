# 🔄 zhaoren 找人帮忙 — 新电脑衔接启动提示词

> **用法**：在新电脑 clone 仓库后，打开 Trae 新建会话，将本文件全文作为第一条用户消息发送。
> **目标**：让新 Agent 在 2 分钟内理解项目全貌，零重复劳动接手。

---

## 0. 启动第一步（必须先读）

```
请先按顺序读取以下文件，读完后再开始任何工作：
1. .trae/rules.md — 全局红线约束（11 条 P1 Critical + 第八章三重备份策略）
2. .trae/skills/zhaoren-config-sync/SKILL.md — 场景白名单 SSOT 同步规范
3. miniprogram/config/enums.js — 前端侧枚举 SSOT（SCENES 5 场景 + ORDER_STATUS 13 态）
4. miniprogram/config/index.js — 前端侧 CONFIG 常量（含 WITHDRAW / ORDER / TENCENT_MAP_KEY）
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
| 新电脑路径 | 自行 clone 到任意位置，CLI 命令用 `--project` 指定路径 |
| 微信开发者工具 CLI | 安装后路径通常为 `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat` 或用户桌面 |

---

## 2. 部署命令模板（所有云函数部署通用）

```powershell
# 单云函数部署 + 远端 npm install
& "<CLI路径>" cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <函数名> --project "<项目根>" --remote-npm-install

# 例
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names partner-action --project "C:\Users\DC\Desktop\zhaoren" --remote-npm-install
```

**注意**：CLI 不支持逗号分隔的多函数部署，需要逐个部署。

---

## 3. 最新 Git 锚点

```
ae8bfca (HEAD -> master, origin/master)
fix(scene): 全项目硬编码兜底——partner-action 动态构建 DEFAULT_EXAM_SCORES + 默认场景; 
init-db 种子加 disclaimer_type + 升级迁移逻辑; 
demand-publish/order-create 免责声明优先读 admin_config.scene_list
```

**工作区状态**：干净，所有改动已推送 GitHub，所有云函数已部署。

---

## 4. SSOT 架构图（场景白名单唯一可信源）

```
admin_config.scene_list (云端集合, SSOT)
  └─ 当前 5 个活跃场景: W1(就医陪诊) / W2(学习陪伴) / W8(生活协助) / W10(出行陪伴) / W11(线上陪伴)
  └─ 每个 scene 对象含: code, name, options, disclaimer_type, aa_default(可选)
  └─ 迁移由 init-db seed 驱动（字段级比对，自动覆盖）
     │
     ├── home-action       ✅ getSceneCodes() 动态读 + SCENE_FALLBACK 兜底
     ├── demand-publish    ✅ getSceneCodes() 动态读 + SCENE_CODES_FALLBACK 兜底
     ├── partner-apply     ✅ getSceneCodes() 动态读 + SCENE_CODES_FALLBACK 兜底
     ├── partner-action    ✅ getSceneCodes() 动态读 + SCENE_CODES_FALLBACK 兜底
     ├── blog-action       ✅ getSceneCodes() 动态读 + SCENE_CODES_FALLBACK 兜底
     ├── demand-match      ✅ 直接 config.scene_list 读取（非准入校验，OK）
     ├── payment-mock       ✅ 直接 config.scene_list 读取（用于 aa_record 场景校验）
     │
     └─ 前端侧 SSOT（小程序不能直读 admin_config，由以下两文件构成前端侧 SSOT）
         ├── miniprogram/config/enums.js → SCENES[5]（含 disclaimer 全文）
         └─ miniprogram/utils/constants.js → SCENE_LIST[5]（旧 pages/ 兼容视图）
         └─ miniprogram/config/index.js → CONFIG 对象（WITHDRAW / ORDER 等）
```

---

## 5. `getSceneCodes()` 模式（每云函数独立实现）

```javascript
// 模板（每个云函数独立实现，不抽共享模块——部署单元隔离）
const SCENE_CODES_FALLBACK = ['W1', 'W2', 'W8', 'W10', 'W11'];
let _sceneCodesCache = null;
async function getSceneCodes() {
  if (_sceneCodesCache) return _sceneCodesCache;
  try {
    const r = await db.collection('admin_config').where({ _id: 'global' }).limit(1).get();
    const cfg = r.data && r.data[0];
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

---

## 6. LEGACY 命名约定（这些硬编码可接受，不要删除）

**规则**：凡变量名带 `_LEGACY` 后缀的，注释明确说明"仅用于旧数据显示名映射/兜底，不再作为准入校验"，则**可接受**。

| 文件 | 变量 | 用途 |
|---|---|---|
| demand-publish | `SCENE_WHITELIST_LEGACY` | 8 场景 code 列表，旧需求文档兼容 |
| demand-publish | `DISCLAIMER_TYPE_MAP` | 8 场景→免责声明类型，兜底（优先读 admin_config） |
| demand-publish | `SCENE_OPTIONS_FALLBACK` | 8 场景子服务选项，兜底 |
| home-action | `SCENE_NAMES_LEGACY` | 8 场景中文名表，历史订单显示名兜底 |
| order-action | 局部 `SCENE_NAME`（8 场景） | 同上，订单详情/列表显示名兜底 |
| im-send / im-conv | 同上 | 同上，IM 消息场景名展示 |
| payment-mock | `SCENE_NAMES`（8 场景） | 同上，支付记录场景名展示 |

---

## 7. 免责声明类型映射（已动态化）

```
demand-publish / order-create 的 sign_disclaimer 现在：
  1. 优先读 admin_config.scene_list[].disclaimer_type（SSOT）
  2. 兜底本地硬编码映射（兼容旧 admin_config 无 disclaimer_type 字段时）
  3. 最终 fallback 到 'general_disclaimer'

init-db 种子已升级：每个 scene 增加 disclaimer_type 字段
  W1 → 'medical_disclaimer'
  W2 / W8 / W10 → 'general_disclaimer'
  W11 → 'online_disclaimer'

⚠️ 云端 admin_config.scene_list 可能还未带 disclaimer_type 字段
   需手动跑一次 init-db（CLI 无 invoke，可用微信开发者工具 GUI 云函数测试面板调用）
   init-db 已升级迁移逻辑：字段级比对而非仅 code 有无增减
```

---

## 8. 已确认无问题清单（不要重复审查）

- ✅ `cloudfunctions/home-action/index.js` — SCENE_FALLBACK(5) 兜底 + SCENE_NAMES_LEGACY(8) 显示名
- ✅ `cloudfunctions/demand-publish/index.js` — getSceneCodes 动态读 + LEGACY 变量兜底
- ✅ `cloudfunctions/demand-match/index.js` — 直接 config.scene_list 读取
- ✅ `cloudfunctions/payment-mock/index.js` — SCENE_NAMES(8) 显示名 + aa_record 用 config.scene_list
- ✅ `cloudfunctions/partner-apply/index.js` — getSceneCodes 动态读
- ✅ `cloudfunctions/partner-action/index.js` — getSceneCodes 动态读 + DEFAULT_EXAM_SCORES 动态构建 + ['W1'] 兜底已改
- ✅ `cloudfunctions/blog-action/index.js` — getSceneCodes 动态读（feed_list + publish 两处调用点已修复）
- ✅ `cloudfunctions/im-send/index.js` — SCENE_NAME(8) 显示名，无准入校验
- ✅ `cloudfunctions/im-conv/index.js` — 同上
- ✅ `cloudfunctions/order-action/index.js` — 两处局部 SCENE_NAME(8) 显示名，无准入校验
- ✅ `cloudfunctions/order-create/index.js` — sign_disclaimer 动态读 config.scene_list
- ✅ `cloudfunctions/safety-report/index.js` — admin_openids 从 admin_config 读，无硬编码兜底
- ✅ `cloudfunctions/init-db/index.js` — 种子 scene_list 含 disclaimer_type，迁移逻辑已升级
- ✅ `cloudfunctions/admin-action/index.js` — admin_openids 从 admin_config 读
- ✅ `cloudfunctions/user-login/index.js` — scene_list 透传 config.scene_list
- ✅ 前端 `miniprogram/config/enums.js` — SCENES[5] + ORDER_STATUS[13]，前端侧 SSOT
- ✅ 前端 `miniprogram/utils/constants.js` — SCENE_LIST[5]，前端侧兼容视图
- ✅ 前端 `miniprogram/pages-v2/wallet/wallet.js` — SCENE_NAMES 从 SCENES 动态构建
- ✅ 腾讯地图 Key 两处硬编码（partner-action L33 + config/index.js L61）— 密钥分发，可接受

---

## 9. 项目红线铁律（从 .trae/rules.md 提取）

| 规则 | 说明 |
|---|---|
| **resolveOpenid 强制** | 所有云函数必须 `const { resolveOpenid } = require('./openid'); const openid = await resolveOpenid(cloud, event);` |
| **mock_openid 守卫** | 必须 `admin_config.env === 'dev'` 才允许 mock_openid，prod 强制忽略 |
| **admin_openids** | 从 admin_config.admin_openids 读取，**禁止硬编码兜底**，fail-closed |
| **auto_approve_partner** | prod 必须 false，由 admin_config 控制 |
| **金额整数分** | 所有金额存整数分（fen），total_fen 服务端重算，前端禁止直接写金额 |
| **order_id 双格式** | 接受 32 位 hex _id 和 ORD 开头 order_no |
| **order-status 归一化** | 云端用 S3.5，前端 wxml 用 S3_5；所有读取先经 `normalizeStatus()` |
| **cloudbase aggregate** | 必须 `.aggregate().match(cond)`，不是 `.where().aggregate()` |
| **v2_login_ok 登录态** | Storage key 是 `v2_login_ok`，**不是 openid** |
| **packOptions.ignore** | 之前误配 `{ value: "pages", type: "folder" }` 导致 v1 旧页面无法注册 app.json，已删除但勿复加 |
| **privacy API** | `wx.requirePrivacyAuthorize` 不存在；用官方隐私弹窗处理 wx.getLocation/chooseLocation |
| **showModal 4 字限制** | confirmText/cancelText 超过 4 字符在真机上静默失败 |
| **WXML wx:for+wx:elif** | 不能同一元素共存，用 `<block wx:elif>` 嵌套 |
| **WXSS 禁止 BOM** | UTF-8 BOM(EF BB BF) 导致编译拒绝 |
| **部署超时** | order-action/order-create/demand-publish/demand-match: 20s；payment-mock: 10s；其余: 8s；order-timer: 60s |

---

## 10. 云函数清单

| 函数 | 超时 | 主要 action |
|---|---|---|
| admin-action | 8s | claim_admin / list / add_admin / remove_admin / scene_list / scene_update / system_templates |
| partner-apply | 8s | apply |
| partner-action | 8s | apply / set_switch / update_config / my_profile / review / detail / route_plan |
| home-action | 8s | index / scene_list |
| demand-publish | 20s | publish / my_demands / cancel |
| demand-match | 20s | take / select / reject / list |
| order-create | 20s | create_from_take / sign_disclaimer |
| order-action | 20s | confirm / reject / start / finish / detail / my_orders / cancel / evaluate / safety / modify / resume / confirm_ratio |
| order-timer | 60s | (定时触发，处理超时) |
| payment-mock | 10s | cashier_info / mock_pay / mock_refund / aa_record / balance_info / income_list / withdraw / fast_withdraw / withdraw_list |
| blog-action | 8s | feed_list / detail / publish / delete_my / like / unlike / comment_list / comment_add / comment_delete / my_list / author_home |
| im-send | 8s | send_template / send_text |
| im-conv | 8s | open / messages / my_convs |
| safety-report | 8s | report / resolve / resolve_sos |
| evaluation-submit | 8s | submit |
| user-login | 8s | login / bind |
| init-db | — | (一次性种子，迁移 admin_config) |

---

## 11. 测试账号

| 身份 | openid | 说明 |
|---|---|---|
| Admin | `oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c` | 管理员（需 admin_config.admin_openids 中有） |
| Partner | `test_partner_001` | 测试耍伴（exam_scores 100） |

---

## 12. 剩余可选优化项（低优先级）

```
P2 · 跑一次 init-db 让云端 admin_config.scene_list 真正带上 disclaimer_type 字段
    当前已具备动态读能力，读不到时 fallback 到本地 LEGACY 映射
    渐进式升级，不阻塞任何功能

P3 · TOPIC_WHITELIST 双写
    blog-action TOPIC_WHITELIST=['陪诊日常',...,'暖心瞬间']
    constants.js BLOG_TOPICS 也有同名列表
    可后续考虑移入 admin_config，但话题不是场景白名单

P3 · v1 旧页面硬编码
    miniprogram/pages/user-home/user-home.js SCENE_MAP 硬编码 5 场景
    miniprogram/pages/partner-home/partner-home.js 从 SCENE_LIST 构建（OK）
    miniprogram/pages/blog/blog.js / blog-detail.js 从 SCENE_LIST 构建（OK）
    低优先级：v1 页面不是活跃入口，但仍注册在 app.json

P3 · 前端 publish 页场景选项动态读
    彻底消除前端硬编码需要前端直读 admin_config 或 home-action 加新 action
    低优先级：前端 enums.js 作为前端侧 SSOT 已足够

P3 · DEFAULT_EXAM_SCORES 业务规则
    partner-apply L79 indexOf('W1') 触发国标考核>=80分是 PRD 固定规则
    不是运营可配置项，硬编码可接受
```

---

## 13. 经验教训备忘

- `koa-connect` wrapper 导致 ctx leak，原生 Koa middleware 替代
- File size ≠ integrity，robocopy 排除陷阱，备份必须 commit 后再三重备份
- 订单安全：CAS 防并发（status check-then-set 必须在同一 update 语句里）
- 敏感数据：phone/idcard 加密存储，绝不进入 blog_post author_snapshot
- 四确认前禁止自由文本 + 联系方式交换（IM 红线）
- 线上陪伴 W11 红线检测 6 类：引流/虚拟币/赌博/色情/政治/暴力

---

## 14. 备份铁律（.trae/rules.md 第八章）

任何重大改动前/后必须执行三重备份 + 完整性检查：

1. **GitHub push** → `git log origin/master..HEAD` 确认无未推送 commit
2. **Git Bundle** → `git bundle create zhaoren_v<version>_<YYYYMMDD>.bundle --all` → `git bundle verify` + 临时 clone + commit/tag hash 比对
3. **robocopy 热备份** → `robocopy <src> <dst> /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NP` → SHA256 逐文件比对，核心文件 0 差异 0 缺失

---

## 15. Git Commit 规范

```
type(scope): description
例: fix(scene): blog-action 调用点 SCENE_CODES → await getSceneCodes()
例: feat(init-db): scene_list 迁移覆盖 + disclaimer_type 字段级比对
```

---

**新电脑初始化检查清单**：

- [ ] 安装微信开发者工具（获取 cli.bat）
- [ ] 安装 Git + 配置 user.name / user.email
- [ ] git clone https://github.com/510721314-lang/zhaoren.git
- [ ] 在微信开发者工具登录并设置 AppID=wxbc4a4afacdf234f5
- [ ] 云开发控制台绑定 env cloud1-d9gkefwcp5c777088
- [ ] 微信开发者工具添加 `https://apis.map.qq.com` 到 request 合法域名（腾讯地图 API）
- [ ] 跑一次 init-db 确保 admin_config 种子完整

---

## 📋 单条提示词（直接复制粘贴版）

```
你好，我接手 zhaoren 找人帮忙微信小程序项目的开发。以下是完整上下文——请先读完再行动：

【项目定位】同城功能性陪伴服务撮合小程序（非社交非交友），首发成都，测试名「找人帮忙」，MVP 核心闭环: 注册认证→需求发布→匹配(广场广播+定向邀约)→IM沟通→四确认下单→模拟支付→履约确认→安全报备→评价结算→基础风控→最小管理后台

【技术栈（不可更换）】
- 微信原生小程序 JavaScript（不用 TypeScript/uni-app/任何 npm 构建）
- 后端: 微信云开发 CloudBase——云函数 Node.js 18(wx-server-sdk) + 云数据库 + 云存储
- 环境 ID 唯一入口: miniprogram/envList.js 中的 CLOUD_ENV 常量
- 禁止: 第三方 UI 库、云函数之外的 npm 依赖、非 wx-server-sdk 依赖

【身份与环境】
- 云环境: cloud1-d9gkefwcp5c777088
- AppID: wxbc4a4afacdf234f5
- Git: https://github.com/510721314-lang/zhaoren.git
- 最新 commit: 5a8b2f4，全部已推送，全部云函数已部署

【启动前必读文件（按顺序）】
1. .trae/rules.md — 12 条不可变红线 + 代码规范 + 数据库集合命名
2. .trae/skills/zhaoren-config-sync/SKILL.md — SSOT 同步规范
3. miniprogram/config/enums.js — 前端枚举 SSOT（SCENES 5场景 / ORDER_STATUS 13态 / normalizeStatus 点转下划线）
4. miniprogram/config/index.js — CONFIG 常量（WITHDRAW / ORDER / TENCENT_MAP_KEY）

【场景白名单 SSOT 链路】
admin_config.scene_list 是唯一可信源，当前 5 个活跃场景: W1就医陪诊 / W2学习陪伴 / W8生活协助 / W10出行陪伴 / W11线上陪伴，每个 scene 对象含 code/name/options/disclaimer_type/aa_default。
动态读取者: home-action / demand-publish / partner-apply / partner-action / blog-action（均用 getSceneCodes() 带缓存 + SCENE_CODES_FALLBACK=['W1','W2','W8','W10','W11'] 兜底）
前端侧 SSOT: miniprogram/config/enums.js SCENES[5] + miniprogram/utils/constants.js SCENE_LIST[5]

【已完成的硬编码修复（不要重复审查）】
- partner-apply/partner-action: SCENE_WHITELIST 8→动态读 admin_config（commit 18f2791）
- wallet.js: SCENE_NAMES 从 SCENES 动态构建（commit 3c39e0d）
- blog-action: 补全 getSceneCodes() 调用点，修复运行时 bug（commit aab1de8）
- partner-action: DEFAULT_EXAM_SCORES + ['W1'] 兜底 → 动态构建（commit ae8bfca）
- init-db: 种子加 disclaimer_type + 字段级迁移比对升级（commit ae8bfca）
- demand-publish/order-create: 免责声明类型优先读 admin_config.scene_list[].disclaimer_type，fallback 硬编码（commit ae8bfca）

【LEGACY 硬编码可接受约定（带 _LEGACY 后缀或注释说明仅用于旧数据兼容）】
- demand-publish: SCENE_WHITELIST_LEGACY / DISCLAIMER_TYPE_MAP / SCENE_OPTIONS_FALLBACK（8场景，兜底映射）
- home-action: SCENE_NAMES_LEGACY（8场景，历史订单显示名）
- order-action 局部 / im-send / im-conv / payment-mock: SCENE_NAME 局部变量（8场景显示名兜底）
- 腾讯地图 Key 两处（partner-action L33 + config/index.js L61）: 密钥分发可接受

【免责声明类型映射（已动态化）】
demand-publish 和 order-create sign_disclaimer 现在: 优先读 admin_config.scene_list[].disclaimer_type，fallback 本地硬编码，最终 fallback 'general_disclaimer'。W1→medical / W2,W8,W10→general / W11→online。
⚠️ 云端 admin_config.scene_list 可能还未带 disclaimer_type 字段，需手动跑一次 init-db（init-db 已升级字段级比对迁移逻辑）

【业务红线速查】
- 订单状态机 13 态: S0待支付 / S1待确认 / S2已支付待履约 / S3履约中 / S3.5履约中断 / S4部分完成 / S5已完成 / S6已取消 / S7已退款 / S8已评价 / S9评价超时 / S10已关闭 / S10.5争议处理中（enums.js 是 SSOT，normalizeStatus 点转下划线）
- 超时规则: S1 15min→S6 / S0 30min→S6 / S3.5 24h→S4 / S5 48h未评价→S9默认4星
- 信用分: 初始800/满分1000/及格600/冻结400，<600禁下单接单，<400冻结
- 四确认: 时间/地点/内容/费用四项，双方各确认一次共8位，任一项修改全重置
- IM 前置限制: 四确认前仅系统模板消息，禁止自由文本+联系方式交换；四确认后开放，每条安全检测
- AA 费用: 平台不代收，必须弹窗+勾《线下费用自理承诺书》，4档位 0-50/50-200/200+/自定义
- 青少年保护: 18-22岁单笔≤200元，服务端校验
- 模拟支付: 无真实微信支付，走 payment-mock，is_mock=true，收银台须显著提示
- 紧急求助 MVP: 写 platform_event(P0) + wx.makePhoneCall 一键拨号 + 标记订单，不做真实报警
- 需求发布: 必须含不可篡改实时精确定位 + publish_distance_max_km（默认50km）距离校验；定向邀约不入广场
- 订单详情履约阶段(S2/S3/S3.5/S4)必须显示 Safety Center（紧急求助+安全报备按钮）

【数据库集合（跨用户一律走云函数，前端禁止直查）】
user_account / partner_profile / demand / order_main / order_confirmations / order_status_log / pay_transaction / im_conversation / im_message / safety_report / credit_score_log / emergency_contact / evaluation / settlement / platform_event / admin_config（所有文档含 created_at/updated_at 毫秒时间戳 + is_deleted）

【代码规范红线】
- resolveOpenid: 所有云函数开头必须 const openid = await resolveOpenid(cloud, event)
- openid.js 复制到每个云函数目录
- mock_openid 守卫: 必须 admin_config.env === 'dev' 才允许
- admin_openids: 从 admin_config 读，禁止硬编码兜底（fail-closed）
- auto_approve_partner: prod 必须 false
- 金额: 整数分存储，total_fen 服务端重算，前端禁止直接写金额
- order_id: 接受 32 位 hex _id 和 ORD 开头 order_no
- cloudbase aggregate: 必须 .aggregate().match(cond) 不是 .where().aggregate()
- 登录态: Storage key v2_login_ok，不是 openid
- packOptions.ignore: 之前误配 pages 目录导致 v1 旧页面无法注册 app.json，已删除勿复加
- wx.requirePrivacyAuthorize 不存在，用官方隐私弹窗
- wx.showModal confirmText/cancelText 超 4 字符真机静默失败
- WXML 不能 wx:for+wx:elif 同一元素，用 block wx:elif 嵌套
- WXSS 禁止 UTF-8 BOM(EF BB BF)
- koa-connect wrapper 有 ctx leak，用原生 Koa middleware
- 敏感信息脱敏: phone/idcard 掩码(138****1234 / 5101**********1234)，只存不回传
- msgSecCheck 强制: 所有自由文本入库前校验，不可用时降级本地词库（config.block_words）
- 云函数统一返回 {ok:true, data} / {ok:false, code:'模块_原因', msg:'中文提示'}；写操作幂等
- UI 常量: 主色 #07C160 / 卡片圆角 14px / 绿色阴影发布按钮；所有业务参数从 config/index.js 读，禁止硬编码
- 内容安全: 所有写操作（发布/IM/评价）的自由文本入库前必须 msgSecCheck，不可用时降级本地词库

【云函数超时配置】
order-action/order-create/demand-publish/demand-match 20s；payment-mock 10s；user-login/partner-action/safety-report/evaluation-submit/home-action/admin-action/im-send/im-conv/blog-action 8s；order-timer 60s

【MVP 禁做清单（遇到需求一律做占位，不许真做）】
真实微信支付/分账、人脸核验、TRTC 音视频、AI 心理危机预警、保险真实投保理赔、短信验证码、真实退款打款、机构/B端全套、智能派单算法、代收 AA 费用。占位规范: 入口按钮可点，点击 toast「功能升级中，敬请期待」，云函数返回 ok:false code:PLACEHOLDER

【部署命令模板（单函数，不支持逗号分隔）】
& "<微信开发者工具cli.bat路径>" cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <函数名> --project "<项目根>" --remote-npm-install

【测试账号】
- Admin: oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c（需 admin_config.admin_openids 中有）
- Partner: test_partner_001 (exam_scores 100)

【备份铁律（重大改动前后必须三重备份 + 完整性检查）】
1. GitHub push → git log origin/master..HEAD 确认无未推送
2. Git Bundle → git bundle create zhaoren_v<版本>_<YYYYMMDD>.bundle --all → git bundle verify + 临时 clone + commit/tag hash 比对
3. robocopy 热备份 → robocopy <src> <dst> /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 → SHA256 逐文件比对，核心文件 0 差异 0 缺失

【剩余可选优化（低优先级，不阻塞）】
- P2: 跑一次 init-db 让云端 admin_config.scene_list 带上 disclaimer_type
- P3: blog-action TOPIC_WHITELIST 与 constants.js BLOG_TOPICS 双写
- P3: v1 旧页面 user-home.js SCENE_MAP 硬编码
- P3: 前端 publish 页场景选项动态读 admin_config（前端 enums.js 作为前端侧 SSOT 已足够）

【新电脑初始化检查】
- 安装微信开发者工具 + 获取 cli.bat 路径
- Git 配置 user.name / user.email
- git clone https://github.com/510721314-lang/zhaoren.git
- 微信开发者工具登录 + 设置 AppID + 绑定云环境 cloud1-d9gkefwcp5c777088
- 添加 https://apis.map.qq.com 到 request 合法域名
- 跑一次 init-db（GUI 云函数测试面板）确保 admin_config 种子完整

请确认你已理解，然后告诉我接下来要做什么。
```
