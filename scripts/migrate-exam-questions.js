// scripts/migrate-exam-questions.js · S3 灌题: exam_bank.questions → questions(一题一文档)
//
// 口径(方案 §3 cutover 第 2 步):
//   ① 源优先级: exam_bank.questions(生产真源) → 该科目缺失时用 _shared/exam-fallback.js 兜底;
//   ② qid 规则: 每科目 `A-01` / `A-02` …(S2 仅 A 卷, qid 同 subject 内唯一);
//   ③ 幂等: 按 subject+qid 匹配, 内容一致跳过(不改 updated_at, 避免 bank_ver 抖动);
//      内容变化才 update(updated_at 前移 → bank_ver 更新); 不存在才 insert;
//   ④ bank_ver 基线: insert 时 updated_at 沿用源科目 exam_bank.updated_at,
//      使切换瞬间 bank_ver 与旧实现一致(在途考试不会被 pa_exam_bank_changed 误杀);
//   ⑤ status=published / paper=A, 只有 published 才会被运行时拉题命中。
//
// 用法: node scripts/migrate-exam-questions.js            # dry-run(默认, 只读)
//       node scripts/migrate-exam-questions.js --apply    # 写入 questions
//       --allow-fallback                                  # 仅首次灌题兜底; 第 5 步清空 exam_bank.questions 后默认拒绝回退源
const { execTcbCommands } = require('./tcb-exec');
const { EXAM_BANK_FALLBACK } = require('../cloudfunctions/_shared/exam-fallback');

const APPLY = process.argv.includes('--apply');
const ALLOW_FALLBACK = process.argv.includes('--allow-fallback');
const SUBJECT_ORDER = ['base', 'W1'];

function run(cmds) {
  const r = execTcbCommands(cmds);
  if (r.status !== 0) throw new Error('tcb exec failed: ' + String(r.stderr || r.stdout || '').slice(0, 300));
  const arr = r.parsed;
  if (Array.isArray(arr)) return arr;
  if (arr && Array.isArray(arr.data)) return arr.data;
  return [];
}

function num(v, dft) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  if (v && typeof v === 'object') {
    if (v.$numberInt != null) return Number(v.$numberInt);
    if (v.$numberLong != null) return Number(v.$numberLong);
    if (v.$numberDouble != null) return Number(v.$numberDouble);
  }
  return dft == null ? 0 : dft;
}

function normAnswerIdx(v) {
  const arr = Array.isArray(v) ? v : [v];
  const out = [];
  for (const x of arr) {
    // CLI 回读是 $numberInt 包装对象, 必须先解码(否则 answer_idx 会被写丢)
    const n = num(x, NaN);
    if (Number.isInteger(n) && n >= 0) out.push(n);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function qType(q) {
  if (q && (q.type === 'multi' || q.type === 'single')) return q.type;
  return Array.isArray(q && q.answer_idx) ? 'multi' : 'single';
}

function buildDoc(subject, idx, q, baseVer) {
  const answer = normAnswerIdx(q.answer_idx);
  return {
    subject,
    paper: 'A',
    module: '',
    qid: 'A-' + String(idx + 1).padStart(2, '0'),
    type: qType(q),
    stem: String(q.question || '').trim(),
    options: (q.options || []).map((o) => String(o || '').trim()),
    answer_idx: qType(q) === 'multi' ? answer : answer[0],
    score: 1,
    difficulty: '',
    knowledge: '',
    analysis: '',
    status: 'published',
    version: 'V1',
    is_deleted: false,
    created_at: baseVer || Date.now(),
    updated_at: baseVer || Date.now(),
    created_by: 'migration',
    updated_by: 'migration'
  };
}

const SAME_FIELDS = ['subject', 'paper', 'module', 'qid', 'type', 'stem', 'options', 'answer_idx', 'score', 'difficulty', 'knowledge', 'analysis', 'status', 'version', 'is_deleted'];

// Mongo 查询会把数字回读成 $numberInt/$numberDouble, 统一归一后再比内容,
// 否则每次 dry-run 都会把「相同题目」误判为 update。
function normDoc(d) {
  const o = Object.assign({}, d);
  // 缺失 answer_idx 用 NaN 哨兵: 与合法值 0 区分, 防止「答案丢失」被误判为一致
  o.answer_idx = Array.isArray(o.answer_idx) ? o.answer_idx.map((x) => num(x, NaN)) : num(o.answer_idx, NaN);
  o.score = num(o.score, 0);
  o.is_deleted = !!o.is_deleted;
  return o;
}

function sameContent(a, b) {
  const x = normDoc(a);
  const y = normDoc(b);
  return SAME_FIELDS.every((k) => JSON.stringify(x[k]) === JSON.stringify(y[k]));
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ── 读源 ──
const bankDocs = run([{
  TableName: 'exam_bank', CommandType: 'QUERY',
  Command: JSON.stringify({ find: 'exam_bank', filter: { is_deleted: { $ne: true }, enabled: true }, limit: 100 })
}]);
const bankByCode = {};
for (const d of bankDocs) {
  if (!d || !d.code) continue;
  bankByCode[d.code] = d;
}
const codes = Object.keys(bankByCode).sort((a, b) => {
  const ia = SUBJECT_ORDER.indexOf(a);
  const ib = SUBJECT_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
});

// ── 读目标现状 ──
const existing = run([{
  TableName: 'questions', CommandType: 'QUERY',
  Command: JSON.stringify({ find: 'questions', filter: {}, limit: 1000 })
}]);
const existingByKey = {};
for (const d of existing) {
  if (d && d.subject && d.qid) existingByKey[d.subject + '|' + d.qid] = d;
}
console.log(`source: exam_bank enabled 科目=${codes.join(',') || '(none)'}; questions 现有文档=${existing.length}`);

// ── 计划 ──
const creates = [];
const updates = [];
const skips = [];
const plannedKeys = new Set();
for (const code of codes) {
  const d = bankByCode[code];
  const srcQs = Array.isArray(d.questions) && d.questions.length ? d.questions : null;
  const fallback = EXAM_BANK_FALLBACK[code];
  // 第 5 步已清空 exam_bank.questions: 默认禁止用 fallback 反向覆盖 questions(防旧兜底题回灌)
  if (!srcQs && fallback) {
    if (!ALLOW_FALLBACK) {
      console.error(`\n❌ ${code}: exam_bank.questions 已退役, 拒绝用 fallback 作为迁移源(如确需首次兜底请加 --allow-fallback)`);
      process.exit(5);
    }
    console.warn(`\n⚠️ ${code}: 使用 fallback 兜底源(--allow-fallback)`);
  }
  const qs = srcQs || (fallback && fallback.questions) || [];
  const src = srcQs ? 'exam_bank' : (fallback ? 'fallback' : 'none');
  const baseVer = num(d.updated_at, 0);
  console.log(`\n[${code}] 源=${src} 题量=${qs.length} pass_line=${num(d.pass_line, 100)} requires=${JSON.stringify(d.requires || [])} base_ver=${baseVer}`);
  if (!qs.length) {
    console.log(`  ⚠️ 跳过: 无可用题目`);
    continue;
  }
  qs.forEach((q, i) => {
    const doc = buildDoc(code, i, q, baseVer);
    // 答案缺失/为空必须中止: undefined 会被 JSON 省略, 入库后题目永久无法判分
    if (doc.answer_idx === undefined || (Array.isArray(doc.answer_idx) && !doc.answer_idx.length)) {
      console.error(`\n❌ ${code} ${doc.qid} 源题目缺少合法 answer_idx, 中止迁移`);
      process.exit(4);
    }
    const key = doc.subject + '|' + doc.qid;
    plannedKeys.add(key);
    const cur = existingByKey[key];
    if (!cur) {
      creates.push(doc);
      console.log(`  + ${doc.qid} ${doc.type} ${doc.stem.slice(0, 24)}`);
    } else if (sameContent(cur, doc)) {
      skips.push(doc);
    } else {
      updates.push({ _id: cur._id, doc });
      const diff = SAME_FIELDS.filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(doc[k]));
      console.log(`  ~ ${doc.qid} 变更字段=${diff.join(',')}`);
    }
  });
}

const extras = existing.filter((d) => d && d.subject && d.qid && !plannedKeys.has(d.subject + '|' + d.qid));
if (extras.length) console.log(`\nℹ️ 目标中存在源未覆盖的文档(不删除): ${extras.map((d) => d.subject + '|' + d.qid).join(', ')}`);

console.log(`\n计划: insert=${creates.length} update=${updates.length} skip=${skips.length} 合计=${creates.length + updates.length + skips.length}`);
if (!APPLY) {
  console.log('[DRY-RUN] 未写库。确认后加 --apply 执行。');
  process.exit(0);
}

// ── 写入 ──
let inserted = 0;
for (const part of chunk(creates, 20)) {
  run([{
    TableName: 'questions', CommandType: 'INSERT',
    Command: JSON.stringify({ insert: 'questions', documents: part })
  }]);
  inserted += part.length;
  console.log(`insert: ${inserted}/${creates.length}`);
}

let updated = 0;
for (const part of chunk(updates, 20)) {
  const updatesCmd = part.map((x) => {
    const patch = Object.assign({}, x.doc);
    delete patch.created_at;
    delete patch.created_by;
    patch.updated_at = Date.now();
    // _id 是 ObjectId, CLI 传字符串静默 0 命中; 用自然键 subject+qid
    return { q: { subject: x.doc.subject, qid: x.doc.qid }, u: { $set: patch } };
  });
  run([{
    TableName: 'questions', CommandType: 'UPDATE',
    Command: JSON.stringify({ update: 'questions', updates: updatesCmd })
  }]);
  updated += part.length;
  console.log(`update: ${updated}/${updates.length}`);
}

// ── 回读校验 ──
const after = run([{
  TableName: 'questions', CommandType: 'QUERY',
  Command: JSON.stringify({ find: 'questions', filter: {}, limit: 1000 })
}]);
const afterByKey = {};
for (const d of after) if (d && d.subject && d.qid) afterByKey[d.subject + '|' + d.qid] = d;
const missing = [...plannedKeys].filter((k) => !afterByKey[k]);
const publishedBySubject = {};
for (const d of after) {
  if (d && d.status === 'published' && d.paper === 'A' && !d.is_deleted) {
    publishedBySubject[d.subject] = (publishedBySubject[d.subject] || 0) + 1;
  }
}
console.log(`\nDONE: insert=${inserted} update=${updated} skip=${skips.length}; 回读=${after.length}`);
console.log(`published(A卷) 按科目: ${JSON.stringify(publishedBySubject)}`);
console.log(`missing=${missing.length}${missing.length ? ' → ' + missing.join(',') : ''}`);
if (missing.length) process.exit(3);
