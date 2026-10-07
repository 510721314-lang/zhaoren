# 用户侧待办清单（B4–B7 · Bus factor 整改）

> **背景**：本项目 bus factor = 1（只有你一人掌握账号、凭证与知识）。工程侧 B0–B3 已完成（技术评审存盘 / 七篇 runbook 入 git / gate.ps1 门禁 / 冷启动验证 0 阻塞）；**B4–B7 只能由你本人完成，是当前项目最大的剩余风险**。
> **铁律**：凭证只存仓库外（密码管理器 or `C:\zhaoren-bak`），**绝不写入任何 git 内文件**。
> **登记**：每完成一项，回来在 `docs/verification/p0-p2-status-20261006.md` 的 P0 行补一句进展。
>
> **当前进度（2026-10-07）**：用户指示**测试 / 演练类暂缓推进**（B5 真人接管演练、以及各清单内的「验证」步骤不催促）；**B4 凭证填写、B6 加第二人、B7 异地备份**等配置类待办正常可做。明早 03:05 的 auditPrune 自动检查照常进行。

---

## B4 账号恢复矩阵 · 填满凭证

目标：**机器全毁时，凭这些记录就能恢复项目。**

### 已就绪（无需动作）
- [x] 小程序 AppID：`wxbc4a4afacdf234f5`
- [x] 云环境 ID：`cloud1-d9gkefwcp5c777088`
- [x] GitHub 仓库：`https://github.com/510721314-lang/zhaoren.git`
- [x] `admin_web_key`：`C:\zhaoren-bak\admin-key-*.txt` + 本机用户环境变量 `AWK_KEY`
- [x] 备份产物位置：`C:\zhaoren-bak`

### 待办
- [ ] **确认「能登录小程序后台的微信号」是哪个**（mp.weixin.qq.com 的扫码管理员），记入密码管理器
- [ ] 记录**云开发/腾讯云账号的计费主体**（哪个微信或腾讯云账号在付费）与**套餐到期时间**
- [ ] 确认 GitHub 账号 `510721314-lang` 的登录方式（密码 + 2FA 恢复码）已保存
- [ ] 上述凭证统一保管到**密码管理器**（推荐）或 `C:\zhaoren-bak` 下的加密文件
- [ ] **演练**：假装换了新电脑 —— 只凭这些记录，能否拿到 `AWK_KEY` 并登录后台？
      （若 key 文件丢失 → 走 `docs/runbooks/key-rotation.md`「换机取证与失钥恢复」）

---

## B5 真人接管演练

目标：证明**文档真的能让第二个人接手**（B3 是"零记忆 AI"跑通，B5 要"真人"跑通）。

- [ ] 找一位没接触过本项目的人（同事/朋友），或你隔一周后以新人视角模拟
- [ ] 只给两样东西：**仓库地址** + `docs/runbooks/README.md`（不许口头提示、不许代为操作）
- [ ] 要求对方完成：
      1. clone 仓库
      2. `powershell -File scripts/gate.ps1` → 看到 `ALL PASS`
      3. 拿到 `AWK_KEY`，调一次 `config_get`，说出当前环境是 prod 还是 dev
- [ ] 记录每一处卡点（哪句话看不懂、哪步报错），回写到对应 runbook
- [ ] **通过判据：全程没有来问你任何问题**

---

## B6 第二运营者 + GitHub 协作者

目标：你不在了，还有第二个人能操作。

- [ ] **微信公众平台** mp.weixin.qq.com → 「成员管理」→ 添加运营者/开发者（对方微信扫码接受）
- [ ] **GitHub** → 仓库 Settings → Collaborators → 添加第二人（Write 权限）
- [ ] **云开发后台管理员**：把第二人的 openid 加入白名单（网关调 `admin-action` 的 `admin_add`；对方 openid 可用 `init-db` 的 `lookup` 按昵称反查）
- [ ] **验证**：第二人能独立登录 admin-web 后台、能 clone + push

---

## B7 备份异地化（脱离单机）

目标：**本机损坏时，备份不丢**（当前所有产物都在 `C:\zhaoren-bak`，与机器同命）。

- [x] **选定并已开通**：飞书云空间（lark-cli 已配置，用户身份 `李劲松`，已授权 `drive:file:upload` / `space:folder:create`）
- [x] **目录已建**：`zhaoren-backup`，folder_token = `RCsff3kGUlKhpud1KVFckJOhnGc`
      URL：https://hcn9befivuyv.feishu.cn/drive/folder/RCsff3kGUlKhpud1KVFckJOhnGc
- [x] **首批已上传并校验**（2026-10-07）：git bundle + 云端 DB 压缩包 + `CHECKSUMS.txt`；`drive +status` **精确模式（SHA-256）**结果：`unchanged` 3/3、`new_remote` 0（远端无缺失）
- [ ] **设定更新节奏**：每个工作日收工 / 至少每周，重跑一次上传（命令见下）
- [ ] **验证（暂缓）**：从异地下载 bundle → `git clone <bundle> restore` → `git -C restore rev-parse HEAD` 与本地一致

### 后续每期上传命令（照抄即可）
```powershell
# 1) 把当期产物放进一个暂存目录（bundle + 云端DB zip + CHECKSUMS.txt）
# 2) 上传（cwd 必须在暂存目录内 —— lark-cli 只接受相对路径）
lark-cli drive +upload --file "./<文件名>" --folder-token RCsff3kGUlKhpud1KVFckJOhnGc --as user
# 3) 校验（精确模式逐个 SHA-256 比对，期望 unchanged 全中、new_remote 为 0）
lark-cli drive +status --local-dir . --folder-token RCsff3kGUlKhpud1KVFckJOhnGc --as user
```
> 授权有效期：user token 至 `2026-10-07 14:13`（约 2 小时），refresh token 至 `2026-10-14`；过期后重新取链接：`lark-cli auth login --domain drive --no-wait --json`（用 `lark-cli auth qrcode <url> -o <相对路径>.png` 出二维码）。

---

## 建议优先级

| 顺序 | 项 | 理由 |
|---|---|---|
| 1 | **B4 凭证** | 机器一坏，全靠它；且成本最低（半小时内可完成） |
| 2 | **B7 异地备份** | 与 B4 互补——B4 给"钥匙"，B7 给"数据" |
| 3 | B6 第二人 | 需要找到合适的第二个人 |
| 4 | B5 真人演练 | 可在 B6 到位后一起做（让第二人跑 B5） |

> 注：**不需要一次做完**。B4 + B7 做完，项目抗风险等级就已显著提升；B5/B6 属于进一步加固。
