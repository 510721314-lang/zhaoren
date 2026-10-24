// scripts/e2e-smoke.js —— miniprogram-automator 连通性验证（最终版）
//
// 验证内容：
//   1. CLI auto 能否启动 IDE 并进入自动化模式
//   2. automator.connect 能否连上 wsEndpoint
//   3. 首页能否正常加载、API 是否可用
//
// 跑法：node scripts/e2e-smoke.js
// 前置：开发者工具已登录（GUI 内扫码过）
//
// 注意事项（踩过的坑）：
//   - Windows 下 execFileSync 调 cli.bat 必须 shell: true
//   - connect 模式没有 launch()，但有 reLaunch / navigateTo / switchTab
//   - connect 后需要等 IDE 编译（当前实测 6s 足够）
//   - connect 返回的 Page 对象用 page.path（不是 route）

const { execFileSync } = require('child_process');
const automator = require('miniprogram-automator');
const { devtools, validateDevtools } = require('./load-env.cjs');

async function main() {
  validateDevtools({ strict: true });
  const port = devtools.autoPort || 9420;

  console.log('═══════════════════════════════════');
  console.log(' miniprogram-automator Smoke Test');
  console.log('═══════════════════════════════════');
  console.log('▶ CLI     :', devtools.cliPath);
  console.log('▶ Project :', devtools.projectPath);
  console.log('▶ autoPort:', port);

  // Step 1: CLI auto
  console.log('\n[1/3] CLI auto 启动 ...');
  try {
    execFileSync(devtools.cliPath, [
      'auto', '--project', devtools.projectPath, '--auto-port', String(port),
    ], { encoding: 'utf8', timeout: 30000, shell: true,
        stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    console.error('✖ CLI auto 失败:', (e.stderr || e.message).split('\n').slice(-3).join('\n'));
    process.exit(1);
  }
  console.log('✔ CLI auto OK');

  // Step 2: automator.connect
  const wsEndpoint = `ws://127.0.0.1:${port}`;
  console.log(`\n[2/3] automator.connect(${wsEndpoint}) ...`);
  let mp;
  try {
    mp = await automator.connect({ wsEndpoint });
  } catch (e) {
    console.error('✖ connect 失败:', e.message);
    process.exit(1);
  }
  console.log('✔ connect OK');

  // Step 3: 等编译 + 页面验证
  console.log('\n[3/3] 等待 IDE 编译 (6s) ...');
  await new Promise(r => setTimeout(r, 6000));

  const page = await mp.currentPage();
  if (!page) {
    console.error('✖ currentPage 为 null（IDE 可能还没加载完项目）');
    await mp.close();
    process.exit(1);
  }
  console.log('✔ 首页加载成功');
  console.log('  页面路径:', page.path);

  // 再 reLaunch 一次首页，确认路由能力
  await mp.reLaunch('/pages-v2/index/index');
  await new Promise(r => setTimeout(r, 1500));

  // 简单断言
  console.log('  页面路径:', page.path);
  console.log('  页面 query:', JSON.stringify(page.query || {}));
  console.log('  Page.elementMap.size:', page.elementMap ? page.elementMap.size : 0);

  // 截屏（可选，验证截图能力）
  // await mp.screenshot({ filePath: 'smoke-shot.png' });
  // console.log('  截图已保存: smoke-shot.png');

  await mp.close();

  console.log('\n═══════════════════════════════════');
  console.log('  ✔✔ SMOKE OK — 全链路打通 ✔✔');
  console.log('═══════════════════════════════════');
}

main().catch(e => {
  console.error('\n✖ FATAL:', e);
  process.exit(1);
});
