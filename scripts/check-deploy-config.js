#!/usr/bin/env node
// scripts/check-deploy-config.js · 部署配置漂移检查(批2.4)
// 背景: DevTools CLI `cloud functions deploy` 只上传代码, 不应用函数目录 config.json 里的
//   timeout / triggers(多次部署后云端仍为默认 timeout=3, 定时器整夜不触发);
//   config.json 仅作「期望值台账」。本脚本把台账与云端实际值做 diff, 提前暴露「以为改了其实没生效」。
//
// 能力边界(实测 2026-10-12):
//   - cli `cloud functions info` 表格可读回 timeout / status / runtime; triggers / permissions 不在输出中
//     (只能云开发控制台核对), 故本脚本只比对 timeout(漂移最常见的项)。
//   - CLI 需 IDE 运行且已登录; 未就绪时降级为 WARN(exit 0), 不阻塞 CI/无 IDE 环境。
//
// 用法: node scripts/check-deploy-config.js [--offline]
//   --offline  只打印各函数 config.json 期望 timeout, 不查云端(供纯静态环境/CI)
// 退出码: 0=一致或无法判定(WARN) | 1=已确认的 timeout 漂移
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findEnvId } = require('./tcb-exec');

const ROOT = path.join(__dirname, '..');
const CF_DIR = path.join(ROOT, 'cloudfunctions');
const DEFAULT_CLI = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat'; // 2026-10-13 更正: 用户主用安装为 x86 路径(原桌面路径已不存在); 可用 WXCLI_PATH 覆盖
const OFFLINE = process.argv.indexOf('--offline') >= 0;

function resolveCli() {
  const p = process.env.WXCLI_PATH || DEFAULT_CLI;
  return fs.existsSync(p) ? p : '';
}

function expectedList() {
  const out = [];
  for (const name of fs.readdirSync(CF_DIR)) {
    const cfgPath = path.join(CF_DIR, name, 'config.json');
    if (!fs.existsSync(cfgPath)) continue;
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {
      out.push({ name, error: 'config.json 解析失败: ' + e.message });
      continue;
    }
    const trigs = Array.isArray(cfg.triggers) ? cfg.triggers.map((t) => t && t.name).filter(Boolean) : [];
    out.push({ name, timeout: typeof cfg.timeout === 'number' ? cfg.timeout : null, triggers: trigs });
  }
  return out;
}

// 从 info 表格解析某函数的 timeout: 表格用 │ 分列 → [name, status, timeout, runtime]
// 兜底: 若表格分隔符因编码异常丢失, 退化为「该函数名所在行内第一个整数」(status='Active' 无数字, 其后即 timeout)。
function parseTimeout(text, fn) {
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    if (line.indexOf(fn) < 0) continue;
    if (/\(index\)|--names/.test(line)) continue;                 // 跳过表头/命令行
    const cells = line.split(/[│|]/).map((s) => s.trim()).filter((s) => s !== '');
    if (cells[0] === fn) {
      const t = parseInt(cells[2], 10);
      if (Number.isInteger(t)) return t;
    }
    const m = line.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// 经 PowerShell 调用 CLI: 直接 spawn cli.bat 会因 IDE 端口文件路径解析异常而 initialize 失败
// (实测 2026-10-12: 直连报 ENOENT ...\User Data\<hash>\Default\.cli), 经 powershell -Command 调用则正常。
function queryTimeout(cli, envId, fn) {
  const ps = "& '" + cli + "' cloud functions info --env " + envId + " --project " + ROOT + " --names " + fn;
  // IDE 端口/实例偶发抖动会让单次调用无输出 → 重试一次(仍失败则上层按 WARN 处理, 不误判漂移)
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    const text = (r.stdout || '') + '\n' + (r.stderr || '');
    if (/InvalidParameterValue|invalid credential|not logged in|properly installed|please open and restart/i.test(text)) {
      return { error: text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(-1)[0] || 'CLI 调用失败' };
    }
    const t = parseTimeout(text, fn);
    if (t !== null) return { timeout: t };
  }
  return { timeout: null };
}

(function main() {
  const expected = expectedList();
  if (!expected.length) { console.log('DEPLOY-CONFIG OK: 无 config.json 可检查'); process.exit(0); }

  if (OFFLINE) {
    console.log('DEPLOY-CONFIG OFFLINE: 期望 timeout 台账(未查云端)');
    for (const e of expected) {
      console.log(`  ${e.name} timeout=${e.error ? 'ERR' : e.timeout}${e.triggers.length ? ' triggers=' + e.triggers.join(',') : ''}`);
    }
    process.exit(0);
  }

  const cli = resolveCli();
  if (!cli) {
    console.log(`[WARN] 未找到 DevTools CLI(${DEFAULT_CLI}), 跳过部署配置漂移检查(可设 WXCLI_PATH); 期望台账见 --offline`);
    process.exit(0);
  }
  const envId = findEnvId();
  if (!envId) { console.log('[WARN] 未取到 envId(miniprogram/envList.js), 跳过'); process.exit(0); }

  const fails = [];
  const warns = [];
  let checked = 0, skipped = 0;
  for (const e of expected) {
    if (e.error || e.timeout === null) { warns.push(`${e.name}: 台账缺失(${e.error || 'config.json 无 timeout 字段'})`); continue; }
    const r = queryTimeout(cli, envId, e.name);
    if (r.error) { warns.push(`${e.name}: CLI 不可用 → ${r.error}`); skipped++; continue; }
    if (r.timeout === null) { warns.push(`${e.name}: 未能从 info 输出解析 timeout`); skipped++; continue; }
    checked++;
    if (r.timeout !== e.timeout) {
      fails.push(`${e.name} | config.json 期望 timeout=${e.timeout}, 云端实际=${r.timeout}(CLI deploy 不应用 config.json → 需控制台手动改)`);
    }
    if (e.triggers.length) warns.push(`${e.name}: config.json 声明触发器 [${e.triggers.join(',')}] —— CLI info 不返回 triggers, 请控制台「触发器」核对`);
  }

  for (const w of warns) console.log('[WARN] ' + w);
  if (fails.length) {
    console.error(`DEPLOY-CONFIG FAILED: ${fails.length} 个函数 timeout 漂移(已查 ${checked} 个):`);
    for (const f of fails) console.error('  [MISS] ' + f);
    process.exit(1);
  }
  if (!checked) {
    console.log('[WARN] 未能从云端读回任何函数 timeout(IDE 未就绪?), 跳过比对');
    process.exit(0);
  }
  console.log(`DEPLOY-CONFIG OK: ${checked} 个函数 timeout 与 config.json 一致${skipped ? `, ${skipped} 个跳过(CLI 不可用)` : ''}`);
  process.exit(0);
})();
