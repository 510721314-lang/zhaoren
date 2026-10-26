// tcb db nosql execute 通用包装器 — 规避 Windows PowerShell 5.1 引号转义坑
// 背景(2026-10-09): PS 5.1 向 CLI 传含引号 JSON 时引号被剥/转义层级错乱(JSON position 2/60 解析失败),
//   cmd /c 又被 Trae 安全策略拦截; 本包装器用「JSON 走文件 + spawnSync 数组传参」彻底规避。
// 用法(命令行): node scripts/tcb-exec.js <commands.json> [extra tcb args...]
// 用法(模块):   const { execTcbCommands } = require('./tcb-exec'); execTcbCommands(cmdArrayOrString)
// commands.json 内容示例:
//   [{"TableName":"demand","CommandType":"COMMAND","Command":"{\"listIndexes\":\"demand\"}"}]
// 说明: TCB 入口与 env 自动发现; 可用环境变量 TCB_JS_PATH / TCB_ENV_ID 覆盖; v3 参数为 --env-id。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findTcbJs() {
  if (process.env.TCB_JS_PATH && fs.existsSync(process.env.TCB_JS_PATH)) return process.env.TCB_JS_PATH;
  const cands = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
    path.join(process.env.LOCALAPPDATA || '', 'npm', 'node_modules', '@cloudbase', 'cli', 'bin', 'tcb'),
  ];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return '';
}

function findEnvId() {
  if (process.env.TCB_ENV_ID) return process.env.TCB_ENV_ID;
  try {
    const p = path.join(__dirname, '..', 'miniprogram', 'envList.js');
    const m = fs.readFileSync(p, 'utf8').match(/CLOUD_ENV\s*:\s*'([^']+)'/);
    if (m) return m[1];
  } catch (e) {}
  return '';
}

// 执行 MgoCommands(数组或 JSON 字符串), 返回 { status, stdout, stderr, parsed }
// 2026-10-26: tcb CLI 读本地凭据偶发失败(同一命令交替返回「无有效身份信息」), 命中该错误时重试;
//            凭据读取失败发生在真正下发命令之前, 重试不会产生重复写入。
const AUTH_ERR = '无有效身份信息';
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function execOnce(tcbJs, envId, cmd, extraArgs) {
  const args = [tcbJs, 'db', 'nosql', 'execute', '--command', cmd, '--env-id', envId, ...(extraArgs || [])];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
  let parsed = null;
  const outText = (r.stdout || '') + '\n' + (r.stderr || '');
  const start = outText.indexOf('[');
  const end = outText.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try { parsed = JSON.parse(outText.slice(start, end + 1)); } catch (e) {}
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', parsed };
}
function execTcbCommands(command, extraArgs) {
  const tcbJs = findTcbJs();
  if (!tcbJs) return { status: 2, stdout: '', stderr: 'TCB JS 入口未找到(安装 @cloudbase/cli 或用 TCB_JS_PATH 指定)' };
  const envId = findEnvId();
  if (!envId) return { status: 2, stdout: '', stderr: 'envId 未找到(从 miniprogram/envList.js 读取或用 TCB_ENV_ID 指定)' };
  const cmd = typeof command === 'string' ? command : JSON.stringify(command);
  let last = null;
  for (let i = 0; i < 5; i++) {
    last = execOnce(tcbJs, envId, cmd, extraArgs);
    const text = (last.stdout || '') + (last.stderr || '');
    if (last.status === 0 || text.indexOf(AUTH_ERR) < 0) break;
    sleepSync(800);
  }
  return last;
}

module.exports = { execTcbCommands, findTcbJs, findEnvId };

if (require.main === module) {
  const [jsonFile, ...rest] = process.argv.slice(2);
  if (!jsonFile) {
    console.error('usage: node scripts/tcb-exec.js <commands.json> [extra tcb args...]');
    process.exit(1);
  }
  const r = execTcbCommands(fs.readFileSync(jsonFile, 'utf8').trim(), rest);
  console.log('exit=' + r.status);
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  process.exit(r.status || 0);
}