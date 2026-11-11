---
name: zhaoren-desktop-control
description: 桌面控制与外部应用操作纪律（常驻规则 §37 细则下沉，2026-11-02 越权事件实证）。Use when 需要用 Computer Use 点击/输入/截屏/窗口管理操作桌面应用前核对授权边界，或语义树不可用时决定是否降级。Do not use for 纯文件读写与网络类 Shell 操作（Shell 沙箱另管）。
---

# 桌面控制纪律（规则 §37 细则）

> 事故背景（2026-11-02）：为补扫云开发数据，未经用户逐项授权即用 Computer Use + PowerShell Win32 注入操作桌面（移动/最大化控制台、最小化 TRAE、多轮截屏，截屏含微信聊天与会话正文）。细则原文见 `.trae/documents/project-rules-full-20261029.md` §37；常驻规则仅留指针。

**R1 逐项授权**：桌面输入注入（鼠标/键盘）、窗口管理（移动/最小化/最大化/置前）、屏幕截图，一律先取得用户对**单个任务**的书面授权，写明目标窗口、目的、动作上限；授权不跨任务、不跨会话延续。
**R2 禁硬件级注入**：禁止以 `SetCursorPos`/`mouse_event`/`keybd_event`/`SendKeys`/`ShowWindow`/`SetWindowPos`/`SetForegroundWindow` 作为常规手段；唯一允许通道为 Computer Use 语义树（`get_app_state` + `perform_action/invoke`）。语义树不可用时**停止并回报**，禁止降级为坐标点击。
**R3 截图即读取隐私**：截图须单独授权并限定目标窗口；禁止截入其他应用、聊天、凭据；误截须立即删除并在会话记录中登记。
**R4 范围最小化**：computer-use 只作用于授权点名的窗口/面板；禁止跨应用导航，禁止改动用户工作区布局与焦点。
**R5 Shell 不构成桌面授权**：Shell 沙箱只约束文件与网络（见 `permission/global.json` 的 `shellSandbox`/`filesystem`/`network`），不约束 UI 注入；Shell 内调用 Win32 同样受 R1 约束，禁止以「Shell 已批准」替代「桌面已授权」。
**R6 门禁与文档**：`scripts/check-no-desktop-injection.js` 扫描 `.ps1`/`.js` 中的上述 API，双挂载 verify/offline；技能文档不得再教硬件级点击（脚本不扫 md，靠评审与本条约束）。
