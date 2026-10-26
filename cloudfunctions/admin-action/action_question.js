// admin-action · 题库管理（S4: questions 成为题目唯一写入口）
// 背景: S3 已把拉题/判分切到 questions；本模块提供后台 CRUD/批量/导入，
//       旧 exam_subject_create/update/delete 与 exam_bank_seed 随后退役（见 action_exam.js）。
// 共享符号通过 ctx 注入，禁止反向 require('./index')。
// 口径: 自然键 subject+qid 定位（唯索引 uk_subject_qid）；不改写 exam_bank.updated_at，
//       C 端 bank_ver = 该科目 max(questions.updated_at)，改题后 ≤5 分钟缓存自然过期。

const SUBJECT_RE = /^[A-Za-z0-9_]{1,20}$/;
const QID_RE = /^[A-Za-z0-9_-]{1,20}$/;
const MODULE_RE = /^M\d{1,2}$/;
const DIFFICULTIES = ['', 'easy', 'medium', 'hard'];
const STATUSES = ['draft', 'published'];

// 题目入参校验/归一。返回 { doc } 或 { code, msg }。
function validateQuestion(input) {
  const subject = String(input.subject || '').trim();
  if (!SUBJECT_RE.test(subject)) return { code: 'question_bad_subject', msg: '科目 code 须为 1-20 位字母/数字/下划线' };
  const qid = String(input.qid || '').trim();
  if (!QID_RE.test(qid)) return { code: 'question_bad_qid', msg: '题号须为 1-20 位字母/数字/下划线/短横线' };
  const paper = String(input.paper || 'A').trim();
  if (!/^[A-Z]$/.test(paper)) return { code: 'question_bad_paper', msg: '试卷代号须为单个大写字母' };
  const module = String(input.module || '').trim();
  if (module && !MODULE_RE.test(module)) return { code: 'question_bad_module', msg: '模块须为 M1-M99 或留空' };
  const stem = String(input.stem || '').trim();
  if (!stem || stem.length > 500) return { code: 'question_bad_stem', msg: '题干须为 1-500 字' };
  const options = Array.isArray(input.options) ? input.options.map((o) => String(o == null ? '' : o).trim()) : [];
  if (options.length < 2 || options.length > 6) return { code: 'question_bad_options', msg: '选项须为 2-6 项' };
  for (let i = 0; i < options.length; i++) {
    if (!options[i] || options[i].length > 50) return { code: 'question_bad_option', msg: `第 ${i + 1} 个选项须为 1-50 字` };
  }
  let type = String(input.type || '').trim();
  if (!type) type = Array.isArray(input.answer_idx) ? 'multi' : 'single';
  if (type !== 'single' && type !== 'multi') return { code: 'question_bad_type', msg: '题型须为 single/multi' };
  const rawAns = Array.isArray(input.answer_idx) ? input.answer_idx : [input.answer_idx];
  const ans = [];
  for (const x of rawAns) {
    const n = Number(x);
    if (!Number.isInteger(n) || n < 0 || n >= options.length) return { code: 'question_bad_answer', msg: '答案索引超出选项范围' };
    ans.push(n);
  }
  if (!ans.length) return { code: 'question_bad_answer', msg: '答案不能为空' };
  let answerIdx;
  if (type === 'single') {
    if (ans.length !== 1) return { code: 'question_bad_answer', msg: '单选题答案只能有 1 项' };
    answerIdx = ans[0];
  } else {
    answerIdx = Array.from(new Set(ans)).sort((a, b) => a - b);
  }
  const score = input.score === undefined || input.score === '' ? 1 : Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 100) return { code: 'question_bad_score', msg: '分值须为 1-100 整数' };
  const difficulty = String(input.difficulty || '').trim();
  if (DIFFICULTIES.indexOf(difficulty) < 0) return { code: 'question_bad_difficulty', msg: '难度须为 easy/medium/hard 或留空' };
  const knowledge = String(input.knowledge || '').trim();
  if (knowledge.length > 50) return { code: 'question_bad_knowledge', msg: '知识点不超过 50 字' };
  const analysis = String(input.analysis || '').trim();
  if (analysis.length > 500) return { code: 'question_bad_analysis', msg: '解析不超过 500 字' };
  const status = String(input.status || 'draft').trim();
  if (STATUSES.indexOf(status) < 0) return { code: 'question_bad_status', msg: '状态须为 draft/published' };
  const version = String(input.version || 'V1').trim();
  if (!version || version.length > 20) return { code: 'question_bad_version', msg: '版本号须为 1-20 字' };
  return {
    doc: {
      subject, paper, module, qid, type, stem, options,
      answer_idx: answerIdx, score, difficulty, knowledge, analysis, status, version
    }
  };
}

function questionOut(d) {
  return {
    _id: d._id,
    subject: d.subject || '',
    paper: d.paper || 'A',
    module: d.module || '',
    qid: d.qid || '',
    type: d.type || (Array.isArray(d.answer_idx) ? 'multi' : 'single'),
    stem: d.stem || '',
    options: Array.isArray(d.options) ? d.options : [],
    answer_idx: d.answer_idx,
    score: Number(d.score) || 1,
    difficulty: d.difficulty || '',
    knowledge: d.knowledge || '',
    analysis: d.analysis || '',
    status: d.status || 'draft',
    version: d.version || '',
    updated_at: Number(d.updated_at) || 0,
    updated_by: d.updated_by || ''
  };
}

function sortQuestions(list) {
  return list.slice().sort((a, b) => {
    const s = String(a.subject || '').localeCompare(String(b.subject || ''));
    if (s !== 0) return s;
    return String(a.qid || '').localeCompare(String(b.qid || ''));
  });
}

// 科目元数据总览: exam_bank meta + questions 计数（只读）
async function exam_subject_overview(ctx) {
  const { ensureAdminColls, col, _, ok } = ctx;
  await ensureAdminColls();
  const sr = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const qr = await col('questions').where({ is_deleted: _.neq(true) }).limit(1000).get().catch(() => ({ data: [] }));
  const total = {};
  const published = {};
  for (const q of (qr.data || [])) {
    if (!q || !q.subject) continue;
    total[q.subject] = (total[q.subject] || 0) + 1;
    if (q.status === 'published') published[q.subject] = (published[q.subject] || 0) + 1;
  }
  const list = (sr.data || []).sort((a, b) => (a.code === 'base' ? 0 : 1) - (b.code === 'base' ? 0 : 1) || String(a.code || '').localeCompare(String(b.code || '')));
  return ok({
    list: list.map((s) => ({
      code: s.code,
      title: s.title || s.code,
      desc: s.desc || '',
      pass_line: Number(s.pass_line) || 100,
      requires: Array.isArray(s.requires) ? s.requires : [],
      enabled: !!s.enabled,
      question_count: total[s.code] || 0,
      published_count: published[s.code] || 0,
      updated_at: Number(s.updated_at) || 0
    }))
  });
}

// 科目元数据更新（替代旧 exam_subject_update 的元数据部分；不碰 questions）
async function exam_subject_meta_update(ctx) {
  const { event, ensureAdminColls, col, _, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const code = String(event.code || '').trim();
  if (!SUBJECT_RE.test(code)) return fail('exam_bad_code', '科目 code 必填且须为 1-20 位字母/数字/下划线');
  const title = String(event.title || '').trim();
  if (!title || title.length > 20) return fail('exam_bad_title', '科目标题须为 1-20 字');
  if (event.desc !== undefined && String(event.desc).length > 100) return fail('exam_bad_desc', '科目说明不超过 100 字');
  const passLine = Number(event.pass_line);
  if (!Number.isInteger(passLine) || passLine < 0 || passLine > 100) return fail('exam_bad_pass_line', '通过线须为 0-100 整数');
  if (!Array.isArray(event.requires)) return fail('exam_bad_requires', 'requires 须为数组');
  const allR = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const docs = allR.data || [];
  const existingCodes = docs.map((s) => s.code);
  if (!existingCodes.includes(code)) return fail('exam_not_found', '科目不存在');
  for (const r of event.requires) {
    if (r === code) return fail('exam_bad_require_self', '科目不能前置自身');
    if (!existingCodes.includes(r)) return fail('exam_bad_require_ref', `前置科目 ${r} 不存在`);
  }
  const cur = docs.find((s) => s.code === code);
  const patch = {
    title,
    desc: String(event.desc || '').trim().slice(0, 100),
    pass_line: passLine,
    requires: event.requires.filter((r) => existingCodes.includes(r)),
    enabled: event.enabled !== false,
    updated_at: now,
    updated_by: openid
  };
  await col('exam_bank').doc(cur._id).update({ data: patch });
  await logEvent('P2', 'exam_subject_meta_update', openid, { code, title, pass_line: passLine, enabled: patch.enabled, requires: patch.requires });
  return ok({ subject: Object.assign({ code }, patch) });
}

// 题目列表（后台全字段，含答案）
async function question_list(ctx) {
  const { event, ensureAdminColls, col, _, pager, ok } = ctx;
  await ensureAdminColls();
  const subject = String(event.subject || '').trim();
  const status = String(event.status || '').trim();
  const paper = String(event.paper || 'A').trim();
  const keyword = String(event.keyword || '').trim().toLowerCase();
  const where = { paper, is_deleted: _.neq(true) };
  if (subject) where.subject = subject;
  if (status) where.status = status;
  const r = await col('questions').where(where).orderBy('subject', 'asc').orderBy('qid', 'asc').limit(500).get().catch(() => ({ data: [] }));
  let list = sortQuestions(r.data || []);
  if (keyword) {
    list = list.filter((d) => String(d.stem || '').toLowerCase().includes(keyword)
      || String(d.qid || '').toLowerCase().includes(keyword)
      || String(d.knowledge || '').toLowerCase().includes(keyword));
  }
  const pg = pager(event);
  const total = list.length;
  return ok({
    list: list.slice(pg.skip, pg.skip + pg.size).map(questionOut),
    total, page: pg.page, size: pg.size
  });
}

async function question_detail(ctx) {
  const { event, ensureAdminColls, col, _, ok, fail } = ctx;
  await ensureAdminColls();
  const subject = String(event.subject || '').trim();
  const qid = String(event.qid || '').trim();
  if (!subject || !qid) return fail('question_bad_key', 'subject 与 qid 必填');
  const r = await col('questions').where({ subject, qid }).limit(1).get().catch(() => ({ data: [] }));
  const d = (r.data || [])[0];
  if (!d || d.is_deleted === true) return fail('question_not_found', '题目不存在');
  return ok({ question: questionOut(d) });
}

// 新增/更新题目（自然键 subject+qid；软删题可被重新启用）
async function question_upsert(ctx) {
  const { event, ensureAdminColls, col, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const v = validateQuestion(event);
  if (!v.doc) return fail(v.code, v.msg);
  const d = v.doc;
  const r = await col('questions').where({ subject: d.subject, qid: d.qid }).limit(1).get().catch(() => ({ data: [] }));
  const cur = (r.data || [])[0] || null;
  if (cur) {
    const patch = Object.assign({}, d, { is_deleted: false, updated_at: now, updated_by: openid });
    await col('questions').doc(cur._id).update({ data: patch });
    await logEvent('P2', 'question_upsert', openid, { subject: d.subject, qid: d.qid, status: d.status, created: false });
    return ok({ question: questionOut(Object.assign({}, cur, patch)), created: false });
  }
  const doc = Object.assign({}, d, {
    is_deleted: false, created_at: now, updated_at: now, created_by: openid, updated_by: openid
  });
  const add = await col('questions').add({ data: doc });
  await logEvent('P2', 'question_upsert', openid, { subject: d.subject, qid: d.qid, status: d.status, created: true });
  return ok({ question: questionOut(Object.assign({ _id: add && add._id }, doc)), created: true });
}

async function question_delete(ctx) {
  const { event, ensureAdminColls, col, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const subject = String(event.subject || '').trim();
  const qid = String(event.qid || '').trim();
  if (!subject || !qid) return fail('question_bad_key', 'subject 与 qid 必填');
  const r = await col('questions').where({ subject, qid, is_deleted: false }).limit(1).get().catch(() => ({ data: [] }));
  const cur = (r.data || [])[0];
  if (!cur) return fail('question_not_found', '题目不存在或已删除');
  await col('questions').doc(cur._id).update({ data: { is_deleted: true, updated_at: now, updated_by: openid } });
  await logEvent('P2', 'question_delete', openid, { subject, qid });
  return ok({ deleted: { subject, qid } });
}

// 批量发布/下架
async function question_bulk_status(ctx) {
  const { event, ensureAdminColls, col, _, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const subject = String(event.subject || '').trim();
  const status = String(event.status || '').trim();
  const qids = Array.isArray(event.qids) ? event.qids.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (!subject) return fail('question_bad_subject', '科目必填');
  if (STATUSES.indexOf(status) < 0) return fail('question_bad_status', '状态须为 draft/published');
  if (!qids.length || qids.length > 100) return fail('question_bad_qids', '题号列表须为 1-100 条');
  const r = await col('questions').where({ subject, is_deleted: _.neq(true) }).limit(500).get().catch(() => ({ data: [] }));
  const wanted = new Set(qids);
  const targets = (r.data || []).filter((d) => d && wanted.has(d.qid));
  const missing = qids.filter((qid) => !targets.some((d) => d.qid === qid));
  for (const d of targets) {
    await col('questions').doc(d._id).update({ data: { status, updated_at: now, updated_by: openid } });
  }
  await logEvent('P2', 'question_bulk_status', openid, { subject, status, count: targets.length, missing });
  return ok({ updated: targets.length, missing });
}

// ── Markdown 导入 ──
// 格式: <!-- q:start ... --> 题干/选项/解析 <!-- q:end -->；meta 行 key: value。
function parseImportBlocks(text) {
  const re = /<!--\s*q:start\s*\r?\n([\s\S]*?)\r?\n-->([\s\S]*?)<!--\s*q:end\s*-->/g;
  const blocks = [];
  let m;
  while ((m = re.exec(text))) {
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    blocks.push({ meta, body: m[2] });
  }
  return blocks;
}

function parseImportBody(body) {
  const stemLines = [];
  const optMap = {};
  const analysisLines = [];
  let section = 'stem';
  for (const raw of String(body || '').split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    const am = t.match(/^(?:解析|analysis)[:：]\s*(.*)$/i);
    if (am) { section = 'analysis'; if (am[1]) analysisLines.push(am[1]); continue; }
    const om = t.match(/^([A-F])\s*[.、:：)]\s*(.*)$/);
    if (om) {
      section = 'option';
      optMap[om[1]] = (optMap[om[1]] ? optMap[om[1]] + ' ' : '') + om[2].trim();
      continue;
    }
    if (section === 'stem') stemLines.push(t);
    else if (section === 'analysis') analysisLines.push(t);
    else if (section === 'option') {
      const letters = Object.keys(optMap).sort();
      if (letters.length) optMap[letters[letters.length - 1]] += ' ' + t;
    }
  }
  const letters = Object.keys(optMap).sort();
  const options = [];
  for (let i = 0; i < letters.length; i++) {
    if (letters[i] !== String.fromCharCode(65 + i)) return { error: '选项须从 A 连续编号' };
    options.push(optMap[letters[i]]);
  }
  return {
    stem: stemLines.join('\n').trim(),
    options,
    analysis: analysisLines.join('\n').trim()
  };
}

function letterAnswerToIdx(answer) {
  const parts = String(answer || '').split(/[,，、\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (!/^[A-F]$/.test(p)) return null;
    out.push(p.charCodeAt(0) - 65);
  }
  return out;
}

// 导入：逐条校验，合法条目落库，非法条目返回明细（部分成功）
async function question_import_markdown(ctx) {
  const { event, ensureAdminColls, col, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const text = String(event.markdown || '');
  if (!text.trim()) return fail('question_import_empty', '导入内容为空');
  if (text.length > 100000) return fail('question_import_too_large', '导入内容超过 100KB，请分批导入');
  const blocks = parseImportBlocks(text);
  if (!blocks.length) return fail('question_import_no_block', '未识别到 <!-- q:start --> ... <!-- q:end --> 题目块');
  if (blocks.length > 200) return fail('question_import_too_many', '单次最多导入 200 题');
  const errors = [];
  const valid = [];
  const seen = new Set();
  blocks.forEach((b, i) => {
    const meta = b.meta || {};
    const parsed = parseImportBody(b.body);
    if (parsed.error) { errors.push({ index: i + 1, qid: meta.qid || '', msg: parsed.error }); return; }
    const answerIdx = letterAnswerToIdx(meta.answer);
    if (!answerIdx || !answerIdx.length) { errors.push({ index: i + 1, qid: meta.qid || '', msg: 'answer 缺失或非 A-F' }); return; }
    const input = {
      subject: meta.subject,
      qid: meta.qid,
      paper: meta.paper || 'A',
      module: meta.module || '',
      type: meta.type || (answerIdx.length > 1 ? 'multi' : 'single'),
      stem: parsed.stem,
      options: parsed.options,
      answer_idx: answerIdx,
      score: meta.score === undefined ? 1 : meta.score,
      difficulty: meta.difficulty || '',
      knowledge: meta.knowledge || '',
      analysis: meta.analysis || parsed.analysis,
      status: meta.status || 'draft',
      version: meta.version || 'V1'
    };
    const v = validateQuestion(input);
    if (!v.doc) { errors.push({ index: i + 1, qid: meta.qid || '', msg: v.msg }); return; }
    const key = v.doc.subject + '|' + v.doc.qid;
    if (seen.has(key)) { errors.push({ index: i + 1, qid: v.doc.qid, msg: '同批次题号重复' }); return; }
    seen.add(key);
    valid.push(v.doc);
  });
  if (!valid.length) {
    await logEvent('P2', 'question_import', openid, { total: blocks.length, created: 0, updated: 0, errors: errors.length });
    return ok({ total: blocks.length, created: 0, updated: 0, partial: true, errors });
  }
  // 预读同批次涉及科目的现有题目，避免逐题查询
  const subjects = Array.from(new Set(valid.map((d) => d.subject)));
  const existing = {};
  for (const s of subjects) {
    const r = await col('questions').where({ subject: s }).limit(1000).get().catch(() => ({ data: [] }));
    for (const d of (r.data || [])) existing[d.subject + '|' + d.qid] = d;
  }
  let created = 0;
  let updated = 0;
  const apply = async (d) => {
    const key = d.subject + '|' + d.qid;
    const cur = existing[key];
    if (cur) {
      await col('questions').doc(cur._id).update({ data: Object.assign({}, d, { is_deleted: false, updated_at: now, updated_by: openid }) });
      return false;
    }
    await col('questions').add({ data: Object.assign({}, d, {
      is_deleted: false, created_at: now, updated_at: now, created_by: openid, updated_by: openid
    }) });
    return true;
  };
  for (let i = 0; i < valid.length; i += 10) {
    const chunk = valid.slice(i, i + 10);
    const flags = await Promise.all(chunk.map((d) => apply(d).catch((e) => {
      errors.push({ index: -1, qid: d.qid, msg: '写入失败: ' + (e && e.message ? e.message : 'unknown') });
      return null;
    })));
    for (const f of flags) { if (f === true) created++; else if (f === false) updated++; }
  }
  await logEvent('P2', 'question_import', openid, { total: blocks.length, created, updated, errors: errors.length });
  return ok({ total: blocks.length, created, updated, partial: errors.length > 0, errors });
}

module.exports = {
  exam_subject_overview,
  exam_subject_meta_update,
  question_list,
  question_detail,
  question_upsert,
  question_delete,
  question_bulk_status,
  question_import_markdown
};
