// P2 专用测试编排器：一键跑 P0(45页) + P1(6链路)，产出 Markdown 报告
// 用法：node tests/e2e/run-all.js
const { spawnSync } = require('child_process');
const path = require('path');

function runScript(scriptPath, label) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`▶ ${label}`);
  console.log(`${'='.repeat(60)}`);
  const result = spawnSync('node', [scriptPath], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    timeout: 300000,
  });
  const output = (result.stdout || '') + (result.stderr || '');
  console.log(output);
  // 解析 SUMMARY 行
  const summaryMatch = output.match(/SUMMARY:\s+(\d+)\/(\d+)\s+PASS,\s+(\d+)\s+FAIL/);
  let pass = 0, total = 0, fail = 0;
  if (summaryMatch) {
    pass = parseInt(summaryMatch[1]);
    total = parseInt(summaryMatch[2]);
    fail = parseInt(summaryMatch[3]);
  }
  // 收集失败用例
  const failures = [];
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes('FAIL') && !line.includes('SUMMARY')) {
      failures.push(line.trim());
    }
  }
  return { label, pass, total, fail, failures, exitCode: result.status };
}

function classifyFailure(line) {
  // 失败归因：脚本缺陷 vs 产品缺陷
  const scriptDefectPatterns = [
    'reLaunch returned undefined',
    'is not a function',
    'Cannot read property',
    'timeout waiting for automator',
    'Connection closed',
  ];
  for (const pat of scriptDefectPatterns) {
    if (line.includes(pat)) return { type: '脚本缺陷', reason: '自动化脚本/环境问题' };
  }
  return { type: '产品缺陷', reason: '需人工复现确认' };
}

(async () => {
  const startTime = new Date();
  const p0 = runScript(path.join(__dirname, 'smoke-pages.js'), 'P0 页面冒烟 (45 页)');
  const p1 = runScript(path.join(__dirname, 'smoke-flows.js'), 'P1 链路冒烟 (6 条)');

  const totalPass = p0.pass + p1.pass;
  const totalAll = p0.total + p1.total;
  const totalFail = p0.fail + p1.fail;
  const allFailures = [...p0.failures, ...p1.failures];

  // 生成报告
  const report = [];
  report.push('# 小程序 UI 自动化测试报告');
  report.push('');
  report.push('## 概览');
  report.push(`- 测试时间：${startTime.toLocaleString('zh-CN')}`);
  report.push(`- 用例总数：${totalAll}`);
  report.push(`- 通过：${totalPass} / 失败：${totalFail}`);
  report.push('');
  report.push('| 阶段 | 通过 | 总数 | 状态 |');
  report.push('|---|---|---|---|');
  report.push(`| P0 页面冒烟 | ${p0.pass} | ${p0.total} | ${p0.fail === 0 ? '✅' : '❌'} |`);
  report.push(`| P1 链路冒烟 | ${p1.pass} | ${p1.total} | ${p1.fail === 0 ? '✅' : '❌'} |`);
  report.push('');

  if (allFailures.length > 0) {
    report.push('## 失败归因');
    report.push('');
    report.push('| # | 用例 | 类型 | 说明 |');
    report.push('|---|---|---|---|');
    allFailures.forEach((f, i) => {
      const cls = classifyFailure(f);
      report.push(`| ${i + 1} | ${f.slice(0, 60)} | ${cls.type} | ${cls.reason} |`);
    });
    report.push('');
  } else {
    report.push('## 冒烟结论');
    report.push('');
    report.push('✅ **全部通过** — P0 页面冒烟 + P1 链路冒烟均无失败');
    report.push('');
  }

  report.push('---');
  report.push(`_生成于 ${new Date().toLocaleString('zh-CN')}，耗时 ${((Date.now() - startTime.getTime()) / 1000).toFixed(0)}s_`);

  const reportText = report.join('\n');
  console.log('\n\n' + reportText);

  // 写报告文件
  const fs = require('fs');
  const reportPath = path.join(__dirname, '..', '..', 'docs', 'session-log', `e2e-report-${startTime.toISOString().slice(0, 10)}.md`);
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, reportText, 'utf8');
    console.log(`\n报告已写入: ${reportPath}`);
  } catch (e) {
    console.log(`\n(报告写入失败: ${e.message})`);
  }

  process.exit(totalFail > 0 ? 1 : 0);
})();
