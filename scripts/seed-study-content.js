// scripts/seed-study-content.js · S3 课程入库: docs/study-content/*.md → study_content
//
// 口径(方案 §4 S3):
//   ① 源文件为合规审后的 Markdown(<!-- doc:start ... --> ... <!-- doc:end --> 分块);
//   ② 默认 draft; 加 --publish 才置 published(需合规审通过后由用户确认);
//   ③ 幂等: subject+module_id+chapter_id 匹配; 内容一致跳过; 不存在 insert; 变化 update;
//   ④ 写入前做禁用指令扫描(否定语境除外)与字段完整性校验, 任一失败即中止, 不写库。
//
// 用法: node scripts/seed-study-content.js                 # dry-run(默认)
//       node scripts/seed-study-content.js --apply         # 写入 draft
//       node scripts/seed-study-content.js --apply --publish
const fs = require('fs');
const path = require('path');
const { execTcbCommands } = require('./tcb-exec');

const APPLY = process.argv.includes('--apply');
const PUBLISH = process.argv.includes('--publish');
// --subject=CODE 只处理指定科目(避免 --publish 波及其它未审核科目)
const SUBJECT_ONLY = (process.argv.find((a) => a.startsWith('--subject=')) || '').split('=')[1] || '';
const SRC_DIR = path.join(__dirname, '..', 'docs', 'study-content');
const BANNED = ['给药', '执行医嘱', '作出诊断', '开具处方', '调整用药', '实施治疗', '推荐药品', '推荐保健品', '保证治愈', '优先挂号', '走后门'];

function run(cmds) {
  const r = execTcbCommands(cmds);
  if (r.status !== 0) throw new Error('tcb failed: ' + String(r.stderr || r.stdout || '').slice(0, 400));
  return Array.isArray(r.parsed) ? r.parsed : ((r.parsed && r.parsed.data) || []);
}
function num(v, dft) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  if (v && typeof v === 'object') {
    if (v.$numberInt != null) return Number(v.$numberInt);
    if (v.$numberLong != null) return Number(v.$numberLong);
    if (v.$numberDouble != null) return Number(v.$numberDouble);
  }
  return dft == null ? 0 : dft;
}
function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /<!-- doc:start\r?\n([\s\S]*?)\r?\n-->([\s\S]*?)<!-- doc:end -->/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    out.push({ file: path.basename(file), meta, body: m[2].trim() });
  }
  return out;
}
function scanBanned(body) {
  const hits = [];
  for (const term of BANNED) {
    let idx = body.indexOf(term);
    while (idx !== -1) {
      // 否定语境窗口取 30 字: 覆盖「不出现…、…、走后门」这类列举式否定
      const pre = body.slice(Math.max(0, idx - 30), idx);
      // 否定语境(不得/不/禁止/严禁/勿)保留, 仅拦截指令式用法
      if (!/不|禁止|严禁|勿/.test(pre)) hits.push({ term, ctx: body.slice(Math.max(0, idx - 20), idx + term.length + 10).replace(/\n/g, ' ') });
      idx = body.indexOf(term, idx + term.length);
    }
  }
  return hits;
}

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.md')).sort();
if (!files.length) { console.error('❌ docs/study-content 下无 .md 文件'); process.exit(2); }

const docs = [];
const errors = [];
for (const f of files) {
  for (const d of parseFile(path.join(SRC_DIR, f))) {
    const subject = d.meta.subject;
    const moduleId = d.meta.module_id;
    const chapterId = d.meta.chapter_id;
    const title = d.meta.title;
    const sort = num(d.meta.sort, NaN);
    const label = `${f}:${subject}/${moduleId}/${chapterId}`;
    if (!['base', 'W1', 'OUTDOOR', 'PEIZHEN', 'ONLINE'].includes(subject)) errors.push(`${label} subject 非法`);
    if (!/^[A-Za-z0-9_]{1,12}$/.test(moduleId || '')) errors.push(`${label} module_id 非法`);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(chapterId || '')) errors.push(`${label} chapter_id 非法`);
    if (!Number.isInteger(sort) || sort < 1) errors.push(`${label} sort 非法`);
    if (!title || title.length > 40) errors.push(`${label} title 须为 1-40 字`);
    if (!d.body || d.body.length < 100) errors.push(`${label} body_md 少于 100 字`);
    const hits = scanBanned(d.body);
    if (hits.length) errors.push(`${label} 命中指令式禁用词: ${hits.map((h) => h.term + ' @ ' + h.ctx).join(' | ')}`);
    if (d.meta.status && !['draft', 'published'].includes(d.meta.status)) errors.push(`${label} status 非法`);
    docs.push({ subject, module_id: moduleId, chapter_id: chapterId, sort, title, body_md: d.body });
  }
}
if (errors.length) {
  console.error('❌ 校验失败, 未写库:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(3);
}
const scoped = SUBJECT_ONLY ? docs.filter((d) => d.subject === SUBJECT_ONLY) : docs;
if (SUBJECT_ONLY && !scoped.length) { console.error('❌ --subject=' + SUBJECT_ONLY + ' 无匹配章节'); process.exit(3); }
const labels = scoped.map((d) => d.subject + '|' + d.module_id + '|' + d.chapter_id);
const dup = labels.filter((x, i) => labels.indexOf(x) !== i);
if (dup.length) { console.error('❌ 重复定位: ' + [...new Set(dup)].join(', ')); process.exit(3); }

const existing = run([{ TableName: 'study_content', CommandType: 'QUERY', Command: JSON.stringify({ find: 'study_content', filter: {}, limit: 200 }) }]);
const byKey = {};
for (const d of existing) if (d && d.subject && d.module_id && d.chapter_id) byKey[d.subject + '|' + d.module_id + '|' + d.chapter_id] = d;

const creates = [], updates = [], skips = [];
for (const d of scoped) {
  const key = d.subject + '|' + d.module_id + '|' + d.chapter_id;
  const cur = byKey[key];
  const desiredStatus = PUBLISH ? 'published' : (cur && cur.status === 'published' ? 'published' : 'draft');
  const patch = Object.assign({}, d, { status: desiredStatus });
  if (!cur) { creates.push(patch); continue; }
  const same = cur.title === d.title && cur.body_md === d.body_md && num(cur.sort, 0) === d.sort && cur.status === desiredStatus;
  if (same) skips.push(patch); else updates.push({ _id: cur._id && (cur._id.$oid || cur._id), patch, diff: ['title', 'body_md', 'sort', 'status'].filter((k) => cur[k] !== patch[k] && !(k === 'sort' && num(cur.sort, 0) === d.sort)) });
}

const bySubject = {};
for (const d of scoped) bySubject[d.subject] = (bySubject[d.subject] || 0) + 1;
console.log(`源文件: ${files.join(', ')}; 文档=${scoped.length}${SUBJECT_ONLY ? '(--subject=' + SUBJECT_ONLY + ')' : ''} (${JSON.stringify(bySubject)})`);
console.log(`计划: insert=${creates.length} update=${updates.length} skip=${skips.length} 目标状态=${PUBLISH ? 'published' : 'draft'}`);
for (const u of updates) console.log(`  ~ ${u.patch.subject}/${u.patch.module_id}/${u.patch.chapter_id} 变更=${u.diff.join(',')}`);
if (!APPLY) { console.log('[DRY-RUN] 未写库; 确认合规后加 --apply [--publish]'); process.exit(0); }

const now = Date.now();
if (creates.length) {
  for (let i = 0; i < creates.length; i += 20) {
    const part = creates.slice(i, i + 20).map((d) => Object.assign({}, d, {
      is_deleted: false, created_at: now, updated_at: now, created_by: 'seed-study-content', updated_by: 'seed-study-content'
    }));
    run([{ TableName: 'study_content', CommandType: 'INSERT', Command: JSON.stringify({ insert: 'study_content', documents: part }) }]);
    console.log(`insert: ${Math.min(i + 20, creates.length)}/${creates.length}`);
  }
}
if (updates.length) {
  run([{
    TableName: 'study_content', CommandType: 'UPDATE',
    // _id 是 ObjectId, CLI 传字符串会静默 0 命中; 用自然键 subject+module_id+chapter_id 更新
    Command: JSON.stringify({ update: 'study_content', updates: updates.map((u) => ({ q: { subject: u.patch.subject, module_id: u.patch.module_id, chapter_id: u.patch.chapter_id }, u: { $set: Object.assign({}, u.patch, { updated_at: now, updated_by: 'seed-study-content' }) } })) })
  }]);
  console.log(`update: ${updates.length}`);
}

const after = run([{ TableName: 'study_content', CommandType: 'QUERY', Command: JSON.stringify({ find: 'study_content', filter: {}, limit: 200 }) }]);
const stat = {};
for (const d of after) {
  if (!d || !d.subject) continue;
  const k = d.subject + '/' + (d.status || '?');
  stat[k] = (stat[k] || 0) + 1;
}
const missing = labels.filter((k) => !after.some((d) => d && d.subject + '|' + d.module_id + '|' + d.chapter_id === k));
console.log(`DONE: 库内=${after.length} ${JSON.stringify(stat)}; missing=${missing.length}${missing.length ? ' → ' + missing.join(',') : ''}`);
if (missing.length) process.exit(4);
