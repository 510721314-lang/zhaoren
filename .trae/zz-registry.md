# ⚡ 临时/调试云函数登记表（zz-registry）

> 用途：登记所有调试类临时云函数，供 `.trae/cloudfunctions.whitelist` 与
> `.trae/predeploy.ps1 -Audit` 漂移检查参照。
> 规则（见 rules.md 第 5 章）：临时函数须 `zz-` 前缀 + 守卫鉴权 + 登记本表；完成后删除并清空本表对应条目。

## 规则速览
- 业务正式函数 → 登记 `cloudfunctions.whitelist`
- 调试临时函数 → `zz-` 前缀 + 守卫 + 登记本表
- 有 `index.js` 却在两个清单均无登记 = predeploy -Audit 会拒绝部署

## 当前已登记临时函数
- 函数名: zz-clean-n8b
  用途: N8b 打赏污染清理 —— clean(①pay_transaction tip 流水软删 ②order_main.tip_total_fen 回滚-1250 ③system_notice type=tip 软删 ④audit_log 保留) / verify(清理后核对)
  创建: 2026-09-28
  云端部署: 是(验证完成后删除)
  状态: 待删除

## 登记格式示例
```
- 函数名: zz-xxx
  用途: 一次性数据修复 / 冒烟 / 手工触发
  创建: YYYY-MM-DD
  云端部署: 是/否
  状态: 待删除 / 已删除
```