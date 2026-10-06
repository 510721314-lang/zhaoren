# 提审前门禁与风险点清单 SOP

> 适用场景：每次 commit 前 / 部署前 / 提审打包前跑门禁序列；提审前静态对齐（v1 死链、违规文案、协议死链、admin_openids 兜底）与人工抽验。

## 前置条件

- Node 环境可用（CI 用 node 22），脚本全部零依赖
- 门禁脚本（磁盘真实存在）：`scripts/check-nightmask.js`、`scripts/check-ssot.js`、`scripts/check-syntax.js`、`scripts/check-shared-sync.js`
- 冒烟脚本：`.predeploy/smoke-check.ps1`（改密钥后须先 `$env:AWK_KEY=<新钥>`）

## 步骤（门禁全序列，必须全部通过才可交付/提交）

```powershell
# 1. 合规静态检查（zhaoren-audit 要求，顺序执行）
node scripts/check-nightmask.js     # exit 0
node scripts/check-ssot.js          # exit 0
node scripts/check-syntax.js        # exit 0（全部云函数 node --check 解析）
node scripts/check-shared-sync.js   # exit 0（共享模块防漂移哈希校验）
npm test                            # 108 条单测全绿（node:test 零依赖）

# 2. 网关冒烟（只读/幂等探针；exit 0 = SMOKE ALL PASS）
powershell -ExecutionPolicy Bypass -File .predeploy/smoke-check.ps1

# 3. CI（GitHub Actions，push master 自动跑单测 + 语法全检 + 共享模块校验）
#    .github/workflows/ci.yml；推送用直连：git -c http.proxy= -c https.proxy= push origin master
```

- `smoke-check.ps1` 实际探针：`config_public`（tip_enabled=true / switch_access=true / 红线 360/1440）、`home_probe_square`（list≥10）、`home_probe_system_notice`（system_notice 集合可读）
- regression checklist 另列核验项：`seed_scene_demands`（created=0 且 skipped≥48 幂等）

## 人工抽验（按改动相关性，不必全跑）

抢单（连点防抖）、四确认→支付→开始履约、改期确认即时通知（≤8s）、聊天页订单动态（≤5s）、打赏按钮与逐笔明细、钱包双专栏、首页空路径兜底、夜间红线、双模式 UI 可读。

## 提审前静态审计已知风险点（R1-R3 需核对）

1. **v1 页面死链**：app.json `pages[]` 是否仍注册 v1 页（`user-home`/`blog`/`blog-detail`/`blog-publish`/`agreement`/`privacy`/`partner-home`）会混入提审包。审计用 `url:\s*['"]/pages/[a-z]`（ridgrep 不支持 lookbehind/前瞻，`/pages/(?!v2)` 会直接报错）
2. **模拟支付违规文案**：「模拟支付/MVP测试版」文案出现在 `pay.js` toast「模拟支付成功」、v1 `agreement.wxml`「MVP 测试版…模拟支付」、`admin/finance.wxml`，微信易判违规
3. **协议死链 + 隐私政策**：login/pay 跳 `/pages/agreement` `/pages/privacy` 是 v1 死链，但微信要求登录可见隐私政策 + 用户协议 → 需 v2 协议页或 modal
4. **admin_openids 兜底**：云端数组为空时后台靠 RBAC 会话运转，建议补录首个管理员真实 OPENID 保旧路径兜底

## 验证

- 静态检查 exit 0、`npm test` 108 条全绿、smoke `SMOKE ALL PASS`
- 云函数 action 分派两种写法都要覆盖审计：`demand-publish` 用 `case 'x':`（switch），`order-action` 用 `if (action === 'x')`

## 坑

- 违规文案核查要命中均为**注释**才算合规
- WXSS 不支持 `*` 通配；样式改后须重编译/重传体验版生效
- 微信要求登录可见用户协议 + 隐私政策，改协议死链时不能只删注册
- `wx.showModal` confirmText >4 字符在真机静默失败（v1 `demand-publish`「我已阅读并同意」7 字、admin「标记已解决」5 字是同款地雷）