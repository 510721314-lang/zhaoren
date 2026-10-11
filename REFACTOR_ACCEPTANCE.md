# P0 巨型文件拆分 · 验收归档

> 范围：order-action / admin-action 入口物理拆分 + 测试基建加固。纯测试基建改动，**零生产代码改动**。本文件为验收留档，提交前自检用。

## 一、拆分规模（已推送，本地=远程 11c8602）
| 函数 | 拆分前 | 拆分后 | action 抽离 |
|---|---|---|---|
| order-action | 2002 行 | 338 行 | 29 个 → 同级 action_*.js |
| admin-action | 3529 行 | 544 行 | ~83 个 → 同级 action_*.js |

无循环依赖；共享符号经 ctx 注入，handler 禁止反向 require index。

## 二、等价与质量证明（提审硬前置门）
| 证据 | 结论 |
|---|---|
| A/B 等价（拆分前 baseline vs 当前） | **181 cases（67 显式 + 114 自动）0 diff** |
| 单测 | **183 pass / 0 fail** |
| 守门脚本 [check-handlers.js](../scripts/check-handlers.js) | **114 actions 0 抛错**（无 ctx 漏注入） |
| gate 烟雾 | **6/6 探针 PASS**（含 home_probe_square） |

显式用例构成：核心块 5（config/dispute/audit/no_show/exam）+ Batch1×4 厚逻辑 + Batch2×5 中逻辑 + Batch3×10 薄逻辑，均「成功 + 拒绝分支」正反对照。

## 三、提审数据注意项
1. **广场种子 24h 过期**：`demand` 默认 `expire_at = now + 24h`，超时被清扫。`home_probe_square` 要求 `status:'matching'` 且未过期。提审前若广场空，重跑：
   - `seed_scene_demands` cleanup=true（软删旧 sdm-*）
   - `seed_scene_demands` per=3（新建 ~24 条 matching）
   经网关 admin-web 入口触发即可。
2. **随机单号不归一**：A/B harness 已归一 REF/ORD/WD/TX/DR 前缀随机串，避免假阳性 diff。
3. baseline 文件（`_orig_baseline.js`）每次 A/B 后已清理，确认无残留。

## 四、提审自检 Checklist
- [ ] `node --test cloudfunctions\_shared\*.test.js` → 183/0
- [ ] `node cloudfunctions\_shared\ab_equivalence.js` → 181 cases 0 diff（跑完删 `_orig_baseline.js`）
- [ ] `node scripts\check-handlers.js` → 114 actions 0 抛错
- [ ] `gate.ps1` / smoke-check → 6/6（必要时先 reseed 广场）
- [ ] `git status` 干净，HEAD == origin/master
