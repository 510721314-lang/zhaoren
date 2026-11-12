# zhaoren-auto-accept-test · 配置/picker 类真机验收的自动化验证

**Description**: 真机验收（picker/配置显示类）改走自动化验证口径。Use when 用户指定「自动化测试模式/自动化验收」、T-11.1 类三组 picker 收口、需实测 config_public 下发层或 audit 留痕活性、后台配置改动后的联动验收。Do not use for 纯 UI 视觉走查（走 wxapp-ui-polish）、纯代码逻辑单测（放 _shared/*.test.js）、云函数入口契约测试（走 cloud-entry-contract-test）。

## 四步法（顺序即依赖）

1. **埋标记**（用户侧，后台 UI）：在后台配置页新增/改名一条标记文案并保存（留痕走正规通道）——真机最终显示的标记项 = 全链路证据
2. **云端基线回读**（tcb nosql find）：直接读 `admin_config(_id:"global")` 的 reason_labels_* / modify_config 等投影，确认标记落库 + 各通道终值
3. **下发层断言**（本技能核心）：`tcb fn invoke admin-action --params '{"action":"config_public"}'` 实测**真实下发 payload**（免鉴权公开入口，普通用户可调，无需管理员 key），对五通道 reason_labels + modify_config 逐项断言
4. **加工逻辑单测**：`npm run test:s2-change`（mock 49/49：resolveModify/resolveS2Change 默认值与钳制、S2 分发）

**收口口径**：下发层（步骤 3 实证）+ 客户端映射（CLOUD_MAP 代码层已验证 + A/B 等价）= 自动化收口；纯 ActionSheet 渲染层挂真机回归（如 T-9.1 C 组）抽验。

## 步骤 3 实操模板（完整可抄）

```js
// %TEMP%\invoke-cp.js — tcb fn invoke config_public + 括号平衡解析
const { spawnSync } = require('child_process');
const fs = require('fs'); const path = require('path');
function findTcbJs() {
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    const p = path.join(base || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb');
    if (p && fs.existsSync(p)) return p;
  } return '';
}
const r = spawnSync(process.execPath, [findTcbJs(), 'fn', 'invoke', 'admin-action',
  '--params', JSON.stringify({ action: 'config_public', device: 'auto-test' }),
  '--env-id', 'cloud1-d9gkefwcp5c777088'], { encoding: 'utf8', timeout: 120000 });
const out = (r.stdout || '') + '\n' + (r.stderr || '');
const marker = out.indexOf('返回结果：');        // CLI 固定前缀
const tail = out.slice(marker + 5);
// 括号平衡扫描截 JSON（CLI 在 JSON 后还打「运行时间/请求 Id」等行，lastIndexOf('}') 会取错）
let depth = 0, inStr = false, esc = false, endIdx = -1;
const s = tail.indexOf('{');
for (let i = s; i < tail.length; i++) {
  const ch = tail[i];
  if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
  if (ch === '"') inStr = true; else if (ch === '{') depth++;
  else if (ch === '}' && --depth === 0) { endIdx = i; break; }
}
const data = JSON.parse(tail.slice(s, endIdx + 1)).data;
// 断言示例（按当轮基线改值）
const assert = require('node:assert');
assert.deepStrictEqual(data.modify_config, { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmMinutes: 10 });
const t = (a) => (data.reason_labels[a] || []).map((x) => x.t);
assert(t('noshow').length === 4 && !t('noshow').includes('测试'));
console.log('ALL PASS');
```

**断言清单设计**：每通道 `t` 文案列表（含当轮埋的标记项、排除已删项）+ `modify_config` 数值组 + `ok:true`。标记项断言必须「含标记 + 不含已删项」双向。

## 留痕活性验证（配套）

- 现成工具：`npm run audit:config`（scripts/audit-config-drift.js，2026-11-12 入库）——配置漂移巡检 + 三留痕通道（audit_log/config_history/platform_event）活性探针（error_scan 心跳噪声已排除）
- 后台一次保存是否留痕成功：`find audit_log {action:"admin_config_change"} sort {created_at:-1}` 最新一条的 `detail.reason`/`detail.after` 即该次写入留痕

## 台账查询三纪律（2026-11-12 漂移事故防复发，违反即误判）

1. **查「最新记录」必须 `sort created_at:-1`，禁止 `sort _id:-1`**——本项目 `_id` 是自定义 32-hex，不按时间序；错误排序曾致「留痕断 4 天」重大误判（实际留痕完好）
2. **时间戳换算禁口算**：一律 `[DateTimeOffset]::FromUnixTimeMilliseconds($ms).ToLocalTime()`；epoch 口算错误曾把 16:38 写成 22:38 入台账。基准：2026-11-12 00:00 UTC = 1794441600
3. **audit action 名以实测为准**：config_set 的镜像审计 action=`admin_config_change`（非 config_set）；`export_admin_config` 输出有脱敏投影——键不在输出 ≠ 键不存在

## 踩过的坑

- `tcb fn invoke` 输出用「返回结果：」前缀 + 后续日志行，**JSON 解析必须括号平衡扫描**（`lastIndexOf('}')` 取错）
- `tcb fn invoke` 走 CLI 主进程无引号坑；**不要**在 PowerShell 里直接传含引号 JSON（见 zhaoren-frequent-flows 流程 3）
- config_public 免鉴权但 `config_get` 需管理员白名单——自动化验证下发层用 config_public，不要混用
- 后台改配置 → 真机生效有缓存窗口（bootstrap ≤7 天 + 异步刷新）：真机抽验时先杀进程冷启动，文案仍旧值时退出详情重进一次
- `config_no_change`（同值保存）不产生 update 也不留痕——用「改值→保存→改回→保存」测留痕，同值保存测不出任何东西

## 先例与来源

2026-11-12 T-11.1 三组 picker 收口（用户选自动化口径 A）：mock 49/49 + 下发层 8/8 ALL PASS，REGISTRY #164/#166/#167/#168 转已验证（自动化口径备注）；详见 [CHANGELOG 2026-11-12](../../../docs/CHANGELOG.md) 与 [FUNCTION-REGISTRY #169](../../../docs/FUNCTION-REGISTRY.md)。
