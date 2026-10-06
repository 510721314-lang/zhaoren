# 接管手册索引（runbooks）

> 目的：对抗 Bus factor=1。任何第二人（或冷启动 AI）只凭本目录 + 仓库文档，无需问原作者即可独立完成日常运维与提审。
> 铁律：接手工单里的每一条命令都以仓库内脚本/文档为准，文档与脚本不一致时以脚本实测为准并回修文档。

## 新人 10 分钟接管入口

1. 克隆仓库（网络受限见 troubleshooting.md 的代理绕过）
2. 装依赖：项目零 npm 依赖（node:test），只需 Node ≥ 18；`node --version` 确认
3. 一键门禁：`powershell -File scripts/gate.ps1` → exit 0 = ALL PASS
   （第 6 步 smoke 需要 `$env:AWK_KEY`，见 key-rotation.md）
4. 拿到钥匙后即可照单操作。

## 手册索引

| 手册 | 内容 |
|---|---|
| [deploy.md](deploy.md) | 云函数部署与 admin-web 前端重建 SOP |
| [backup-restore.md](backup-restore.md) | 三重备份与恢复演练 |
| [key-rotation.md](key-rotation.md) | admin_web_key 轮换 SOP（含 $env:AWK_KEY 配置） |
| [ops-runbook.md](ops-runbook.md) | init-db / purge / env 切换 / 白名单 / 巡检演练 |
| [audit-checklist.md](audit-checklist.md) | 提审前门禁全序列与已知风险点 |
| [config-sync.md](config-sync.md) | 全仓配置同步清单（SCENE 等） |
| [troubleshooting.md](troubleshooting.md) | 坑位速查（代理/herdoc/网关限制等） |

## 账号恢复矩阵（B4，凭证只存仓库外 C:\zhaoren-bak，勿入 git）

| 项 | 值 | 存放位置（仓库外） |
|---|---|---|
| 小程序 AppID | wxbc4a4afacdf234f5 | — |
| 云环境 ID | cloud1-d9gkefwcp5c777088 | — |
| GitHub 仓库 | ⚠ 待填 | — |
| admin_web_key | 轮换历史见 C:\zhaoren-bak | admin-key-*.txt |
| 微信管理员账号 / 第二运营者 | ⚠ 待填（用户侧） | 纸质/密码管理器 |
| 备份产物 | C:\zhaoren-bak（git bundle / robocopy / DB 导出） | — |
| 计费与续费责任 | ⚠ 待填（用户侧） | — |

## 知识冻结 3 问（每次会话收尾执行）

1. 有新决策没进 docs/ 或 project_memory？
2. 有新坑没进 troubleshooting.md / Lessons Learned？
3. 有新操作流程没写成 runbook？