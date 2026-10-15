# 前端两大文件拆分方案（审定稿 v2.1）

> 日期：2026-10-15（v2.1 = 第二轮双审修订版）　状态：**已过两轮双专家交叉评审，待立项；代码未动**
> 对象：`miniprogram/pages-v2/order-detail/order-detail.js`（1692 行）、`miniprogram/pages-v2/publish/publish.js`（1296 行）
> 关联：技术债台账 P2-1/P2-2（`docs/tech-debt-inventory-20261015.md`）；规则 §1/§2/§4/§5/§10
> 评审：两轮双代理独立审定（代理 A 事实核验 / 代理 B 完整性偏离）+ 主审 grep/读码复核。v2：2/2 确认 3 项、修正 6 项、裁定伪矛盾 1 项；**v2.1：主审坐实必修 5 项（含阶段 2a 能力链路误标）、采纳建议 3 项、证伪 1 项（§6.5）**

## 0. 结论与定性

- 方向成立：两文件用同一路径「**纯函数外移补 node 测试 → 无 UI 服务模块 → wxml 卡片组件化**」，页面只留 data/生命周期/写操作 handler/跳转。
- v1（对话内初稿）经评审发现 6 处事实错误、1 处时机违规、10 项执行前置缺失，v2 已全部修正；v2.1 经第二轮复审又纠正「阶段 2a 把含 wx 能力链路的方法误标为无机可做的纯计算」等高风险归类错误（详见 §6.5）。
- 目标行数**不作承诺值**，改分阶段实测里程碑（§4），并已补齐里程碑与子阶段的映射。
- 「两套授权签字合一」属于**有限改写**，不适用「函数体逐字搬」，须单列审批（§3 文件2 阶段4b）。
- 时机口径（2026-10-15 用户拍板「提审时间无限制」）：不再以提审通过为门禁，但仍受两道实质前置约束——① @VERIFIED 函数搬迁逐函数书面批准（规则 §2）；② 含 wx 能力链路的阶段（定位/上传/SOS/签字/轮询）必须真机就位。**无机期最多执行阶段 1 + 阶段 2a 的纯函数小段**（两者均无 wx 依赖，node 可测 + 开发者工具编译回归即可）。

## 1. 现状实测（2026-10-15，HEAD=e45aa52）

| 文件 | 行数 | data 字段 | 结构富矿 |
|---|---|---|---|
| order-detail.js | 1692 | 40 | refreshOrder 视图映射 L316-554；证据采集链 L823-1063；写操作 handler 群 |
| order-detail.wxml/.wxss | 470/313 | — | 15 张边界清晰卡片；操作区 L203 起按 S0~S10 分块 |
| publish.js | 1296 | 63 | 顶层纯函数 L14-64；validatePublish L1079-1134；宠物/委托授权各 8 方法 |
| publish.wxml/.wxss | 309/577 | — | B2-B12 分节 + 4 弹层 + 2 签字浮层 |

有利条件：① `utils/order-view.js`、`utils/geo-guard.js` 已有从页面抽纯函数的先例；② `miniprogram/components/` 现有 **20 个**组件（bottom-sheet/signature-canvas/order-progress 等，其中 ui-button/ui-empty/ui-skeleton/ui-tag 4 个已显式 `apply-shared`）；③ 前端纯函数测试基建**已存在**——`cloudfunctions/_shared/geo_guard.test.js`、`order-view.test.js` 已跨目录 `require('../../miniprogram/utils/...')` 并在根 `npm test`（node --test）扫描范围内，**无需新建测试套件、无需改 `npm run verify` 8 项门禁**；④ 两页面均在**主包**（app.json pages），新组件只能放主包。

**主包体积实测（第二轮补）**：`miniprogram/` 全量 **1281.1 KB**（pages-v2 818.4 / components 336.1 / utils 48.8 / 其余 config/mock/styles/custom-tab-bar/images 共约 79），距主包 2MB 上限余量约 **700 KB**。本方案组件化是页内 wxml/wxss 重排（原卡片样式随组件迁走，页面 wxss 同步缩小），新增的仅为组件包装 JSON/JS 骨架，单组件预估 1–3 KB；service/utils 纯模块增量已被页面减量对冲。**结论：体积不构成立项约束**，但每阶段提交后由 IDE「代码依赖分析」读主包实际体积并回填本文件。

## 2. 手段选型

| 手段 | 用途 | 克制点 |
|---|---|---|
| utils 纯函数模块 | 映射/校验/格式化，node:test 直接测 | 模块内禁依赖 wx 全局，否则 node 跑不了 |
| 无 UI 服务模块（函数接收 page） | 证据采集、轮询、逆地理、定位判定 | 禁 getApp()/globalData；只搬不改逻辑 |
| Component 卡片组件 | 边界清晰的 wxml 卡片 | 展示型先行；写操作一律 triggerEvent 回页面，组件内不 callCloud 推进状态、不 uploadFile |
| Behavior mixin | 不用于「只为切文件」 | 隐式 this 合并难排查 |
| wxml include | 不采用 | 纯切文件无隔离，治标不治本 |

## 3. 修正后切分蓝图（行号锚点 = 2026-10-15 / HEAD e45aa52；续作重新定位规则见 §5.10）

### 文件 1：order-detail.js

| 阶段 | 搬出内容（方法 + 行号） | 去向 |
|---|---|---|
| 1 纯函数（无机可做） | refreshOrder 映射主体 L316-554；buildModifyTs L1362；fmtDate L642（先与 util.js / order-view.js 三处重复 pad 一并去重） | 扩 `utils/order-view.js`（现仅导出 computeNextStep/pad） |
| 2a 纯函数小段（无机可做） | **仅** onViewPrep 内倒计时文案计算段 L679-687（startTs/diffMin/diffStr，约 9 行）抽为 `buildPrepCountdown(o, now)` | `utils/order-view.js`。**onViewPrep 的 wx.showModal/wx.showActionSheet 编排与催办 `callCloud('order-action', nudge_partner)` 写操作 L689-737 永久留页面**（v2.1 纠正：v2 误把整个 onViewPrep 标为纯计算） |
| 2b 定位 + 证据链（**需真机**） | **_evalFulfillGeo L741-765**（内含 `wx.getLocation` L750 + setData geoGuard，v2.1 从 2a 移入：属定位能力链路不是纯计算）；证据链**五方法**：_collectStartLocation L823、_collectStartEvidence L937、_addrOf L977（v1 误写 reverseGeocode，本页无此函数；与 publish.js reverseGeocode L44-64 同构的是 _addrOf）、**_uploadStartPhotos L996（53 行，v1 漏列）**、_uploadEvidenceOne L1051（**全文件唯一 `wx.cloud.uploadFile` 直接调用点在其体内 L1055**，_uploadStartPhotos 经 `this._uploadEvidenceOne(j)` L1027 间接上传） | _evalFulfillGeo + _addrOf → `utils/geo-wx.js`（接收 page）；证据采集/上传 → `utils/order-evidence.js` |
| 2c 定时器（**需真机**） | clearTimers/startTipPoll/stopTipPoll/onTipNoticeTap/startCountdown/__fmtNoticeTime/fetchTipList **L556-672（约 117 行，v2 误写 675/105 行）**；onHide/onUnload 既有 clearTimers 调用点不动 | `utils/order-poll.js`（接收 page，禁 getApp） |
| 3 展示组件 | 资金费用卡 wxml L150-168 → 留痕卡 L96-118 → 时间线（fetchTimeline L211）→ 投诉/争议/保险卡 L119-149，逐卡独立提交 | `components/` 四个 |
| 4 交互组件（**需真机**） | 爽约申诉卡 L170-202（handler 仅 onNoShowReport L234 / onNoShowDefense L250 / onNoShowWithdraw L260 **三个，无 onNoShowPreview**）；安全中心卡 L79-95 + onSafety L1064 / onSos L1078 / _submitSos L1108 / _showCallSheet L1140-1184 | `components/`，triggerEvent 回页面写 |
| 留页面 | data/生命周期/fetchData/_modal/_handleConflict/**onViewPrep 弹窗与催办编排 L689-737**/全部 order-action 写 handler/goPay/goChat/13 态操作区 wxml L203+ | — |

### 文件 2：publish.js

| 阶段 | 搬出内容（方法 + 行号） | 去向 |
|---|---|---|
| 1 纯函数（无机可做） | detectSensitive L14 / haversineKm L24 / pad2 L34 / fmtDist L37；validatePublish **L1079-1134**（v1 写 1137 误）；_defaultDisclaimer L765；_buildDraftData L397；_isPhoneOrLandline L625 | `utils/publish-validate.js`；validatePublish 签名 `(form, ctx)`，ctx 对象打包 10+ 校验字段，禁长参数表 |
| 2 定位 + 逆地理（**需真机**） | _locatePublish L922 / _offerManualPick L987 / onLocationPick L825 / onRelocatePublish L1013；**reverseGeocode L44-64（v2.1 补列：内含 `wx.request` L48 腾讯地图逆地理，key 空时降级返回空串）**，与文件1 的 _addrOf 在 geo-wx 内合一 | `utils/publish-locate.js` + `utils/geo-wx.js` |
| 3 草稿 | 草稿组 L390-494（含 fmtTime 等 7 方法），bottom-sheet 留页面 | `utils/draft-store.js` |
| 4a 组件化 | 场景选择组 L694-791 | `components/scene-option-sheet/` |
| 4b 授权合一（**有限改写，单列审批 + 真机**） | 宠物授权 **8** 方法 L520-603 + 委托授权 **8** 方法 L630-693（v1 写 7 误，含 _loadProxyAuthText L630）。新 `components/auth-sign-sheet/` 内部复用 signature-canvas（properties.tip；methods clear/isEmpty/exportPNG，已被 pet-sign/proxy-sign/realname 三实例验证）。**实质差异须保留**：① 文案来源——宠物由页面 callCloud('admin-action',config_public) 拉取（_loadPetAuthText L520），委托为本地硬编码（_loadProxyAuthText L630），合一后文案一律由 properties 传入，**各自来源不改**；② selectComponent id 不同；③ state 命名 pet*/proxy*。组件只管 canvas/弹层，`triggerEvent('sign-confirm',{tempFilePath,kind})`；**页面保留 onPetSignConfirm L561 / onProxySignConfirm L662 两 handler 负责 uploadFile + setData** | `components/auth-sign-sheet/` |
| 留页面 | data 63 字段/生命周期/onPublish L1037/_continuePublish L1058/confirmPublish L1138/_doPublish L1201-1331 发布主链 | — |

## 4. 行数里程碑（实测，非承诺）与子阶段映射

v1 目标值（760/640）经评审证伪（代理 A 按方法体加总测算 900-950 / 450-500，两方向偏差）。改为每阶段提交后实测回填，立项时以本表为准：

| 里程碑 | order-detail.js | publish.js | 对应 §3 子阶段（v2.1 补映射） |
|---|---|---|---|
| 当前 | 1692 | 1296 | — |
| 里程碑 1 后 | ~~≤1400~~ **≤1500（2026-10-15 用户按实测裁定；实测 1487 已达）** | ~~≤1150~~ **≤1220（2026-10-15 用户按实测裁定；实测 1215 已达）** | 文件1 阶段1+2a小段 + 文件2 阶段1（纯函数）。2026-10-15 C1/C2/C3 全部完成 |
| 里程碑 2 后 | ≤1200 | ≤1000 | 文件1 阶段 **2a+2b+2c** + 文件2 阶段 **2**（服务模块，全部需真机，2a 纯函数小段除外可先做） |
| 里程碑 3 后 | ≤1000 | ≤900 | 文件1 阶段3 + 文件2 阶段3（展示组件 / 草稿） |
| 里程碑 4 后 | ≤850 | ≤600 | 文件1 阶段4 + 文件2 阶段 **4a+4b**（交互组件 / 授权合一） |

注：2a 仅约 9 行纯函数可在无机期随里程碑 1 一并提交并计入里程碑 1 实测；2b/2c 未完成前不得宣称到达里程碑 2。
**里程碑 1 实测回填（2026-10-15，C1/C2/C3 收官）**：order-detail.js 非空行 1692→**1487**（−205），publish.js 1296→**1215**（−81）；原 ≤1400/≤1150 两阈值均证伪（纯函数存量已全部搬完，继续下降只能进入需真机的阶段 2，故按「实测非承诺」上调而非提前搬能力链路）；node 单测 438→**484**（+46）。

## 5. 统一门禁（每阶段独立 commit、独立回归）

1. **@VERIFIED 审批（规则 §2）**：order-detail.js L1 文件级标记、onStartService 函数级 **@VERIFIED 注释在 L767、函数头在 L768（v2.1 消歧）**。被搬函数逐函数列「搬迁理由 + 向后兼容（页面留薄代理或调用点全替）+ 书面批准」；迁入处保留原 @VERIFIED 标记并注来源 commit。
2. **函数体逐字搬迁**：原注释保留、标注新位置；不顺手优化写法、不清理看不懂的分支；发现既有问题只登记（规则 §1/§7）。例外仅 §3 文件2 阶段4b（已单列）。
3. **setData 路径化前置（v2.1 加严）**：阶段 3 开始前，refreshOrder 末尾整对象 setData（order-detail.js L497-511，一次 14 字段）、publish 恢复草稿 `setData({form})`（publish.js L505）改路径写法——行为不变，保证组件 properties 切片收到变更。**此步必须独立于搬迁单独 commit、单独专项回归**：对比改前改后渲染结果与 Console（无字段丢失、无多次冗余渲染、无时序差异导致的闪现/置空），禁止与任何函数搬迁混在同一提交。
4. **json 注册与样式（规则 §3 逐项书面批准）**：每组件附 order-detail.json / publish.json 的 usingComponents 增量 diff；新组件显式 `"styleIsolation":"apply-shared"`（现有 20 组件中 4 个已用此惯例），wxss 随组件迁走，**禁入 app.wxss**。
5. **组件契约**：properties 只读切片；callCloud 推进状态与 wx.cloud.uploadFile 一律留页面，组件只出临时路径/事件。order-detail.js 全文件 uploadFile **唯一直接调用点是 _uploadEvidenceOne L1055**（_uploadStartPhotos 仅经它间接上传）；SOS/爽约均无上传（评审证伪的伪矛盾，勿再设上传边界讨论）。
6. **测试**：新纯函数测试照 `cloudfunctions/_shared/geo_guard.test.js` 先例放 `_shared/` 跨目录 require，自动纳入 `npm test`（只增不减）；**不动 `npm run verify`**。fixture 只用 TESTMODE 造单：手机号→13800000000、openid→占位串、坐标偏移 ±0.01，禁生产 dump。
7. **双重验证 + 门禁盲区（v2.1 补）**：node 测试通过 ≠ 小程序编译通过——每搬完一组开发者工具编译一次 + Console 无 require 报错（无机可做，2 分钟）；阶段 2/4 另附 iOS+Android 真机回归（定位/拍照水印/上传/SOS/签字/轮询）。**注意 `npm run verify` 的 check-syntax 不覆盖 `miniprogram/` 目录（既有门禁盲区），verify 全绿不代表前端改动被校验过**——前端改动的最低自证以「开发者工具编译 EXIT 0 + 源码回读」为准，不得以 verify 通过代替。
8. **服务模块纪律**：禁 getApp()/globalData（cloud.js/bootstrap.js/redline.js 的用法是反例），跨页状态走参数与返回值。
9. **publish 清理回归**：服务化后专项「填半页 → navigateBack → 重进」，核查 onUnload（现仅清 _saveTimer，函数约 L376-378）无定时器/定位回调泄漏。
10. **回滚粒度与续作锚点（v2.1 新增）**：
    - **提交粒度**：一张表行（或一组同构方法）一个独立 commit，提交信息写清「从 X 搬至 Y、行为等价」；任何一组编译/真机不过，`git revert <该组 commit>` 即可干净退出，禁止跨阶段/跨组混提交导致无法单独回退。
    - **行号漂移处理**：本方案全部行号仅为 **2026-10-15 / HEAD e45aa52** 锚点。任一阶段提交后行号必然漂移，**续作时禁止凭旧行号直接下刀**，一律以「函数名 + 签名」重新定位：`git show e45aa52:miniprogram/pages-v2/order-detail/order-detail.js` 对照基线，再在当前文件 grep 函数头确认新位置，定位结果写入当次提交信息。
    - **行数回填**：每阶段 commit 后实测两文件行数并回填 §4 表，作为里程碑到达的唯一判据。

## 6. 评审留痕

### 6.1 2/2 双确认（已采纳）
1. 目标行数拍脑袋 → 改里程碑（§4）。
2. 「逐字搬」与「授权合一」矛盾；pet 文案云端拉取 / proxy 本地硬编码差异 → 合一定性有限改写，差异走 properties、两 handler 留页面。
3. 能力链路无真机不能搬（REGISTRY 25 项待验证，评审当时计数）→ 无机期只搬纯计算。

### 6.2 代理 A 单方提出、主审 grep 全部证实的事实修正
- order-detail.js 无 reverseGeocode（应为 _addrOf L977）；无 onNoShowPreview；证据链漏 _uploadStartPhotos L996；_evalFulfillGeo 起点 L741（非 676）；委托授权 8 方法（非 7）；validatePublish 终于 L1134。
- 基建修正：前端纯函数测试已在 `_shared/*.test.js` 跨目录运行，阶段 0「新建套件」取消。

### 6.3 代理 B 单方提出、主审采纳的前置补充
时机前置、@VERIFIED 审批流、usingComponents diff、styleIsolation、setData 路径化、npm verify 不接入、fixture 脱敏、ctx 参数打包、编译回归、服务模块禁 getApp、publish onUnload 回归（已全部并入 §0/§5）。

### 6.4 裁定伪矛盾
「组件不 callCloud 与爽约/SOS 举证上传冲突」——实测 SOS（_submitSos）只有定位+callCloud、爽约入口跳独立分包页，本页均无上传；边界统一为 callCloud/uploadFile 留页面（§5.5）。

### 6.5 第二轮双审（v2.1，2026-10-15）
**主审读码坐实的必修 5 项：**
1. **阶段 2a 能力链路误标（高）**：v2 把 onViewPrep / _evalFulfillGeo 整体标为「纯计算·无机可做」。主审实读——_evalFulfillGeo L750 调 `wx.getLocation`；onViewPrep L689/L704/L716 含 showModal/ActionSheet + `callCloud('order-action', nudge_partner)` 写操作。已改为：2a 只抽 L679-687 倒计时纯函数；_evalFulfillGeo 移 2b；onViewPrep 编排永久留页面（§3 文件1）。
2. **publish reverseGeocode 漏列（高）**：L44-64 逆地理（wx.request L48）在文件2 阶段表无归属，仅文件1 提「同构」。已补入文件2 阶段 2，与 _addrOf 合一进 geo-wx（§3 文件2）。
3. **uploadFile 归属措辞不实（中）**：唯一直接调用点是 _uploadEvidenceOne L1055，非 _uploadStartPhotos。§3/§5.5 已修正。
4. **里程碑无子阶段映射（中）**：§4 已补「里程碑 ↔ 2a/2b/2c、4a/4b」映射列。
5. **缺回滚/续作锚点、setData 路径化缺独立提交（中）**：新增 §5.10；§5.3 加严为单独 commit + 专项渲染回归。

**采纳的建议 3 项：** 轮询组范围更正为 L556-672 约 117 行（v2 写 675/105）；onStartService 注释 L767/函数头 L768 消歧；补主包体积实测 1281.1 KB（§1）与 verify 不覆盖 miniprogram/ 的盲区提示（§5.7）。

**证伪 1 项：** B 称 v2「五层递进」名实不符——主审全文 grep 确认 v2 文档正文无「五层」字样（三层手段：纯函数→服务模块→组件），该指摘不成立，仅登记不修；CHANGELOG 落盘记录中出现过的「五层递进」用词同步更正为「分阶段」。

## 7. 立项检查清单（开工前逐项勾）

- [x] 主包体积实测：1281.1 KB / 余量约 700 KB，组件化增量不构成约束（§1）
- [ ] 用户书面批准本方案 + 首批阶段范围
- [ ] 被搬 @VERIFIED 函数的逐函数批准（规则 §2）
- [ ] 阶段 2b/2c/4（文件1）、阶段 2/4b（文件2）：真机环境就位（iOS+Android）
- [ ] 阶段 1 + 2a 纯函数段：开发者工具可编译自证 + _shared 新测试纳入 npm test
- [ ] setData 路径化已作为独立 commit 先行并完成专项渲染回归（§5.3）
- [ ] 每表行独立 commit、回滚粒度与「函数名重新 grep 定位」规则已读（§5.10）；涉及 json/utils 属规则 §3 项已逐次报批
- [ ] 收尾：更新 FUNCTION-REGISTRY、CHANGELOG，回填 §4 实测行数与 IDE 主包体积
