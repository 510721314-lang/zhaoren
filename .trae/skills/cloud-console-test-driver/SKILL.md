---
name: "cloud-console-test-driver"
description: "通过 Computer Use 驱动微信开发者工具内置云开发控制台的「云端测试」面板批量调用云函数（无 CLI/SDK 通道时）。当需要在 zhaoren 项目里跑 mock 云函数回归/手工触发云函数且只能走 IDE 控制台时使用。"
---

# 云开发控制台云端测试面板驱动（zhaoren 专用）

## 背景：为什么需要它

- 微信开发者工具 CLI 只有 list/info/deploy/inc-deploy/download，**没有调用云函数的命令**。
- 独立 WS 客户端直连 IDE（端口 11841 / 动态 WS 端口）已验证**不可用**：CLOUD_FUNCTIONS_CALL 依赖本地调试会话上下文，服务端直接 NormalClosure。Invoke-CloudFn.ps1 / run.js 方案废弃，勿重试。
- **唯一通道**：IDE 内置云开发控制台 → 云函数列表 → 搜索函数 → 行内「云端测试」按钮 → 面板内 editor 写事件 JSON → 「运行测试」→ 读返回。

## 开机/重启后先做这两件事（2026-09-13 血泪补充）

1. **防锁屏必须用硬件级 keybd_event**：`WScript.Shell SendKeys('{F15}')` 不重置系统空闲，机器照样 1~2 分钟锁屏（LockApp.exe 出现后无障碍树全部退化，一切操作失效）。有效保活（后台 PowerShell，约 40 分钟）：
   ```powershell
   Add-Type 'using System;using System.Runtime.InteropServices;public class KK{[DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);}'
   1..80 | % { [KK]::keybd_event(0x7E,0,0,[UIntPtr]::Zero); sleep -m 60; [KK]::keybd_event(0x7E,0,2,[UIntPtr]::Zero); sleep 30 }
   ```
   锁屏后用 computer-use 对 LockApp pid 按一次 Return 可解（本机无密码）。
2. **云开发控制台是独立窗口，关掉后只能从 IDE 主窗口工具栏重开**：主 IDE 窗口内容不暴露无障碍树（只有 pane），要点工具栏"云开发"图标。
   - **新版 IDE 2.0（2.02.2609102 起）没有"云开发"文字按钮**，入口=工具栏右上角 **∞ 双环图标**（悬停 tooltip「云开发」）。2026-09-13 窗口化主窗口（rect 277,50,1502,800）时逻辑坐标约 **(1173,70)**；它左侧紧邻"上传"，点错会弹上传确认框（点"取消"）。定位法：悬停读 tooltip 再点，别猜。坐标点击用 PowerShell `SetCursorPos`+`mouse_event` 硬件级。
   - **360 安全卫士（360tray）会抢前台导致 SetForegroundWindow/click 全部失效**（GetForegroundWindow 甚至返回 0）。2026-09-13 360 已卸载，AttachThreadInput 置前恢复正常。
   - **反复锁屏真凶曾是 ToDesk**（config.ini `PrivateScreenLockScreen=0`/`autoLockScreen=0` 已改），不是系统空闲锁。
   - 控制台窗口的 pid/windowId 每次重开都变（19660 下 81463948 → 33753470 → 28967582）；本地 HTTP 端口也变（50202→53259）。用 `get_app_state {pid}` 的窗口映射重新发现，**注意正则要抓 `- windowId=N pid=.. "云开发控制台` 行，别被主窗口里的同名 pane 文本骗到**。
   - **v2.0.3 控制台 Ctrl+R 重载 webview 可能让 a11y 树退化成 ~1600 字符骨架且不恢复**；此时直接对 pane id=0 perform_action `window_close` 整窗关掉，再从工具栏 ∞ 图标重开（最稳，多次验证）。
3. fg.ps1 已参数化（`-ProcId`，默认 19660；注意参数不能叫 `$Pid`，PowerShell 保留变量）；目标窗口不是进程主窗口时用内联 C# 直接 `SetForegroundWindow(具体 hwnd)`。

## 环境常量（IDE 重启后要更新 pid/windowId）

- IDE：`c:\Users\DC\Desktop\微信WEB开发者工具\cli.bat`
- 云开发控制台窗口：2026-09-13 IDE 重启后 pid=19660、主窗口 windowId=46401320、控制台 windowId=81463948（已关闭，重开后重新发现；旧值 17872/307760310 已失效）
- 置前脚本：`.tmp-cloud-runner/fg.ps1 -ProcId <pid>`（SetForegroundWindow）
- MCP server：`ide_mcp.config.ext.computer-use`，经 integrated_code_mode 的 `tools.run_mcp` 调用
- 树文件目录：`C:\Users\DC\AppData\Local\Temp\trae\computer-use\YYYYMMDD\trees\tree-<uuid>.txt`

## 铁律（每条都踩过坑）

1. **内联无障碍树约 5000 字符截断**。get_app_state 输出末尾出现 `[… truncated, full tree: N chars — read <路径>tree-xxx.txt]` 时，**必须 Shell `Get-Content -Raw` 读该文件**拿完整树。
2. **Shell stdout 同样截断大输出**。不要整文件 cat；用 `Select-String -LiteralPath $f -Pattern '...'` 精准取行。
3. **树文件里 JSON 引号不转义**。编辑器行真实形态：
   `edit [set_value,set_focus] val="{"action":"publish",...}" id=251`（id 在**行尾**）。
   面板内有多个 edit（如行号 `val="1" id=102`），定位编辑器只认特征行：`edit [set_value,set_focus] val="{`，再取行尾 `id=(\d+)\s*$`。
4. **set_value 防静默写错（最关键）**：set_value 后面板重渲染、id 变化，且曾出现写入无效导致静默重发旧事件的事故。每次写完**必须重新读树，校验编辑器行包含新事件标记**（如 start_time 数字/action 名），不匹配则重试（最多 3~4 次），然后**重新现取「运行测试」按钮 id**再 invoke。
5. **结果判定**：树文件中返回节点是行首缩进的 `text "{...}"`（不转义，直接 JSON.parse）；`data-item "<uuid>"` = RequestId。**RequestId 与上次不同 且 无「历史测试结果」横幅 且 有返回 JSON**，才算本次新结果，轮询间隔 3~4 秒，最多 6 次。
6. **后台坐标 click 穿不透 Electron webview**。所有点击一律 `perform_action {action:'invoke', element_id}`，不要用 click(x,y)。需要关闭面板/折叠区块时也先在树里找按钮 id。
7. **导航/弹窗/重渲染后无障碍树失效**（返回 ~928 字符 no-change 或 ~5900 旧缓存）：先跑 fg.ps1 置前窗口，sleep ~1s 再 get_app_state；元素 id 每次渲染都变，现取现用。
8. **DOM 被大结果（如 my_demands 长列表）撑爆后，树长期卡在 ~5900 字符**：`perform_action set_focus element_id=3`（document 节点）→ `press_key key=r modifiers=['ctrl']` 重载 webview（登录态保留，停在云函数列表）→ 重新搜索函数开面板。规避办法：大结果用例安排在每轮最后，或让函数加精简返回。
9. **单个 Exec 不要长流程**：1800 秒硬超时且无中间输出。经验：≤4 个用例/Exec、控制在 ~1000 秒内；每个 Exec 只做一组同函数用例（切函数本身也要 50 秒左右）。
10. **切函数流程**：点面板右上关闭按钮（树里找 `测试普通云函数` 标题后的 close 按钮 id，或 Ctrl+R 重载更稳）→ 列表搜索框 `edit "搜索云函数名称"` set_value 函数名 → 行内 `button "云端测试"` invoke → sleep 2.5s → 记录面板初始 RequestId 为基线。
11. **CLI info 不支持逗号多函数**：`cli cloud functions info --names fnA` 逐个查。
12. **v2.0.3 结果节点（2026-09-13 起）**：短结果=12 空格缩进 `text "{...}" id=N`，位于 `text "返回结果"` 之后、`button "arrowdown 摘要"` 之前；**长结果**（hall_list/my_demands）= `group` 内嵌 14 空格 `text "{...}"`，单行可上千字符，用 `/text "(\{.*\})" id=\d+\s*$/` 整行抠出再 JSON.parse（hall_list 条目主键叫 `demand_id` 不是 `_id`）。
13. **读结果优先"固定等待+单次读树"**：invoke「运行测试」后 sleep 12 秒（msgSecCheck 类 16 秒），再找 `text "返回结果"` 行向下取含 `"ok"` 的行。v2.0.3 按 RequestId 变化轮询会大量误判 NO_RESULT（调用其实成功了）。
14. **切函数先关面板**：标题区 `text "测试普通云函数"` … `text "demand-xxx"` … `button "关闭"`，invoke 关闭并确认标题消失后再搜索下一函数；不关面板直接换搜索+云端测试会停在旧函数（曾把 my_demands 发到 demand-match 返 `match_unknown_action`）。
15. **33 位 hex _id 会让 doc() 寻址失败**：CloudBase 自动 id 为 32 位；异常 33 位 id `where` 查得到但 `collection.doc(id).get()` 抛错（被 catch 成 not_found）。发单后检查 _id 长度，异常夹具直接重发，别在广播上耗时间。

## 推荐驱动骨架（integrated_code_mode Exec 内）

```js
async function cu(tool, args){ return await tools.run_mcp({server_name:'ide_mcp.config.ext.computer-use',tool_name:tool,args}); }
const PID=17872, WID=307760310;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rawTree(){
  const s=await cu('get_app_state',{pid:PID,windowId:WID,disableDiff:true});
  const t=(s.content||[]).map(c=>c.text||'').join('\n');
  const m=t.match(/read (\S+\.txt)/);
  if(m){ const r=await tools.Shell({command:'Get-Content -Raw -LiteralPath \''+m[1]+'\'',timeout:30000});
         const out=(r.stdout||r.output||'').toString(); if(out.length>1000) return out; }
  return t;
}
function editorLine(t){ return (t.split('\n').find(l=>/edit \[set_value,set_focus\] val="\{/.test(l)))||''; }
function resultInfo(t){
  const rid=(t.match(/data-item "([0-9a-f]{8}-[0-9a-f-]+)"/)||[])[1];
  const ban=t.includes('历史测试结果');
  const ln=t.split('\n').find(l=>/^\s+text "\{/.test(l))||'';
  const a=ln.indexOf('{'),b=ln.lastIndexOf('}');
  return {rid,ban,raw:a>=0?ln.slice(a,b+1):''};
}
async function runOnce(ev, marker /* ev 中独有值的字符串形式 */){
  for(let k=0;k<4;k++){
    const t=await rawTree();
    const m=editorLine(t).match(/id=(\d+)\s*$/);
    if(!m){ await sleep(800); continue; }
    await cu('set_value',{pid:PID,element_id:m[1],value:JSON.stringify(ev)});
    await sleep(1000);
    if(editorLine(await rawTree()).includes(marker)) break;  // 回读校验
  }
  let t=await rawTree();
  const rb=t.match(/button "运行测试"[^\n]*id=(\d+)/);
  await cu('perform_action',{pid:PID,element_id:rb[1],action:'invoke'});
  // 轮询：维护外部 lastRid，判定 rid!==lastRid && !ban && raw
}
```

## 结果记录

- 每轮 PASS/FAIL 汇总追加写入 `.tmp-cloud-runner/regression-log.md`（若采用）；关键 ID（demand_id/order_id）及时写回 `.tmp-cloud-runner/vars.json`。
- demand-publish 成功返回的是 **`data._id`**（不是 demand_id）；批量取 ID 用 `{action:'my_demands'}` 的 `data.list`。
- mock 身份：发单人 A=`oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c`，耍伴 B=`test_partner_001`；云函数取身份 `cloud.getWXContext().OPENID || event.mock_openid`。_id 必须 32 位 hex。
