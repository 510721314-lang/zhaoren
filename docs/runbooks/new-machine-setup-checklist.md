# 新机环境初始化检查清单（new-machine-setup）

> 配合 `docs/HANDOFF-20261031.md` §0 使用：本清单面向**操作者（用户/接收 Agent 协助执行）**，逐项勾选；「T-编号」对应 HANDOFF-20261031 的清点项。
> 生成：2026-10-31（旧机 `53933c3` 基线）。原则：**AI 不代管凭据、不代点登录/授权/提审**；每阶段完成后再进下一阶段；任何一步失败先停下报告，不得绕过。

## 阶段 1 · 基础软件与凭据（T-0.0.1）

| ✓ | 项 | 操作 | 预期 |
|---|---|---|---|
| ☐ | Git | `git --version` | 正常输出版本号 |
| ☐ | Node.js 18+ | `node -v` | v18 及以上 |
| ☐ | npm 全局 CloudBase CLI | `npm i -g @cloudbase/cli` → `tcb -v` | 3.x |
| ☐ | 微信开发者工具（稳定版） | 安装后**记录安装路径**（后面要用） | — |
| ☐ | TRAE / IDE | 安装 | — |
| ☐ | git 身份（用户配） | `git config --global user.name "<你的名字>"` + `user.email "<GitHub 邮箱>"` | AI 不代管、不代填 |
| ☐ | GitHub 凭据（用户配） | PAT 或 Windows 凭据管理器；或注册 SSH 公钥（旧机 SSH 未注册 GitHub，见 E-6.50） | 凭据禁写入任何文件/聊天 |

## 阶段 2 · 仓库 clone（T-0.0.2 / T-0.1 / T-0.2 / T-0.3）

| ✓ | 项 | 操作 | 预期 |
|---|---|---|---|
| ☐ | clone | `git clone https://github.com/510721314-lang/zhaoren.git`，**建议 clone 为 `c:\zhaoren`**（文档路径一致；不同则全文按 `<ROOT>` 折算） | clone 成功 |
| ☐ | HEAD 基线 | `git rev-parse HEAD` 与 `git rev-parse origin/master` | 一致，且 ≥ `0ff01d5`（`53933c3`＝HANDOFF-20261031 入库 commit，其后继均可） |
| ☐ | 本稿存在 | `Test-Path docs\HANDOFF-20261031.md` | True（这是投喂稿，必须在） |
| ☐ | 工作区 | `git status --short` | clone 后应干净或仅零星预期 untracked；**批量 M** → 先查 `git config core.autocrlf` 与 `.gitattributes`（换行差异），禁批量 checkout/还原 |
| ☐ | 平台记忆确认 | 平台记忆（`~/.trae-cn/memory/…`）新机不存在 = 预期 | 项目记忆凭据 = `docs/project-memory-archive-202610.md`（T-0.0.6） |

## 阶段 3 · 微信开发者工具（T-0.0.3 / T-0.0.4）

| ✓ | 项 | 操作 | 预期 |
|---|---|---|---|
| ☐ | 导入项目 | 工具 → 导入 `<ROOT>`，确认 AppID `wxbc4a4afacdf234f5` | 项目加载 |
| ☐ | 登录 | 微信扫码登录（**用户亲自扫**） | 工具内已登录 |
| ☐ | 服务端口 | 设置 → 安全设置 → **服务端口开启** | CLI/automator 可用 |
| ☐ | 云环境 | IDE 内**云开发控制台**登录微信并选择/开通 `cloud1-d9gkefwcp5c777088` | 首次编译云函数报错消失 |
| ☐ | CLI 路径实测 | `Test-Path 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat'`（新机安装位置可能不同，以实测为准，**记录实测路径**） | True（或记录到实际路径） |
| ☐ | 登录态自检 | `"<cli.bat 实测路径>" islogin` | `{"login":true}`（假阳性可能，部署时报错为准） |
| ☐ | CLI 访问令牌 | 设置 → 安全 → **CLI 访问令牌留空**（界面提示「不填写则不校验」） | **无需填写**；填了反而要求每次调用带 `--token` 或 `WECHAT_DEVTOOLS_CLI_TOKEN`。旁边的 **MCP Token** 是另一套（只给 MCP 客户端用），与 CLI/automator 无关 |
| ☐ | 端口错配排障 | 只报 `IDE may already started at port 9420 / wait IDE port timeout` 时，先比对**在跑的 IDE 安装路径**与 `.env` 的 `WX_DEVTOOLS_CLI_PATH` 是否同一安装（看 `.ide-status` 是否为 `On`） | 不同安装各自有 user data profile（`%LOCALAPPDATA%\微信开发者工具\User Data\<hash>\Default\.ide`），端口读错；把 `.env` 改指在跑的安装版即可 |

> ⚠ 首次编译云函数报错属预期 → 处置=上一步「云环境」；**勿因编译报错去做 tcb 授权**（tcb 按需，见阶段 6）。

## 阶段 4 · 项目门禁自证（T-0.0.8）

| ✓ | 项 | 操作 | 预期（2026-10-31 旧机基线） |
|---|---|---|---|
| ☐ | 门禁全链 | `npm run verify:offline` | **EXIT=0** |
| ☐ | 基线比对 | 核对输出 | tests **707/707**；A/B **457 EQUIVALENT**（241 explicit+216 auto；69 known-evolution）；RULES-SIZE OK **30656B**/30720B；SYNTAX 269 / MINIPROGRAM 105 / SHARED SYNC ALL OK / HANDLER 143 / LEDGER 46 / manual-links 192·13 / ONCE-PROMPTS 2 markers (0 known-todo) |
| ☐ | 失败处置 | 若非 EXIT=0 | **停下报告**（多为 PATH/编码/换行环境差异），不得绕过、不得改门禁 |
| ☐ | Shell 版本 | `$PSVersionTable.PSVersion` | 记录实测版本（PS5/PS7 陷阱条款按实测取舍） |

## 阶段 5 · 本地资产迁移（T-0.0.7 · 用户手动 · 不走仓库）

| ✓ | 项 | 旧机位置 | 说明 |
|---|---|---|---|
| ☐ | **admin key 文件** | `C:\zhaoren-bak\admin-key-*.txt` | U 盘/私有通道迁移至新机自定路径；**只把路径告诉 AI，禁读内容、禁入仓库/聊天/日志**；迁移前 admin 网关写操作不可用，先只读 |
| ☐ | 备份区结构 | `C:\zhaoren-bak\`（git bundle / robocopy 热备 / DB 导出） | 如需延续备份六步链，整目录迁移或新机重建 |
| ☐ | BP 目录 | `docs/bp/` 2 文件（旧机 untracked） | 按需迁移（是否入库待用户指示，T-7.20） |
| ☐ | SOP/题库 | 6 份（4 md + 2 docx，旧机 untracked） | 按需迁移（用户已裁定暂不入库） |
| ☐ | `.env`（按需） | 旧机 ignored，含 `WX_DEVTOOLS_CLI_PATH` | 仅跑 e2e 需要；按新机 cli.bat 实测路径重建 |

## 阶段 6 · 按需通道（T-0.0.5 · 平时**不做**）

| ✓ | 项 | 操作 | 预期 |
|---|---|---|---|
| ☐ | 判断是否需要 | tcb 仅三类场景：①备份 B 通道（`raw-export`/`tcb-exec.js`）②触发器管理（`tcb fn trigger create`）③索引/函数详情回读（`listIndexes`/`fn detail`） | 不需要则跳过本阶段 |
| ☐ | 设备码授权 | 浏览器打开 CLI 打印的授权 URL，填 8 位用户码（**用户亲自操作**，登录环境属主账号） | 终端打印 success |
| ☐ | 闭环判据 | `Test-Path "$env:USERPROFILE\.cloudbase"` + `cloudbase env:list` | True 且列出 `cloud1-d9gkefwcp5c777088`；**不落盘则授权白做**（E-6.53 反复弹起根因） |

> 发布链路（云函数部署 / 体验版 upload / download 核验）走 `cli.bat` 微信登录，**不需要** tcb 授权。

## 阶段 7 · 投喂衔接（回到 HANDOFF）

- ☐ 新任务**首条消息整段粘贴** `docs/HANDOFF-20261031.md`（§0 至文末）
- ☐ 接收 Agent 按 §2.5 RIC 逐条清点 `T-0.0.* ∪ T-0.* ∪ T-7.* ∪ C-3.* ∪ C-4.* ∪ E-6.* ∪ C-8.*`，**差集为空再派活**（T-0.7）
- ☐ 回执阶段只读（T-0.9）：禁写文件/部署/写 DB/改 admin_config/commit/push
- ☐ 首个正式任务建议 = T-7.28 收尾（本清单全绿即闭合）

## 常见坑速查（源自 E-6.x / C-4.x，新机高频）

| 现象 | 处置 |
|---|---|
| push 报 `schannel: failed to receive handshake` / `Connection was reset`，但 TCP 443/22 通 | 中间层瞬时干扰，**隔轮重试同参数** `git -c http.proxy= -c https.proxy= push origin master`（E-6.54）；连续 3 败停手报告 |
| `git status` 显示 M 但内容没改 | stat-dirty 假 M：`git hash-object <file>` == HEAD blob 且 `git diff --quiet` → `git add <file>` 刷新即消，**禁空提交**（E-6.55） |
| tcb 反复弹「CLI 授权」用户码 | 凭据未落盘 `~/.cloudbase`（E-6.53）；按阶段 6 闭环判据验证；可改 `tcb login --apiKeyId … --apiKey …` 免反复授权（密钥只存本地路径） |
| IDE 侧「CLI 授权 / 访问令牌」反复要求填写 | **两件事勿混**：①IDE「CLI 访问令牌」留空即可（不填=不校验，填了就要每次 `--token`）；②`tcb`/`cloudbase` 命令的设备码授权属 CloudBase CLI，只在阶段 6 三类场景才需要（E-6.53） |
| PowerShell 把 git/tcb 的 stderr 包成 `NativeCommandError` | PS 包装行为，**以退出码为准**；PS5 中文/引号陷阱见 C-4.x |
| IDE 白屏/模拟器无响应/automator RPC 超时 | 结束全部「微信开发者工具」进程重开项目；仍复发重启电脑（v3 §7.7 终解）；不得据模拟器现象判定代码回归 |
| 触发器更新报 `-10008 invalid ip` | 非登录问题：公网 IP 未加「代码上传」白名单，或改走 `tcb fn trigger create` 绕开 |

## 本清单完成判据

阶段 1~4 + 阶段 5（按需项）全绿 ⇒ **T-7.28 闭合**，可直接投喂 HANDOFF-20261031 开始工作；阶段 6 留待按需；T-7.32（冻结规则指针订正）在投喂后由接收 Agent 提请用户批准。
