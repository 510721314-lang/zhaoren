# 真机/模拟器验证证据归档（G2）

> 集中存放真机与模拟器验证的**可追溯证据**：截图、云端回执、回归报告。
> 目的：解决证据散落 `docs/runbooks/`、`docs/session-log/`、`docs/verification/` 三处、无统一归档点的问题。

## 目录结构

每次验证建一个时间戳子目录：

```
docs/design/evidence/regression-YYYYMMDD-HHMM/
├── report.md          # 验证结果表（编号｜能力｜设备｜结果｜备注）
├── screenshots/       # 真机/模拟器截图（PNG/JPG）
└── receipts/          # 云端回执（tcb 查询输出 JSON / 控制台日志文本）
```

## 归档步骤（每次真机回归后必做）

1. 建目录：`docs/design/evidence/regression-<YYYYMMDD-HHMM>/`
2. 截图全部存入 `screenshots/`（文件名 = 能力编号，如 `C-01-login.png`）
3. 云端回执（`node scripts/tcb-query-order.js <order_id>` 等输出）存入 `receipts/`
4. 填写 `report.md`：复制下方模板，逐行填结果与截图/回执相对路径
5. commit：证据目录与代码改动**分两个 commit**（证据属 docs 制品）

## report.md 模板

```markdown
# 真机回归 <YYYY-MM-DD>

| 编号 | 能力 | 设备 | 结果 | 截图 | 回执 | 备注 |
|---|---|---|---|---|---|---|
| C-01 | 登录链路 | iOS | ✅ | screenshots/C-01.png | receipts/C-01-login.json | |
| C-02 | 模拟支付 | iOS | ❌ | screenshots/C-02-fail.png | receipts/C-02-pay.json | errCode=-604101 |
```

## 与既有清单的关系

- `docs/runbooks/real-device-capability-sop.md`：能力清单 + 步骤（**验证什么、怎么验**）
- `docs/runbooks/realdevice-regression-20261101.md`：56 项批次清单（**逐项步骤**）
- `docs/design/evidence/`：**证据落盘归档**（每次验证的产物）

清单是静态入口，evidence 是动态归档。清单中已回填的历史项可按需迁移进 evidence 目录（保留原清单链接指向 evidence）。
