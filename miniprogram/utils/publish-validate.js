// miniprogram/utils/publish-validate.js · 需求发布「纯校验/纯工具」函数
// 拆分阶段1 C3(2026-10-15) 从 pages-v2/publish/publish.js 抽离；设计：零 wx 依赖、可在 node 下单测。
// @VERIFIED 2026-10-13（随源文件 publish.js 文件级标记「需求发布+代发校验+脱敏」迁入；
//   2026-10-15 拆分阶段1·B1-B5 经用户书面批准逐字搬迁，迁入处保留标记；
//   2026-10-16 需求点名变更：电话校验 isPhoneOrLandline→isMobilePhone 取消座机，提示缩短为「请填写正确的手机号」，#77）
// 唯一签名差异：validatePublish 原读 this.data 的 12 个字段改为 ctx 参数（B5，已单列报批）；其余函数逐字未改。

const { validateBudget, validateYouthAmount } = require('./redline.js');

// 敏感词检测：手机号/微信号
function detectSensitive(text) {
  if (!text) return null;
  const phone = text.match(/1[3-9]\d{9}/);
  if (phone) return '内容包含手机号格式，请删除后重试';
  const wechat = text.match(/[vV微][xX信]/);
  if (wechat) return '内容包含微信号信息，请删除后重试';
  return null;
}

// Haversine 球面距离(公里) · 与云函数口径一致, 用于发布前前置提示(服务端为准)
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 距离格式化: <1km 显示米, ≥1km 显示公里(1位小数)
function fmtDist(km) {
  if (!km || km <= 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} 米`;
  return `${km.toFixed(1)} 公里`;
}

// 电话格式: 仅 11 位手机号(需求变更 2026-10-16 取消座机; 与 demand-publish 服务端同口径)
function isMobilePhone(s) {
  const t = String(s || '').trim();
  return /^1[3-9]\d{9}$/.test(t);
}

// 场景无内置免责声明时的默认文案
function defaultDisclaimer(scene) {
  const titleMap = { medical_disclaimer: '就医免责声明', online_disclaimer: '线上陪伴声明' };
  return {
    title: titleMap[scene.disclaimer_type] || '免责声明',
    content: '本平台提供的服务仅为生活协助性质，非专业资质服务。请双方确保真实身份与安全合规，遇紧急情况请立即报警或联系相关部门。平台与耍伴/发布者仅承担协助义务，因您自身原因造成的损失平台不承担责任。'
  };
}

// 表单 → 草稿存储结构(与 restoreDraft 读取字段一一对应)
function buildDraftData(form) {
  const f = form;
  return {
    project_attr: f.project_attr,
    pricing_type: f.pricing_type === 'fixed' ? 'fixed' : 'hourly',  // B2+ 计价(必存: 恢复后价格行按它渲染)
    fixed_price: f.fixed_price || '',                               // B2+ 一口价(元, 字符串原样存)
    scene_code: f.scene_code,
    content_options: Array.isArray(f.content_options) ? f.content_options : [],
    title: f.title,
    description: f.description,
    service_date: f.service_date,
    service_time: f.service_time,
    duration_hours: f.duration_hours || Number(f.duration_custom) || 3,
    location: { name: f.location_name, latitude: f.latitude || 0, longitude: f.longitude || 0 },
    headcount: f.headcount,
    budget: Number(f.budget) || 0,
    aa_estimate: f.aa_estimate,
    gender_pref: f.gender_pref,
    match_mode: f.match_mode
  };
}

// 发布前表单校验，返回错误文案数组(空数组=通过)
// C3·B5: ctx 打包原页面 this.data 的 12 个字段（禁长参数表）；键名与页面 data 一一对应：
// petAuthChecked/isEditMode/useAccountPhone/contactPhone/accountPhoneMasked/publishType/
// proxyName/proxyRelation/proxyRelationNote/proxyPhone/proxyAuthChecked/userAge(=data.user.age)
function validatePublish(f, ctx) {
  const errs = [];
  if (!f.scene_code) errs.push('请选择场景');
  if (!f.content_options || !f.content_options.length) errs.push('请选择服务内容');
  if (!f.title) errs.push('请输入标题');
  if (!f.description) errs.push('请输入描述');
  if (!f.service_date) errs.push('请选择日期');
  if (!f.service_time) errs.push('请选择时间');
  if (!f.duration_hours && !f.duration_custom) errs.push('请选择时长');
  if (!f.location_name) errs.push('请输入地点');
  if (f.project_attr === 'commercial') {
    if (f.pricing_type === 'fixed') {
      const fp = Number(f.fixed_price);
      if (!Number.isInteger(fp) || fp <= 0) errs.push('请输入有效的一口价（正整数元）');
    } else {
      const bv = validateBudget(Number(f.budget), f.project_attr);
      if (!bv.ok) errs.push(bv.msg);
    }
  }
  if (!f.aa_estimate) errs.push('请选择AA费用预估');
  // W9 宠物照料授权(电子确认凭证; PRD R9 无凭证不得履约, 服务端同口径兜底)
  if (f.scene_code === 'W9' && !ctx.petAuthChecked) errs.push('请确认《宠物照料授权书》');
  // 联系手机号(所有需求必填; 编辑模式暂不支持修改, 跳过校验)
  if (!ctx.isEditMode) {
    if (!ctx.useAccountPhone) {
      const cp = (ctx.contactPhone || '').trim();
      if (!cp) errs.push('请填写联系手机号');
      else if (!/^1[3-9]\d{9}$/.test(cp)) errs.push('请填写正确的 11 位联系手机号');
    } else if (!ctx.accountPhoneMasked) {
      errs.push('账户未绑定手机号，请手动填写联系手机号');
    }
  }
  // 需求② 代他人发布: 必填被代发人 + 强制手写签字授权(不做轻量勾选, 服务端强校验同口径)
  if (ctx.publishType === 'proxy') {
    if (!ctx.proxyName.trim()) errs.push('请填写被代发人姓名');
    if (!ctx.proxyRelation) errs.push('请选择与本人的关系');
    if (ctx.proxyRelation === '其他' && !ctx.proxyRelationNote.trim()) errs.push('请填写关系补充说明（20 字内）');
    if (!ctx.proxyPhone.trim()) errs.push('请填写被代发人电话');
    else if (!isMobilePhone(ctx.proxyPhone)) errs.push('请填写正确的手机号');
    if (!ctx.proxyAuthChecked) errs.push('请完成《委托授权书》手写签字确认');
  }
  // 敏感词
  const sen1 = detectSensitive(f.title);
  if (sen1) errs.push(sen1);
  const sen2 = detectSensitive(f.description);
  if (sen2) errs.push(sen2);
  // 18-22岁青年保护（文案由 redline 统一基于 CONFIG.YOUTH 返回）
  if (f.project_attr === 'commercial') {
    const dur = f.duration_hours || Number(f.duration_custom) || 0;
    const amount = f.pricing_type === 'fixed' ? Number(f.fixed_price) : Number(f.budget) * dur;
    const youth = validateYouthAmount(amount, ctx.userAge);
    if (!youth.ok) {
      errs.push(`${youth.msg}，请缩短时长或降低费率`);
    }
  }
  return errs;
}

module.exports = {
  detectSensitive,
  haversineKm,
  pad2,
  fmtDist,
  isMobilePhone,
  defaultDisclaimer,
  buildDraftData,
  validatePublish
};
