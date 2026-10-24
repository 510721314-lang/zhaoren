// scripts/load-env.cjs — 轻量 .env 解析器
// 不依赖 dotenv，仅用 Node 内置 fs；供 jest.config.cjs 与 e2e 测试脚本共用。
//
// 用法：
//   const { devtools, validateDevtools } = require('../scripts/load-env.cjs');
//   validateDevtools(); // 失败时抛出
//   automator.launch({ cliPath: devtools.cliPath, projectPath: devtools.projectPath })

const fs = require('fs');
const path = require('path');

/**
 * 从根目录 .env 读取 K=V 行，写入 process.env（不覆盖已显式 export 的变量）。
 * @param {string} rootDir 项目根目录（默认 __dirname/..）
 */
function loadEnv(rootDir) {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function resolveRoot() {
  // jest.config.cjs 在项目根目录，__dirname 就是根；
  // 测试脚本可能在子目录，向上找 .env 的位置。
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, '.env'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 回退：假设 .env 在 __dirname 的上一级（本项目布局）
  return path.resolve(__dirname, '..');
}

const ROOT = resolveRoot();
loadEnv(ROOT);

const devtools = {
  cliPath: process.env.WX_DEVTOOLS_CLI_PATH || '',
  projectPath: process.env.WX_PROJECT_PATH || ROOT,
  autoPort: process.env.WX_AUTO_PORT ? Number(process.env.WX_AUTO_PORT) : null,
  servicePort: process.env.WX_SERVICE_PORT ? Number(process.env.WX_SERVICE_PORT) : null,
};

function validateDevtools({ strict = false } = {}) {
  const problems = [];
  if (!devtools.cliPath) {
    problems.push('未配置 WX_DEVTOOLS_CLI_PATH，请在根目录 .env 中设置');
  } else if (!fs.existsSync(devtools.cliPath)) {
    problems.push(`cliPath 不存在: ${devtools.cliPath}`);
  }
  if (strict && problems.length) {
    throw new Error('[load-env] ' + problems.join('; '));
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { devtools, validateDevtools, ROOT };
