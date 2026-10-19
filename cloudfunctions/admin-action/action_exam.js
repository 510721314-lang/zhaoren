// admin-action · 认证考试管理（exam_subject_* / exam_bank_seed，从 index.js 物理抽出，行为逐字不变）
// EXAM_BANK_FALLBACK / validateExamSubject / examSubjectMeta 随 handler 一并内联；共享符号通过 ctx 注入，禁止反向 require('./index')。

const EXAM_BANK_FALLBACK = {
  base: { title: '耍伴基础考试', desc: '全体耍伴接单前置，满分 100 分通过', pass_line: 100, requires: [], questions: [
    { question: '接单前需要确认什么？', options: ['需求内容与时间地点', '直接按导航出发', '先收钱再谈', '到地方再问'], answer_idx: 0 },
    { question: '遇到服务价格争议时应该？', options: ['现场理论自行解决', '联系平台客服介入', '直接结束服务', '要求对方加钱'], answer_idx: 1 },
    { question: '订单时间临时变更时应该？', options: ['自行改时间', '先与需求方沟通确认', '拒绝服务', '不理会'], answer_idx: 1 },
    { question: '关于平台信用分，正确的是？', options: ['完成优质服务可提升', '与服务质量无关', '花钱可买', '接单越多分越高不看出勤'], answer_idx: 0 },
    { question: '履约前需要做好的准备是？', options: ['熟悉需求内容并准点到达', '先索要好评', '只做自己方便的部分', '让需求方多等一会'], answer_idx: 0 },
    { question: '夜间服务(23:00-7:00)的正确做法是？', options: ['照常接单不理会', '平台有夜间红线,按规则暂停', '只接远距离单', '私下加价接单'], answer_idx: 1 },
    { question: '服务过程中发现问题(如信息不符)应该？', options: ['拍照留证并联系平台', '默默做完', '直接走人', '与对方争吵'], answer_idx: 0 },
    { question: '关于客户隐私信息，正确的是？', options: ['不外传对方联系方式与照片', '可以发朋友圈', '告诉亲友无妨', '保存备用'], answer_idx: 0 },
    { question: '被差评或投诉后正确的做法是？', options: ['申诉并提供证据', '恶意报复', '注销账号', '拉黑对方'], answer_idx: 0 },
    { question: '平台禁止的行为是？', options: ['线下绕开平台交易', '按时履约', '提前沟通', '如实描述服务'], answer_idx: 0 }
  ] },
  W1: { title: '陪诊提升考试', desc: '就医陪诊场景专项，满分 100 分通过；需先通过基础考试', pass_line: 100, requires: ['base'], questions: [
    { question: '陪诊服务的首要原则是？', options: ['以患者需求与医嘱为中心', '节省时间即可', '听家属意见就行', '按自己经验处理'], answer_idx: 0 },
    { question: '发现患者突发不适时应该？', options: ['立即通知医护人员并协助', '自行离开', '喂药处理', '等待家属'], answer_idx: 0 },
    { question: '陪诊时能否代患者做医疗决策？', options: ['不能,医疗决策须由医生/患者', '可以,图方便', '家属要求就可以', '看情况'], answer_idx: 0 },
    { question: '陪诊中涉及患者隐私(病历/报告)应？', options: ['妥善保管不外传', '拍照发给亲友', '发朋友圈', '保存备用'], answer_idx: 0 },
    { question: '取药送药服务需注意？', options: ['核对医嘱与用量,当面交付', '放前台即可', '让患者自取', '交家属就算完成'], answer_idx: 0 },
    { question: '陪诊中遇到挂号排队久等，正确做法是？', options: ['耐心陪同并安抚患者情绪', '催促插队', '中途离开', '让患者自己等'], answer_idx: 0 },
    { question: '患者提出与医嘱相悖的要求时应该？', options: ['耐心解释并咨询医护人员', '照做', '批评患者', '忽视'], answer_idx: 0 },
    { question: '陪诊结束后应？', options: ['如实反馈就诊要点与医嘱', '直接结束', '索要好评', '不说明'], answer_idx: 0 },
    { question: '陪诊中对收费或流程有疑问时？', options: ['咨询医院收费处/导诊', '让患者自己问', '替患者做主缴费', '忽略'], answer_idx: 0 },
    { question: '以下哪种情况应立即求助医护人员？', options: ['患者面色异常或突然不适', '患者稍显疲惫', '排队时间长', '找不到科室'], answer_idx: 0 }
  ] }
};

const examSubjectMeta = (s) => ({
  code: s.code, title: s.title, desc: s.desc || '', pass_line: s.pass_line,
  requires: s.requires || [], enabled: !!s.enabled,
  question_count: Array.isArray(s.questions) ? s.questions.length : 0,
  updated_at: s.updated_at || 0
});

function validateExamSubject(d, existingCodes, allowCode, fail) {
  const code = String(d.code || '').trim();
  if (!/^[A-Za-z0-9_]{1,20}$/.test(code)) return fail('exam_bad_code', '科目 code 须为 1-20 位字母/数字/下划线');
  const title = String(d.title || '').trim();
  if (!title || title.length > 20) return fail('exam_bad_title', '科目标题须为 1-20 字');
  if (d.desc !== undefined && String(d.desc).length > 100) return fail('exam_bad_desc', '科目说明不超过 100 字');
  const passLine = Number(d.pass_line);
  if (!Number.isInteger(passLine) || passLine < 0 || passLine > 100) return fail('exam_bad_pass_line', '通过线须为 0-100 整数');
  if (!Array.isArray(d.requires)) return fail('exam_bad_requires', 'requires 须为数组');
  for (const r of d.requires) {
    if (!existingCodes.includes(r)) return fail('exam_bad_require_ref', `前置科目 ${r} 不存在`);
    if (r === code) return fail('exam_bad_require_self', '科目不能前置自身');
  }
  const qs = d.questions;
  if (!Array.isArray(qs) || qs.length < 1 || qs.length > 60) return fail('exam_bad_qcount', '题目须为 1-60 条');
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (!q || typeof q !== 'object') return fail('exam_bad_q', `第 ${i + 1} 题格式错误`);
    const text = String(q.question || '').trim();
    if (!text || text.length > 500) return fail('exam_bad_q_text', `第 ${i + 1} 题题干须为 1-500 字`);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return fail('exam_bad_q_opts', `第 ${i + 1} 题须 2-6 个选项`);
    for (let j = 0; j < q.options.length; j++) {
      const o = String(q.options[j] || '').trim();
      if (!o || o.length > 50) return fail('exam_bad_q_opt', `第 ${i + 1} 题第 ${j + 1} 个选项须为 1-50 字`);
    }
    const ai = Number(q.answer_idx);
    if (!Number.isInteger(ai) || ai < 0 || ai >= q.options.length) return fail('exam_bad_q_ans', `第 ${i + 1} 题答案索引不合法`);
  }
  return null;
}

async function exam_subject_list(ctx) {
  const { ensureAdminColls, col, _, ok } = ctx;
  await ensureAdminColls();
  const r = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const list = (r.data || []).sort((a, b) => (a.code === 'base' ? 0 : 1) - (b.code === 'base' ? 0 : 1) || (a.created_at || 0) - (b.created_at || 0));
  return ok({ list: list.map(examSubjectMeta) });
}

async function exam_subject_detail(ctx) {
  const { event, ensureAdminColls, col, _, ok, fail } = ctx;
  await ensureAdminColls();
  const code = String(event.code || '').trim();
  if (!code) return fail('exam_bad_code', '科目 code 必填');
  const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const s = (r.data && r.data[0]) || null;
  if (!s) return fail('exam_not_found', '科目不存在');
  return ok({ subject: examSubjectMeta(s), questions: s.questions || [] });
}

async function exam_subject_write(ctx) {
  const { event, action, ensureAdminColls, col, _, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const isCreate = action === 'exam_subject_create';
  const code = String(event.code || '').trim();
  const allR = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const existingCodes = (allR.data || []).map((s) => s.code);
  if (isCreate && existingCodes.includes(code)) return fail('exam_exists', `科目 ${code} 已存在, 请用编辑`);
  if (!isCreate && !existingCodes.includes(code)) return fail('exam_not_found', '科目不存在');
  const v = validateExamSubject({ code, title: event.title, desc: event.desc, pass_line: event.pass_line, requires: event.requires, questions: event.questions }, existingCodes, code, fail);
  if (v) return v;
  const cleanQs = (event.questions || []).map((q) => ({
    question: String(q.question || '').trim().slice(0, 500),
    options: q.options.map((o) => String(o || '').trim().slice(0, 50)),
    answer_idx: Number(q.answer_idx)
  }));
  if (isCreate) {
    const doc = {
      code, title: String(event.title).trim(), desc: String(event.desc || '').trim().slice(0, 100),
      pass_line: Number(event.pass_line), requires: (event.requires || []).filter((r) => existingCodes.includes(r)),
      enabled: event.enabled !== false, questions: cleanQs,
      is_deleted: false, created_at: now, updated_at: now, created_by: openid, updated_by: openid
    };
    await col('exam_bank').add({ data: doc });
    await logEvent('P2', 'exam_subject_create', openid, { code, title: doc.title, qcount: cleanQs.length, pass_line: doc.pass_line });
    return ok({ subject: examSubjectMeta(doc) });
  }
  const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const cur = (r.data && r.data[0]) || null;
  if (!cur) return fail('exam_not_found', '科目不存在');
  const patch = {
    title: String(event.title).trim(), desc: String(event.desc || '').trim().slice(0, 100),
    pass_line: Number(event.pass_line), requires: (event.requires || []).filter((r) => existingCodes.includes(r)),
    enabled: event.enabled !== false, questions: cleanQs,
    updated_at: now, updated_by: openid
  };
  await col('exam_bank').doc(cur._id).update({ data: patch });
  await logEvent('P2', 'exam_subject_update', openid, { code, title: patch.title, qcount: cleanQs.length, pass_line: patch.pass_line });
  return ok({ subject: examSubjectMeta(Object.assign({}, cur, patch)) });
}

async function exam_subject_delete(ctx) {
  const { event, ensureAdminColls, col, _, now, openid, logEvent, ok, fail } = ctx;
  await ensureAdminColls();
  const code = String(event.code || '').trim();
  if (!code) return fail('exam_bad_code', '科目 code 必填');
  const allR = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const refs = (allR.data || []).filter((s) => (s.requires || []).includes(code)).map((s) => s.code);
  if (refs.length > 0) return fail('exam_in_use', `科目被 ${refs.join('/')} 前置引用, 不可删除`);
  const r = await col('exam_bank').where({ code, is_deleted: _.neq(true) }).limit(1).get().catch(() => ({ data: [] }));
  const cur = (r.data && r.data[0]) || null;
  if (!cur) return fail('exam_not_found', '科目不存在');
  await col('exam_bank').doc(cur._id).update({ data: { is_deleted: true, updated_at: now, updated_by: openid } });
  await logEvent('P2', 'exam_subject_delete', openid, { code });
  return ok({ deleted: code });
}

async function exam_bank_seed(ctx) {
  const { ensureAdminColls, col, _, now, openid, logEvent, ok } = ctx;
  await ensureAdminColls();
  const r = await col('exam_bank').where({ is_deleted: _.neq(true) }).limit(100).get().catch(() => ({ data: [] }));
  const existingCodes = (r.data || []).map((s) => s.code);
  const created = [];
  const skipped = [];
  for (const [code, def] of Object.entries(EXAM_BANK_FALLBACK)) {
    if (existingCodes.includes(code)) { skipped.push(code); continue; }
    const doc = {
      code, title: def.title, desc: def.desc, pass_line: def.pass_line, requires: def.requires,
      enabled: true, questions: def.questions, is_deleted: false,
      created_at: now, updated_at: now, created_by: openid, updated_by: openid
    };
    await col('exam_bank').add({ data: doc });
    created.push(code);
  }
  await logEvent('P2', 'exam_bank_seed', openid, { created, skipped });
  return ok({ created, skipped });
}

module.exports = {
  exam_subject_list,
  exam_subject_detail,
  exam_subject_create: exam_subject_write,
  exam_subject_update: exam_subject_write,
  exam_subject_delete,
  exam_bank_seed
};
