# 环境与项目备份清单 · 2026-09-12

## 一、备份时间与锚点
- 备份日期：2026-09-12
- Git 提交：`e208e01b368fc6620a10d48a5b53e49c6472af78`
- Git 标签：`backup-2026-09-12`（附注标签，恢复锚点）
- 恢复命令：`git checkout backup-2026-09-12`

## 二、本机环境配置
- 项目根目录：`c:\Users\DC\Desktop\zhaoren`（旧路径 h:\zhaoren 已废弃）
- 微信开发者工具 IDE：`c:\Users\DC\Desktop\微信WEB开发者工具\微信开发者工具.exe`
  - 版本：2.02.2609072（win32 x64）
  - CLI：`c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`
  - 服务端口：已开启，备份时端口 **11841**（端口每次启动可能变化，以
    `%LOCALAPPDATA%\微信开发者工具\User Data\<实例哈希>\Default\.ide` 内容为准）
  - CLI 登录态：`islogin` 返回 {"login":true}
- Trae CN 工作区：`c:\Users\DC\Desktop\zhaoren`
- MCP：CloudBase MCP（.trae/mcp.json，npx @cloudbase/cloudbase-mcp）

## 三、云端环境
- CloudBase 环境 ID：`cloud1-d9gkefwcp5c777088`（唯一来源 miniprogram/envList.js）
- 小程序 AppID：`wxbc4a4afacdf234f5`
- 云端函数（17 个，2026-09-12 CLI list 实测）：
  admin-action, blog-action, demand-match, demand-publish, evaluation-submit,
  home-action, im-conv, im-send, init-db, order-action, order-create,
  order-timer, partner-action, partner-apply, payment-mock, safety-report, user-login
- 临时函数 zz-selftest-timer：本地+云端均已删除（代码留存于提交 cf138e0）
- 注意：免费体验版云函数超时锁死 3 秒，config.json 中的超时/触发器 CLI 部署不生效，需控制台配置或升级套餐

## 四、备份目录内容（.backup-2026-09-12/）
- `cloudfunctions-configs/`：16 份云函数 config.json（home-action 无此文件）
- `config/`：app.json、project.config.json、project.private.config.json（本地私有，git 未跟踪）、sitemap.json、envList.js
- `trae/`：rules.md（13 态状态机/12 条红线）、mcp.json、wx-cloud-deploy.SKILL.md
- `ENV-MANIFEST.md`：本清单
- `SHA256SUMS.txt`：备份文件校验值

## 五、当日完成的关键变更
1. IDE 迁移至桌面新路径并打通 CLI 部署链路（端口 11841 实测通过）
2. 9-09~9-11 全部工作入库（4 个提交）+ PRD 三文件从 git 恢复
3. zz-selftest-timer 本地/云端清理
4. 修复发布需求/接单在模拟器与系统定位关闭时被误判为微信权限拒绝（提交 e208e01）

## 六、项目规模
- 云函数 17 个（cloudfunctions/）；小程序页面 23 个（miniprogram/pages/）
- 无 node_modules 依赖实体（云函数 package.json 部署时云端 npm install）

## 七、全量压缩归档
- 路径：`C:\Users\DC\Desktop\临时备份文件\zhaoren-backup-2026-09-12.zip`
- 大小：约 1.8 MB（含 .git 全量历史，解压顶层目录 zhaoren/）
- 校验值：以同目录旁证文件 `zhaoren-backup-2026-09-12.zip.sha256` 为准（归档生成后写入，避免循环引用）
- 还原方式：解压到任意盘后用微信开发者工具导入目录即可；含 git 历史，可 `git checkout backup-2026-09-12` 精确定位本备份点
- 校验方式：PowerShell 执行 `(Get-FileHash '归档路径').Hash` 与旁证文件比对；归档内文件可按本目录 SHA256SUMS.txt 抽查
