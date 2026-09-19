// SSOT 硬编码审计：前端 config/index.js 不应有新增的业务阈值硬编码
// 所有阈值应从 admin_config 云端读取，config/index.js 仅作兜底默认值
// 用法: node scripts/check-ssot.js
// exit code 0 = 合规 | exit code 1 = 有硬编码待迁移

const fs = require('fs');
const path = require('path');

const CONFIG_JS = path.resolve(__dirname, '..', 'miniprogram', 'config', 'index.js');

if (!fs.existsSync(CONFIG_JS)) {
  console.log('config/index.js 不存在，跳过');
  process.exit(0);
}

const content = fs.readFileSync(CONFIG_JS, 'utf8');
const lines = content.split('\n');

// 可疑硬编码模式：直接写死的数值阈值（不是从 CONFIG 引用、不是注释、不是字符串常量）
// 这些应该从 admin_config 读取
const HARDCODE_PATTERNS = [
  // 金额阈值（分）: 5000/10000/20000/3000 等整数金额
  { re: /(rate_min|rate_max|fee|limit|cap|max|min|threshold)[^=]*=\s*\d{3,6}\b/i, desc: '金额/费率阈值' },
  // 时间: timeout/interval/duration 后跟直接秒数
  { re: /(timeout|interval|duration|window|expire)[^=]*=\s*\d+\s*[,;]?\s*\/\/\s*(?!可配|云端|admin_config)/i, desc: '时间阈值(需确认)' },
];

// 白名单：这些是纯前端展示常量或已在 admin_config 有对应的，允许保留
const WHITELIST_KEYWORDS = [
  'fallback', 'default', // 兜底值
  '// admin_config', '// 云端', '// TODO 可配', // 已标注待迁移
];

const findings = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const lineNum = i + 1;
  
  // 跳过注释行和空行
  if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim() === '') continue;
  
  // 检查是否有硬编码模式
  for (const pat of HARDCODE_PATTERNS) {
    if (pat.re.test(line)) {
      // 检查是否在白名单里
      const isWhitelisted = WHITELIST_KEYWORDS.some(kw => line.includes(kw));
      if (!isWhitelisted) {
        findings.push({ line: lineNum, content: line.trim(), desc: pat.desc });
      }
      break;
    }
  }
}

console.log(`\n=== SSOT 硬编码审计 ===`);
console.log(`config/index.js 总行数: ${lines.length}`);
console.log(`可疑硬编码: ${findings.length}`);

if (findings.length > 0) {
  console.log(`\n⚠️ 以下硬编码建议迁移到 admin_config 云端可配:`);
  for (const f of findings.slice(0, 20)) { // 最多显示20条
    console.log(`  L${f.line}: ${f.content.substring(0, 80)}  [${f.desc}]`);
  }
  if (findings.length > 20) console.log(`  ... 还有 ${findings.length - 20} 条`);
  console.log(`\n迁移方式: admin_config.global 新增字段 → 前端启动时 callCloud config_get → Object.assign(CONFIG, cloudConfig)`);
  process.exit(1);
} else {
  console.log(`\n✅ config/index.js 无新增硬编码，或全部已标注待迁移`);
  process.exit(0);
}
