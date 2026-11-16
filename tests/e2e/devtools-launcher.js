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
  await new Promise((resolve, reject) => {
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
