# 提审前门禁与风险点清单 SOP

> 适用场景：每次 commit 前 / 部署前 / 提审打包前跑门禁序列；提审前静态对齐（v1 死链、违规文案、协议死链、admin_openids 兜底）与人工抽验。

## 前置条件

- Node 环境可用（CI 用 node 22），脚本全部零依赖
- 门禁脚本（磁盘真实存在，**以 `package.json` `verify:offline` 的 8 脚本链为准**）：`scripts/check-syntax.js`、`scripts/check-ssot.js`、`scripts/check-shared-sync.js`、`scripts/check-require-scope.js`、`scripts/check-handlers.js`、`scripts/check-index-ledger.js`、`scripts/check-deploy-config.js`、`scripts/check-manual-links.js`；另有 `scripts/check-nightmask.js`（夜间蒙层）单独跑
- 冒烟脚本：`.predeploy/smoke-check.ps1`（改密钥后须先 `$env:AWK_KEY=<新钥>`）

## 步骤（门禁全序列，必须全部通过才可交付/提交）

```powershell
# 1. 合规静态门禁链（8 脚本 + 单测，顺序执行；与 package.json verify:offline 一致）
npm run verify:offline              # exit 0；链式执行下列 8 脚本 + npm test
#   check-syntax → check-ssot → check-shared-sync → check-require-scope
#   → check-handlers → check-index-ledger → check-deploy-config(--offline)
#   → check-manual-links → npm test（546 条单测全绿 + A/B 等价 437 例·34 known）
node scripts/check-nightmask.js     # exit 0（夜间蒙层；独立于 verify:offline）

# 2. 网关冒烟（只读/幂等探针；exit 0 = SMOKE ALL PASS）
powershell -ExecutionPolicy Bypass -File .predeploy/smoke-check.ps1

# 3. CI（GitHub Actions，push master 自动跑单测 + 语法全检 + 共享模块校验）
#    .github/workflows/ci.yml；推送用直连：git -c http.proxy= -c https.proxy= push origin master
```

- `smoke-check.ps1` 实际探针：`config_public`（tip_enabled=true / switch_access=true / 红线 360/1440）、`home_probe_square`（list≥10）、`home_probe_system_notice`（system_notice 集合可读）
- regression checklist 另列核验项：`seed_scene_demands`（created=0 且 skipped≥48 幂等）

## 人工抽验（按改动相关性，不必全跑）

抢单（连点防抖）、四确认→支付→开始履约、改期确认即时通知（≤8s）、聊天页订单动态（≤5s）、打赏按钮与逐笔明细、钱包双专栏、首页空路径兜底、夜间红线、双模式 UI 可读。

## 提审前静态审计已知风险点（R1-R4，含 2026-10-20 核查状态）

1. **v1 页面死链（2026-10-20 核查 ✅ 无死链）**：app.json `pages[]` 已**全为 `pages-v2/*`（零 v1 注册）**，`miniprogram/pages/` 目录已不存在，全仓无 v1 路径引用。审计用 `url:\s*['"]/pages/[a-z]`（ripgrep 不支持 lookbehind/前瞻，`/pages/(?!v2)` 会直接报错）
2. **模拟支付/测试期违规文案（2026-10-20 核查 ⚠ → 当日整改 ✅ 已中性化；云端待部署生效）**：**整改落地（commit `ab54aab`）**——`realname.wxml:42`「测试期 · 模拟核验」→「人脸核验」、`:44` 去「（测试期模拟）」、`realname.js:61` 统一「人脸核验」、`:129-131` modal 标题/正文/`confirmText`（「模拟通过」→「确认」）、`config/index.js:94` 与 `user-login/index.js:129` 服务协议兜底去「测试期精简版」、`action_account.js:260`／`payment-mock/index.js:161` 关闭分支 msg 去「模拟」。复验：`miniprogram`＋`cloudfunctions`（排除 `_orig_baseline.js`）检索 `模拟\|测试期` **仅剩注释 8 行、0 处用户可见值**。**核查原态（留档）**：`pay.wxml:4` / `pay.js:126` / `pay.wxss:6` / `config/index.js:89` 命中**全为注释**且注明「不出现内测/模拟字样」；`admin/finance.wxml:10` 显示值已中性化（`is_mock ? '平台担保'`）。**风险（提审包内用户可见 live）**——`pkg-low/realname`：`realname.wxml:42`「测试期 · 模拟核验」、`:44` 按钮「（测试期模拟）」、`realname.js:61`「模拟人脸核验（测试期）」、`realname.js:130-132` modal 标题/正文/`confirmText`「模拟通过」（`faceMode='mock'` 时可见；`config/index.js:90` 兜底即 `mock`，云端 `realname.face_mode` 现值需另行核对）；另 `config/index.js:94` 兜底服务协议含「测试期精简版」、云端关闭分支 msg「模拟认证已关闭」(`user-login/action_account.js:260`)/「模拟支付/提现功能已关闭」(`payment-mock/index.js:161`)。**原条目引用已过时**：`pay.js` toast「模拟支付成功」不存在，v1 `agreement.wxml` 随 v1 目录删除已不存在。微信易判违规
3. **协议页可达 + 隐私政策（2026-10-20 核查 ✅ 已迁 v2）**：login/pay 实际跳 `/pages-v2/agreement/agreement`、`/pages-v2/privacy/privacy`（均注册为分包、页面存在；原「跳 `/pages/agreement` `/pages/privacy` 是 v1 死链」的描述已过时）。微信要求登录可见隐私政策 + 用户协议 → login 页已有双入口，剩余实项＝**真机目视确认**入口可见
4. **admin_openids 兜底**：云端数组为空时后台靠 RBAC 会话运转，建议补录首个管理员真实 OPENID 保旧路径兜底

## 验证

- 静态检查 exit 0、`npm test` 546 条全绿（A/B 437·34 known）、smoke `SMOKE ALL PASS`
- 云函数 action 分派两种写法都要覆盖审计：`demand-publish` 用 `case 'x':`（switch），`order-action` 用 `if (action === 'x')`

## 坑

- 违规文案核查要命中均为**注释**才算合规
- WXSS 不支持 `*` 通配；样式改后须重编译/重传体验版生效
- 微信要求登录可见用户协议 + 隐私政策，改协议死链时不能只删注册
- `wx.showModal` confirmText >4 字符在真机静默失败（v1 `demand-publish`「我已阅读并同意」7 字、admin「标记已解决」5 字是同款地雷）

## 正式发布当天操作清单（提审通过、版本发布为正式版之后）

> 与上方「提审前」清单的时序区别：以下项目**必须等正式版发布成功后再做**，提前做反而出错。

1. **订阅消息 miniprogram_state：trial → formal（两个模板都要改）**
   - 背景：提审前无正式版，`demand_grab`（抢单提醒）/`demand_urge`（催办提醒）两模板按 2026-10-09 定论统一配 `trial`；无正式版时用 `formal` 推送微信侧有 41030 风险。正式版发布后须改回 `formal`，否则正式版用户可能收不到订阅服务通知。
   - 操作（二选一）：
     - admin-web 运营后台订阅消息模板配置项，把两个模板的 miniprogram_state 改为 formal 保存；
     - 或经 HTTP 网关调 admin-action（X-Admin-Key 鉴权），config_set 对 `sub_msg_templates` 是逐模板浅合并（[action_config_set.js:194-204](../../cloudfunctions/admin-action/action_config_set.js)），只传 state 不会覆盖 tmpl_id：
       ```json
       {"action":"config_set","sub_msg_templates":{"demand_grab":{"miniprogram_state":"formal"},"demand_urge":{"miniprogram_state":"formal"}}}
       ```
   - 验证：①网关 config_get 复核 `sub_msg.demand_grab/demand_urge.miniprogram_state` 均 = formal；②真机触发一条真实订阅（抢单提醒或催办）确认微信「服务通知」送达。
   - 回退：送达异常时改回 `trial`（同法只改这两个 state 键）。
   - 现值（2026-10-15 实测）：两模板均为 `trial`。