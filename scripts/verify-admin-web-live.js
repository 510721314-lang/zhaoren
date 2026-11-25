// admin-web 线上部署自证门禁（B2 防复发：杜绝「源码改了/测了但没部署，台账却写已上线」）
//
// 背景：2026-11-25 事故——Operations.vue 场景/服务项目整合已于 11:10 提交并 11:42 @VERIFIED，
// 但漏执行 build + hosting deploy，线上仍为旧构建，台账误记「已部署上线」。
// 本门禁把「人工探针回读」固化为可重复脚本：部署后必跑，命中才允许在台账写「已部署上线」。
//
// 用法：
//   node scripts/verify-admin-web-live.js <chunk关键字> <预期指纹> [--local <本地dist文件>]
//   例：node scripts/verify-admin-web-live.js Operations "仅 online 对小程序端可见" \
//          --local admin-web-frontend/dist/assets/Operations-CKYF4fYU.js
//
// 判据：
//   1. fetch 线上 index.html（no-cache + cache-buster）→ 定位入口 index-*.js
//   2. fetch 入口 chunk → 解析全量 chunk 文件名（含路由懒加载）→ 定位含 <chunk关键字> 的 chunk；找不到 → FAIL
//   3. fetch 该 chunk（no-cache）→ 断言 UTF-8 解码后内容含 <预期指纹>；不含 → FAIL
//   4. 带 --local 时，额外断言线上下载内容与本地文件 SHA256 一致；不一致 → FAIL
// 防假通过：任何 fetch 非 200 / chunk 未找到 / 指纹未命中 / SHA256 不一致 → 打印详情 + exit 1，
//           严禁「解析不到结果 = 通过」。exit 0 = 全绿。
// 环境变量：SITE 覆盖托管地址（默认项目静态托管）；CACHE_BUST=0 关闭 cache-buster 参数。
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_SITE = 'https://cloud1-d9gkefwcp5c777088-1482004365.tcloudbaseapp.com';
const site = process.env.SITE || DEFAULT_SITE;
const args = process.argv.slice(2);
let localPath = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--local') { localPath = args[++i]; continue; }
  positional.push(args[i]);
}
const [chunkKey, fingerprint] = positional;
if (!chunkKey || !fingerprint) {
  console.error('用法: node scripts/verify-admin-web-live.js <chunk关键字> <预期指纹> [--local <文件>]');
  process.exit(2);
}
const UA = 'verify-admin-web-live/1.0 (+zhaoren)';
const noCacheHeaders = { 'Cache-Control': 'no-cache', Pragma: 'no-cache', 'User-Agent': UA };

function fetch(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      { hostname: u.hostname, path: u.pathname + u.search, headers: noCacheHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout 30s')));
  });
}

(async () => {
  const t0 = Date.now();
  try {
    // 1. index.html（cache-buster 绕 CDN）→ 只引用入口 index-*.js；
    //    路由懒加载 chunk（如 Operations-*.js）的文件名编码在入口 bundle 内，须二次解析。
    const bust = process.env.CACHE_BUST === '0' ? '' : `?_=${Date.now()}`;
    const idx = await fetch(`${site}/${bust}`);
    if (idx.status !== 200) throw new Error(`index.html HTTP ${idx.status}`);
    const html = idx.body.toString('utf8');
    const entryMatch = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    if (!entryMatch) throw new Error('index.html 未找到入口 index-*.js');
    const entry = entryMatch[1];
    // 2. fetch 入口 chunk，从中提取全量 chunk 文件名（含 Operations 等路由懒加载 chunk）
    const entryRes = await fetch(`${site}/assets/${entry}`);
    if (entryRes.status !== 200) throw new Error(`入口 ${entry} HTTP ${entryRes.status}`);
    const entryText = entryRes.body.toString('utf8');
    const jsFiles = [...new Set([...entryText.matchAll(/[A-Za-z0-9_-]+\.js/g)].map((m) => m[0]))];
    const target = jsFiles.find((f) => f.includes(chunkKey));
    if (!target) {
      const shown = jsFiles.slice(0, 12).join(', ');
      throw new Error(`未找到含「${chunkKey}」的 chunk（候选${jsFiles.length > 12 ? `前12` : ''}: ${shown}${jsFiles.length > 12 ? '…' : ''}）`);
    }
    console.log(`[index.html] HTTP ${idx.status} 入口=${entry} → 解析 chunk ${jsFiles.length} 个，命中目标: ${target}`);

    // 3. fetch 目标 chunk，UTF-8 解码（避免 PS Invoke-WebRequest 中文解码假象）
    const op = await fetch(`${site}/assets/${target}`);
    if (op.status !== 200) throw new Error(`${target} HTTP ${op.status}`);
    const text = op.body.toString('utf8');
    console.log(`[chunk] ${target} HTTP ${op.status} 字节=${op.body.length}`);
    const hit = text.includes(fingerprint);
    console.log(`[指纹] 预期「${fingerprint}」命中: ${hit}`);
    if (!hit) throw new Error(`指纹未命中：线上 ${target} 不含预期内容（线上可能非最新构建）`);

    // 3. 可选：线上 vs 本地 dist SHA256 逐字节对比
    if (localPath) {
      if (!fs.existsSync(localPath)) throw new Error(`--local 文件不存在: ${localPath}`);
      const liveHash = crypto.createHash('sha256').update(op.body).digest('hex');
      const localHash = crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex');
      console.log(`[SHA256] 线上=${liveHash} 本地=${localHash} MATCH=${liveHash === localHash}`);
      if (liveHash !== localHash) throw new Error('SHA256 不一致：线上与本地 dist 内容不同');
    }
    console.log(`PASS verify-admin-web-live (${Date.now() - t0}ms) chunk=${target}`);
    process.exit(0);
  } catch (e) {
    console.error(`FAIL verify-admin-web-live: ${e.message}`);
    process.exit(1);
  }
})();
