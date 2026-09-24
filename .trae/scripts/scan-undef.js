// zhaoren scan-undef.js — 未定义变量(裸引用)扫描
// 基于 eslint no-undef, 自动在 %TEMP%\trae-eslint 安装/复用 eslint
// 用法: node scan-undef.js <dir> <mp|node>
// 退出码: 0 = 通过 / 1 = 存在未定义引用 / 2 = eslint 不可用(跳过, 不算失败)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const dir = path.resolve(process.argv[2] || '');
const mode = process.argv[3] || 'mp';
if (!dir) { console.error('usage: node scan-undef.js <dir> <mp|node>'); process.exit(2); }

const ESLINT_DIR = path.join(os.tmpdir(), 'trae-eslint');
const PKG = path.join(ESLINT_DIR, 'node_modules', 'eslint');

function ensureEslint() {
  if (fs.existsSync(path.join(PKG, 'package.json'))) return true;
  console.log('[scan-undef] installing eslint (one-time, ~5s)...');
  fs.mkdirSync(ESLINT_DIR, { recursive: true });
  const pj = path.join(ESLINT_DIR, 'package.json');
  if (!fs.existsSync(pj)) fs.writeFileSync(pj, JSON.stringify({ name: 'trae-eslint', private: true, version: '1.0.0' }));
  const r = spawnSync('npm', ['install', 'eslint@9', '--no-save', '--no-audit', '--no-fund', '--prefix', ESLINT_DIR],
    { encoding: 'utf8', timeout: 120000, shell: true });
  if (r.status !== 0) { console.error('[scan-undef] eslint install failed, skip'); return false; }
  return true;
}

if (!ensureEslint()) process.exit(2);

const { Linter } = require(PKG);
const linter = new Linter();
const GLOBALS = {
  mp: {
    wx: 'readonly', App: 'readonly', Page: 'readonly', Component: 'readonly',
    Behavior: 'readonly', getApp: 'readonly', getCurrentPages: 'readonly',
    console: 'readonly', require: 'readonly', module: 'readonly', exports: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
    globalThis: 'readonly'
  },
  node: {
    require: 'readonly', module: 'readonly', exports: 'readonly', console: 'readonly',
    process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', __filename: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
    global: 'readonly', URL: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', fetch: 'readonly'
  }
};
const config = [{
  languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: GLOBALS[mode] || GLOBALS.mp },
  rules: { 'no-undef': 'error' }
}];

function walk(d, out = []) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'miniprogram_npm' || ent.name === '.git') continue;
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(dir);
if (!files.length) { console.log('[scan-undef] no js files'); process.exit(0); }
let total = 0;
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  const undef = linter.verify(code, config, f).filter((m) => m.ruleId === 'no-undef');
  for (const m of undef) { total++; console.log(` ${path.relative(dir, f)}:${m.line}:${m.column}  ${m.message}`); }
}
console.log(`\n[scan-undef] ${total === 0 ? 'PASS' : 'FAIL'}  undefined=${total} (files=${files.length})`);
process.exit(total === 0 ? 0 : 1);
