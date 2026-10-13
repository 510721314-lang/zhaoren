# 找人帮忙 · 技术负债整改最终交付报告

> 方案：`c:\zhaoren\.trae\documents\tech-debt-remediation-20261012.md`
> 执行周期：2026-10-09 ~ 2026-10-12
> 报告日期：2026-10-12

---

## 一、执行总览

按《技术负债整改实施方案 v2》分 6 批串行执行，逐批「门禁全绿 → 部署 → 提交 → 推送」。
全部 6 批已完成、已部署、已推送至 `origin/master`。

| 批次 | 主题 | 提交 | 状态 |
|---|---|---|---|
| 批 1 | 数据一致性闭环 | `7b028ef` | ✅ |
| 批 2 | 可观测与运维加固（`npm run verify` 一键门禁） | `719e274` | ✅ |
| 批 3 | 配置单一源（CONFIG_SCHEMA SSOT） | `520276f` | ✅ |
| 批 4.1 | dev_until fail-closed | `d0fbf6d` | ✅ |
| 批 4.2 | 网关会话令牌（X-Admin-Token） | `03ef256` | ✅ |
| 批 4.3 | 密钥轮换脚本 | `0cb60ef` | ✅ |
| 批 5.1/5.2/5.3/5.5 | A/B 基线、契约测试、_mock_sdk、admin-web 构建出库 | `95ce74f` | ✅ |
| 批 5.4 | order-detail 纯映射抽离 + 单测 | `b2eec51` | ✅ |
| 批 6.3/6.2/6.4 | 图片校验/生效提示/履约证据 | `cf63348` | ✅ |
| 批 6.1 | 订阅消息 HTTPS 通道（opt-in） | `c1dec2f` | ✅ |
| — | config_set 接纳 sub_msg_https | `a4581f0` | ✅ |
| — | 审计日志嵌套 secret 递归掩码 | `dba3a65` | ✅ |

---

## 二、门禁现状

```
npm run verify = check-syntax / check-ssot / check-shared-sync / check-handlers(115)
                 / check-index-ledger / check-deploy-config / npm test

结果：332 pass / 0 fail
A/B 等价：203 例（87 显式 + 116 自动），7 known-evolution，0 意外差异
```

---

## 三、批 6 详细交付

### 6.3 图片服务端校验
- `admin-action/action_misc.js` 新增纯函数 `readImageDims(buf)`，解析 PNG（IHDR）/JPEG（SOF 段）/WebP（VP8X/VP8）文件头。
- `upload_image` 在格式校验通过后、上传前校验：`use==='cover'` 且非 1:1 → 返回 `up_not_square`。
- 单测 `cloudfunctions/_shared/upload_image.test.js`（4 例）。
- 已部署 `admin-action`。

### 6.2 配置生效延迟提示
- `admin-web-frontend/src/api/admin.js` 响应拦截器对 `config_set` / `home_activity_*` 成功统一弹「配置已保存，约 5 分钟内生效」。
- 单点覆盖全部视图，免逐页改动。
- admin-web 已重建并部署。

### 6.4 占位区块收尾
- 保险卡：本就 `wx:if` 条件渲染，无数据自动隐藏。
- 时间戳：`pay_expire_at` / `service_started_at` / `service_completed_at` / `evaluated_at` 后端已完整写入并由 `detail` 回传。
- 履约里程碑证据：`order-detail.wxml` 新增证据图渲染 + 预览（复用 `onPreviewEvidence`）。
- 已随小程序 v1.1.0 上传。

### 6.1 订阅消息 HTTPS 推送（核心）
- 新增 `order-timer/push_https.js`：`stable_token`（带缓存）→ `subscribe/send` 直连微信；`postJson` 可注入单测，默认 `node:https`。
- `sendDemandSub` 按 `admin_config.sub_msg_https={appid,secret}` opt-in：已配置走 HTTPS，未配置回退 `cloud.openapi` 云调用，零破坏。
- 发送结果落 `demand.sub_msg_send_logs`，标注 `channel`（`https`/`cloud`）。
- 单测 `cloudfunctions/_shared/push_https.test.js`（4 例）。

**端到端验证（2026-10-12 22:13）：**
- 造 W1 测试需求 → 触发 order-timer → 两个已授权订阅耍伴均走 `channel: "https"`。
- 耍伴 `oLDJ73VE…`：`status: ok` ✅，微信「服务通知」真机收到「找个人帮忙 · 接单提醒」。
- 耍伴 `oLDJ73Yz…`：`status: fail, errCode 43101`（用户未订阅，属正常业务结果）。
- 测试数据已清理（测试需求 + system_notice）。

**安全加固：**
- `config_set` 审计日志（`config_history` + `platform_event`）改为递归掩码嵌套 `secret`/`key`/`token`，避免明文落库。
- 已用 tcb 把本次泄漏的两条历史记录修正为 `***`。
- `admin_config.sub_msg_https` 实时凭据完整，读回掩码。

---

## 四、部署与发布

| 资源 | 动作 | 结果 |
|---|---|---|
| admin-action | deploy | ✅ |
| admin-web | rebuild + deploy | ✅ |
| order-timer | deploy | ✅ |
| 小程序 | upload v1.1.0 | ✅ |
| git | push origin master | ✅ `42e521e..dba3a65` |

---

## 五、凭据与配置（生产态）

| 项 | 值/位置 |
|---|---|
| AppID | `wxbc4a4afacdf234f5` |
| AppSecret | `admin_config.sub_msg_https.secret`（掩码存储，不入 Git） |
| 订阅模板 | `sub_msg_templates.demand_grab.tmpl_id`（已配） |
| 消息推送回调页 | 未配置（出站推送不需要） |

---

## 六、遗留事项

1. **提审**：小程序 v1.1.0 已上传为开发版，需在微信公众平台提交审核 → 发布。
2. **运营文档**：方案 6.2 提及的「缓存与生效时延」运营文档章节，如需补充可后续追加。
3. **A/B 基线**：当前 7 处 known-evolution 为有意演进，后续重构需同步更新基线。

---

## 七、结论

《技术负债整改 v2》6 批全部交付，门禁 332 pass，核心服务端推送通道经真机验证可用，代码已推送远端。系统可进入提审发布流程。
