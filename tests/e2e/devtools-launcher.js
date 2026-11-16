// DevTools 自启动 + 自动化端口 + 编译就绪轮询
// 供 smoke-pages.js / smoke-flows.js 等 e2e 测试复用
const { spawn, execSync } = require('child_process');
const path = require('path');
const { devtools } = require('../../scripts/load-env.cjs');

const PORT = devtools.autoPort || 9420;

function isListening(port) {
  try {
    execSync(`netstat -ano | findstr ":${port}.*LISTENING"`, { encoding: 'utf8' });
    return true;
  } catch (_) { return false; }
}

async function waitForPort(port, label, maxSec) {
  for (let i = 0; i < maxSec; i++) {
    if (isListening(port)) { console.log(`  [${i}s] ${label} :${port} 已监听`); return true; }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// 启动 DevTools GUI（如未运行）+ 开启自动化端口
async function startDevTools() {
  const ideExe = path.join(path.dirname(devtools.cliPath), '微信开发者工具.exe');
  if (!isListening(33306)) {
    console.log('启动 DevTools GUI ...');
    spawn(ideExe, [], { detached: true, stdio: 'ignore' }).unref();
  } else {
    console.log('DevTools 已在运行 (33306)');
  }
  if (!await waitForPort(33306, 'IDE server', 30)) {
    throw new Error('DevTools IDE server 未在 30s 内启动');
  }
  console.log('开启自动化端口 ...');
  // cli auto 在「IDE 已在运行」或「已处于自动化模式」时常返回非 0，不代表失败。
  // 策略：成功即返回；失败重试 1 次；仍失败则降级为「以 auto 端口是否监听为准」，
  // 由后续 connect 结果裁决（与 scripts/auto-ui-pages.js:75-81 语义对齐，G4）。
  const runCliAuto = () => new Promise((resolve, reject) => {
    const cli = `"${devtools.cliPath}"`;
    const p = spawn(cli, ['auto', '--project', devtools.projectPath, '--auto-port', String(PORT)],
      { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { out += d.toString(); });
    p.on('error', reject);
    p.on('exit', code => {
      if (code !== 0) reject(new Error(`cli auto 退出码 ${code}: ${out.slice(-300)}`));
      else resolve();
    });
  });
  try {
    await runCliAuto();
  } catch (firstErr) {
    console.log(`  cli auto 首次失败（${firstErr.message.slice(0, 80)}），2s 后重试 ...`);
    await new Promise(r => setTimeout(r, 2000));
    try {
      await runCliAuto();
    } catch (_secondErr) {
      console.log('  cli auto 重试仍失败，降级：以 auto 端口是否监听为准');
    }
  }
  if (!await waitForPort(PORT, 'auto port', 40)) {
    throw new Error(`自动化端口 ${PORT} 未在 40s 内开启`);
  }
}

// 连接后轮询 currentPage 直到成功（等编译完成）
async function waitForReady(mp, maxSec) {
  for (let i = 0; i < maxSec; i++) {
    try {
      const p = await mp.currentPage();
      if (p) { console.log(`  [${i}s] 编译完成，首页=${p.path}`); return true; }
    } catch (_) {}
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

module.exports = { PORT, startDevTools, waitForReady };
