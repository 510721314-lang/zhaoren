// scripts/seed-outdoor-exam.js · 线下户外陪伴（OUTDOOR）科目入库
//
// 口径:
//   ① 科目 meta 落 exam_bank（exam_subject_create 已退役，新增科目只能脚本直写；幂等按 code 匹配）;
//   ② 题目源为 docs/线下户外陪伴SOP与岗前考试题库_合订本.md 的 A 卷（30 题 / 100 分）;
//      运行时 partner-action 只拉 paper=A，故仅导入 A 卷;
//   ③ 导入前与文档「A卷 答案速查表」逐题核对答案，不一致即中止（防解析错位导致判分错误）;
//   ④ 幂等: 按 subject+qid 匹配；内容一致跳过，变化 update，不存在 insert;
//   ⑤ 字段口径对齐 admin-action/action_question.js#validateQuestion（题干 ≤500、选项 2-6 项且 ≤50 字、
//      解析 ≤500、知识点 ≤50、分值 1-100）;
//   ⑥ 分值 3/4 为文档原值，仅作元数据展示；现运行时为等权判分（round(正确数/题数*100)），
//      pass_line=100 即 30 题全对。
//
// 用法: node scripts/seed-outdoor-exam.js            # dry-run(默认, 只读)
//       node scripts/seed-outdoor-exam.js --apply    # 写库
const fs = require('fs');
const path = require('path');
const { execTcbCommands } = require('./tcb-exec');

const APPLY = process.argv.includes('--apply');
const SUBJECT = 'OUTDOOR';
const SRC = path.join(__dirname, '..', 'docs', '线下户外陪伴SOP与岗前考试题库_合订本.md');
const SUBJECT_META = {
  code: SUBJECT,
  title: '线下户外陪伴',
  desc: '55–75 岁纯线下户外陪伴场景专项，90 分通过；需先通过基础考试',
  pass_line: 90,
  requires: ['base'],
  enabled: true
};
const DIFFICULTY = { 易: 'easy', 中: 'medium', 难: 'hard' };
const LETTER_IDX = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

function run(cmds) {
  const r = execTcbCommands(cmds);
  if (r.status !== 0) throw new Error('tcb exec failed: ' + String(r.stderr || r.stdout || '').slice(0, 400));
  const arr = r.parsed;
  if (Array.isArray(arr)) return arr;
  if (arr && Array.isArray(arr.data)) return arr.data;
  return [];
}

function stripMd(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    // 中文排版中的多余空格（如「气温 ≥35℃」「避开 10:00」）：贴齐 CJK 时去掉，避免选项超 50 字上限
    .replace(/([\u4e00-\u9fa5])\s+/g, '$1')
    .replace(/\s+([\u4e00-\u9fa5])/g, '$1')
    .trim();
}

// ── 解析 A 卷 ──
function parsePaper() {
  const text = fs.readFileSync(SRC, 'utf8');
  const from = text.indexOf('## 2.4 A卷');
  const to = text.indexOf('### 二、A卷 答案速查表');
  if (from < 0 || to < 0 || to <= from) throw new Error('未定位到 A 卷区间（2.4 起 / 答案速查表止）');
  const section = text.slice(from, to);
  const headerRe = /^#### (A-\d{2})｜(单选|多选)｜(\d+)分｜(M\d{1,2})\s*$/gm;
  const heads = [];
  let m;
  while ((m = headerRe.exec(section))) {
    heads.push({ qid: m[1], typeText: m[2], score: Number(m[3]), module: m[4], at: m.index, bodyAt: headerRe.lastIndex });
  }
  const errors = [];
  const list = [];
  heads.forEach((h, i) => {
    const body = section.slice(h.bodyAt, i + 1 < heads.length ? heads[i + 1].at : section.length);
    const kn = body.match(/\*\*知识点\*\*[：:]\s*(.*?)\s*\*\*难度\*\*[：:]\s*(\S+)/);
    const stemAt = body.indexOf('**题干**');
    const ansAt = body.search(/\*\*答案\*\*[：:]/);
    if (kn == null) errors.push(`${h.qid} 缺少「知识点／难度」行`);
    if (stemAt < 0 || ansAt < 0) { errors.push(`${h.qid} 缺少题干或答案`); return; }
    const stemBlock = body.slice(stemAt, ansAt);
    const optLines = stemBlock.split(/\r?\n/).filter((l) => /^-\s*[A-F]\s*[.、]/.test(l.trim()));
    if (!optLines.length) { errors.push(`${h.qid} 未解析到选项`); return; }
    const firstOptAt = stemBlock.search(/^-\s*[A-F]\s*[.、]/m);
    const stem = stripMd(stemBlock.slice(0, firstOptAt === -1 ? stemBlock.length : firstOptAt).replace(/\*\*题干\*\*[：:]/, ''));
    const options = optLines.map((l) => stripMd(l.replace(/^-\s*[A-F]\s*[.、]/, '')));
    const afterAns = body.slice(ansAt);
    const ansLine = afterAns.split(/\r?\n/)[0];
    const answerText = stripMd(ansLine.replace(/\*\*答案\*\*[：:]/, ''));
    const analysisMatch = afterAns.match(/\*\*解析\*\*[：:]([\s\S]*)$/);
    const analysis = stripMd(analysisMatch ? analysisMatch[1] : '');
    const letters = answerText.replace(/[,，、\s]/g, '').split('');
    const type = h.typeText === '多选' ? 'multi' : 'single';
    const idx = [];
    for (const L of letters) {
      if (!(L in LETTER_IDX)) { errors.push(`${h.qid} 答案字母非法: ${answerText}`); return; }
      idx.push(LETTER_IDX[L]);
    }
    const uniq = Array.from(new Set(idx)).sort((a, b) => a - b);
    if (!uniq.length) errors.push(`${h.qid} 答案为空`);
    if (type === 'single' && uniq.length !== 1) errors.push(`${h.qid} 单选答案应为 1 项，实际 ${uniq.length}`);
    if (type === 'multi' && uniq.length < 2) errors.push(`${h.qid} 多选答案应 ≥2 项，实际 ${uniq.length}`);
    for (const n of uniq) if (n < 0 || n >= options.length) errors.push(`${h.qid} 答案索引 ${n} 超出选项数 ${options.length}`);
    if (options.length < 2 || options.length > 6) errors.push(`${h.qid} 选项数 ${options.length} 不在 2-6`);
    options.forEach((o, k) => { if (!o || o.length > 50) errors.push(`${h.qid} 选项 ${k + 1} 长度非法(${o.length})`); });
    if (!stem || stem.length > 500) errors.push(`${h.qid} 题干长度非法(${stem.length})`);
    if (analysis.length > 500) errors.push(`${h.qid} 解析超 500 字(${analysis.length})`);
    const knowledge = kn ? stripMd(kn[1]) : '';
    if (knowledge.length > 50) errors.push(`${h.qid} 知识点超 50 字(${knowledge.length})`);
    list.push({
      subject: SUBJECT,
      paper: 'A',
      module: h.module,
      qid: h.qid,
      type,
      stem,
      options,
      answer_idx: type === 'multi' ? uniq : uniq[0],
      score: h.score,
      difficulty: DIFFICULTY[kn ? kn[2].trim() : ''] || '',
      knowledge,
      analysis,
      status: 'published',
      version: 'V1'
    });
  });
  // 答案速查表交叉核对
  const tableRows = section.length ? text.slice(to).split(/\r?\n/).filter((l) => /^\|\s*A-\d{2}\s*\|/.test(l)) : [];
  const tableAnswer = {};
  for (const row of tableRows) {
    const cells = row.split('|').map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 8) continue;
    for (let i = 0; i + 3 < cells.length; i += 4) {
      if (/^A-\d{2}$/.test(cells[i])) tableAnswer[cells[i]] = cells[i + 3];
    }
  }
  for (const q of list) {
    const expect = tableAnswer[q.qid];
    if (!expect) { errors.push(`${q.qid} 答案速查表缺失`); continue; }
    const got = (Array.isArray(q.answer_idx) ? q.answer_idx : [q.answer_idx])
      .map((n) => 'ABCDEF'[n]).join('');
    if (expect !== got) errors.push(`${q.qid} 答案不一致: 正文=${got} 速查表=${expect}`);
  }
  if (heads.length !== 30) errors.push(`题目块数应为 30，实际 ${heads.length}`);
  return { list, errors };
}

// ── 主流程 ──
const { list, errors } = parsePaper();
const byModule = {};
let totalScore = 0;
for (const q of list) {
  byModule[q.module] = (byModule[q.module] || 0) + 1;
  totalScore += q.score;
}
console.log(`[解析] ${SRC}`);
console.log(`题目=${list.length} 总分=${totalScore} 单选=${list.filter((q) => q.type === 'single').length} 多选=${list.filter((q) => q.type === 'multi').length}`);
console.log(`模块分布: ${Object.keys(byModule).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).map((k) => k + '=' + byModule[k]).join(' ')}`);
if (errors.length) {
  console.error('❌ 解析/校验失败, 未写库:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(3);
}
console.log('✅ 解析校验通过（含与答案速查表逐题核对）');
if (totalScore !== 100) {
  console.error(`❌ 总分应为 100，实际 ${totalScore}`);
  process.exit(3);
}
if (process.argv.includes('--parse-only')) {
  console.log('参数样例: ' + JSON.stringify(list[0], null, 0));
  process.exit(0);
}

const now = Date.now();
const bankDocs = run([{ TableName: 'exam_bank', CommandType: 'QUERY', Command: JSON.stringify({ find: 'exam_bank', filter: { code: SUBJECT }, limit: 5 }) }]);
const bankCur = (bankDocs || []).find((d) => d && d.code === SUBJECT) || null;
const metaPatch = Object.assign({}, SUBJECT_META, { is_deleted: false, updated_at: now, updated_by: 'seed-outdoor-exam' });
const metaCreate = Object.assign({}, metaPatch, { created_at: now, created_by: 'seed-outdoor-exam' });
let metaPlan = 'create';
if (bankCur) {
  const cur = normCur(bankCur);
  const diff = ['title', 'desc', 'pass_line', 'requires', 'enabled', 'is_deleted'].filter(
    (k) => JSON.stringify(cur[k]) !== JSON.stringify(metaCreate[k])
  );
  metaPlan = diff.length ? 'update(' + diff.join(',') + ')' : 'skip';
}
console.log(`[exam_bank] ${SUBJECT}: ${metaPlan}`);

const existing = run([{ TableName: 'questions', CommandType: 'QUERY', Command: JSON.stringify({ find: 'questions', filter: { subject: SUBJECT, paper: 'A' }, limit: 1000 }) }]);
const byQid = {};
for (const d of (existing || [])) if (d && d.qid) byQid[d.qid] = d;
const SAME = ['subject', 'paper', 'module', 'qid', 'type', 'stem', 'options', 'answer_idx', 'score', 'difficulty', 'knowledge', 'analysis', 'status', 'version'];

// CLI 回读数字是 $numberInt/$numberLong/$numberDouble 包装对象, 比对前必须解码,
// 否则每次重跑都会把「相同题目」误判为 update 并刷新 updated_at(bank_ver 抖动)
function decNum(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (v.$numberInt != null) return Number(v.$numberInt);
    if (v.$numberLong != null) return Number(v.$numberLong);
    if (v.$numberDouble != null) return Number(v.$numberDouble);
    return v;
  }
  if (Array.isArray(v)) return v.map(decNum);
  return v;
}
function normCur(d) {
  const o = Object.assign({}, d);
  o.answer_idx = decNum(d.answer_idx);
  o.score = decNum(d.score);
  o.pass_line = decNum(d.pass_line);
  return o;
}

const creates = [];
const updates = [];
let skip = 0;
for (const q of list) {
  const curRaw = byQid[q.qid];
  if (!curRaw) { creates.push(q); continue; }
  const cur = normCur(curRaw);
  const diff = SAME.filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(q[k]));
  if (diff.length) updates.push({ qid: q.qid, doc: q, diff });
  else skip += 1;
}
console.log(`[questions] 现有=${Object.keys(byQid).length} 计划: insert=${creates.length} update=${updates.length} skip=${skip}`);
for (const u of updates) console.log(`  ~ ${u.qid} 变更=${u.diff.join(',')}`);

if (!APPLY) {
  console.log('[DRY-RUN] 未写库。确认后加 --apply 执行。');
  process.exit(0);
}

if (metaPlan === 'create') {
  run([{ TableName: 'exam_bank', CommandType: 'INSERT', Command: JSON.stringify({ insert: 'exam_bank', documents: [metaCreate] }) }]);
  console.log('insert exam_bank: 1');
} else if (metaPlan.startsWith('update')) {
  run([{ TableName: 'exam_bank', CommandType: 'UPDATE', Command: JSON.stringify({ update: 'exam_bank', updates: [{ q: { code: SUBJECT }, u: { $set: metaPatch } }] }) }]);
  console.log('update exam_bank: 1');
}

for (let i = 0; i < creates.length; i += 20) {
  const part = creates.slice(i, i + 20).map((q) => Object.assign({}, q, {
    is_deleted: false, created_at: now, updated_at: now, created_by: 'seed-outdoor-exam', updated_by: 'seed-outdoor-exam'
  }));
  run([{ TableName: 'questions', CommandType: 'INSERT', Command: JSON.stringify({ insert: 'questions', documents: part }) }]);
  console.log(`insert questions: ${Math.min(i + 20, creates.length)}/${creates.length}`);
}
for (const u of updates) {
  run([{ TableName: 'questions', CommandType: 'UPDATE', Command: JSON.stringify({ update: 'questions', updates: [{ q: { subject: SUBJECT, qid: u.qid }, u: { $set: Object.assign({}, u.doc, { is_deleted: false, updated_at: now, updated_by: 'seed-outdoor-exam' }) } }] }) }]);
  console.log(`update ${u.qid}`);
}

// ── 回读校验 ──
const bankAfter = run([{ TableName: 'exam_bank', CommandType: 'QUERY', Command: JSON.stringify({ find: 'exam_bank', filter: { code: SUBJECT }, limit: 5 }) }]);
const qAfter = run([{ TableName: 'questions', CommandType: 'QUERY', Command: JSON.stringify({ find: 'questions', filter: { subject: SUBJECT }, limit: 1000 }) }]);
const published = (qAfter || []).filter((d) => d && d.status === 'published' && d.paper === 'A' && !d.is_deleted).length;
const missing = list.map((q) => q.qid).filter((qid) => !(qAfter || []).some((d) => d && d.qid === qid && !d.is_deleted));
console.log(`\nDONE: exam_bank=${(bankAfter || []).length} questions(全卷)=${(qAfter || []).length} published(A卷)=${published}`);
console.log(`missing=${missing.length}${missing.length ? ' → ' + missing.join(',') : ''}`);
if (missing.length) process.exit(4);
