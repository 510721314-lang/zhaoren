// scripts/shared-copy-detect.js — F5「改名副本」检测(P2-6 收尾, 2026-11-02)
// M1 只按「同名文件」发现共享模块消费方: _shared/foo.js 被复制成 a/foo_v2.js 时,
// M1 判 0 消费方、SYNC_MAP 也不会登记 → 副本静默漂移。本模块按内容 SHA 比对:
// 函数目录内任意文件若与 _shared 某文件字节完全相同但相对路径不同, 即视为未登记副本。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// 递归列文件(相对路径, 统一 /); 跳过 node_modules 与 .git
function listFiles(dir, base = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(abs, rel));
    else if (ent.isFile()) out.push(rel);
  }
  return out;
}

// 返回 [{ dir, file, canonical }]: file 与 canonical 内容相同但路径不同
function detect(sharedDir, fnRoot, fnDirs) {
  const bySize = new Map();
  const canonicalByHash = new Map();
  for (const f of fs.readdirSync(sharedDir)) {
    const p = path.join(sharedDir, f);
    if (!fs.statSync(p).isFile()) continue;
    const size = fs.statSync(p).size;
    if (!bySize.has(size)) bySize.set(size, []);
    bySize.get(size).push(f);
    canonicalByHash.set(sha256(p), f);
  }
  const hits = [];
  for (const d of fnDirs) {
    for (const rel of listFiles(path.join(fnRoot, d))) {
      const abs = path.join(fnRoot, d, rel);
      if (!bySize.has(fs.statSync(abs).size)) continue;   // 体积不同者不可能字节相同, 省一次哈希
      const canonical = canonicalByHash.get(sha256(abs));
      if (canonical && rel !== canonical) hits.push({ dir: d, file: rel, canonical });
    }
  }
  return hits;
}

module.exports = { detect, listFiles, sha256 };
