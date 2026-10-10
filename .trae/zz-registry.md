# ⚡ 临时/调试云函数登记表（zz-registry）

> 用途：登记所有调试类临时云函数，供 `.trae/cloudfunctions.whitelist` 与
> `.trae/predeploy.ps1 -Audit` 漂移检查参照。
> 规则（见 rules.md 第 5 章）：临时函数须 `zz-` 前缀 + 守卫鉴权 + 登记本表；完成后删除并清空本表对应条目。

## 规则速览
- 业务正式函数 → 登记 `cloudfunctions.whitelist`
- 调试临时函数 → `zz-` 前缀 + 守卫 + 登记本表
- 有 `index.js` 却在两个清单均无登记 = predeploy -Audit 会拒绝部署

## 当前已登记临时函数
- 函数名: zz-seed-orders
  用途: 种子需求补造（seed-scene-demands.md 方案A：走 demand-publish mock 发布，start_time 置 30 天窗口内、expire_at 自动未来）
  创建: 2026-10-01（4061b68）
  云端部署: 是
  状态: 保留使用中（勿动勿部署）
- 函数名: zz-warmup
  用途: 冷启动预热 / 自测触发
  创建: 2026-10-02（e4761ed）
  云端部署: 是
  状态: 保留使用中（勿动勿部署）
- 函数名: zz-ai-guard
  用途: AI 通道可用性验证(CloudBase AI 文本生成 ping/polish)
  创建: 2026-09-29
  云端部署: 是
  状态: **本地代码已删**（2026-10-10 清理残留目录，仅剩的 node_modules 一并删除）；**云端函数仍在**（2026-10-10 `cli cloud functions list` 实证）——原记录「已删除（2026-09-29）」与实际不符，云端属孤儿函数，提审前不动、待提审后处置。重建需先切资源点计费。

## 已删除留痕（不再登记，仅备查）
- zz-clean-n8b：N8b 打赏污染一次性清理（bf4cb60 登记 → dbbbd48 删除并撤销注册，2026-09-28 双证闭环）；本地残留空壳目录 2026-10-10 已清；从未部署云端
- zz-kefu-clean：一次性客服数据清理工具；未入 git；本地残留空壳目录 2026-10-10 已清；从未部署云端
- admin-test / export-config：手工调试函数，2026-09-23 已删（见 cloudfunctions.whitelist 尾注）；未入 git；本地残留目录 2026-10-10 已清；从未部署云端

## 登记格式示例
```
- 函数名: zz-xxx
  用途: 一次性数据修复 / 冒烟 / 手工触发
  创建: YYYY-MM-DD
  云端部署: 是/否
  状态: 待删除 / 已删除
```
