// admin-action · 配置写入 config_set（从 index.js 物理抽出，行为逐字不变）
// CONFIG_SCHEMA 校验 + 事务更新 + config_history 快照；共享符号通过 ctx 注入，禁止反向 require('./index')。

async function config_set(ctx) {
  const { event, now, config, fail, openid, logEvent, CONFIG_SCHEMA, col, db, _, operatorAccount, log, ok } = ctx;
  const patch = { updated_at: now };
  const before = {};
  const touch = (k, v) => { before[k] = config[k]; patch[k] = v; };

  for (const s of CONFIG_SCHEMA) {
    if (s.t === 'bool' && event[s.f] !== undefined) touch(s.f, !!event[s.f]);
  }
  for (const s of CONFIG_SCHEMA) {
    if (s.t !== 'enum' || event[s.f] === undefined) continue;
    const v = String(event[s.f]);
    if (!Array.isArray(s.opts) || s.opts.indexOf(v) < 0) {
      return fail('config_bad_' + s.f, `${s.f} 仅支持: ${(s.opts || []).join(' / ')}`);
    }
    touch(s.f, v);
  }
  if (event.security_only_template_before_confirm !== undefined) {
    touch('security_only_template_before_confirm', !!event.security_only_template_before_confirm);
  }
  if (event.env !== undefined) {
    const envVal = String(event.env);
    if (envVal !== 'dev' && envVal !== 'prod') return fail('config_bad_env', 'env 仅支持 dev 或 prod');
    if (envVal === 'dev' && (config.env || 'prod') !== 'dev' && event.confirm !== 'SWITCH_DEV') {
      return fail('config_need_confirm', '切到 dev 将开放 mock 身份门控, 须传 confirm=SWITCH_DEV');
    }
    touch('env', envVal);
  }

  if (event.admin_web_key !== undefined) {
    const newKey = String(event.admin_web_key).trim();
    if (!/^AWK-[a-f0-9]{64}$/.test(newKey)) return fail('config_bad_key', 'admin_web_key 格式不符 AWK-+64位hex');
    if (!event.reason) return fail('config_need_reason', '轮换 admin_web_key 需填 reason');
    touch('admin_web_key', newKey);
    logEvent('P2', 'config_rotate_web_key', openid, { reason: event.reason });
  }

  let words = (config.block_words || []).slice();
  let wordsTouched = false;
  if (Array.isArray(event.block_words_add)) {
    event.block_words_add.map((w) => String(w).trim()).filter(Boolean).forEach((w) => {
      if (words.indexOf(w) < 0) { words.push(w); wordsTouched = true; }
    });
  }
  if (Array.isArray(event.block_words_remove)) {
    const rm = event.block_words_remove.map((w) => String(w).trim());
    const next = words.filter((w) => rm.indexOf(w) < 0);
    if (next.length !== words.length) wordsTouched = true;
    words = next;
  }
  if (wordsTouched) { before.block_words = config.block_words || []; patch.block_words = words; }

  let testOids = (config.test_openids || []).slice();
  let testTouched = false;
  if (Array.isArray(event.test_openids_add)) {
    event.test_openids_add.map((w) => String(w).trim()).filter(Boolean).forEach((w) => {
      if (testOids.indexOf(w) < 0) { testOids.push(w); testTouched = true; }
    });
  }
  if (Array.isArray(event.test_openids_remove)) {
    const rm = event.test_openids_remove.map((w) => String(w).trim());
    const next = testOids.filter((w) => rm.indexOf(w) < 0);
    if (next.length !== testOids.length) testTouched = true;
    testOids = next;
  }
  if (testTouched) { before.test_openids = config.test_openids || []; patch.test_openids = testOids; }

  let cities = (config.city_enabled || []).slice();
  let citiesTouched = false;
  if (Array.isArray(event.city_add)) {
    event.city_add.map((c) => String(c).trim()).filter(Boolean).forEach((c) => {
      if (cities.indexOf(c) < 0) { cities.push(c); citiesTouched = true; }
    });
  }
  if (Array.isArray(event.city_remove)) {
    const rm = event.city_remove.map((c) => String(c).trim());
    const next = cities.filter((c) => rm.indexOf(c) < 0);
    if (next.length !== cities.length) citiesTouched = true;
    cities = next;
  }
  if (citiesTouched) { before.city_enabled = config.city_enabled || []; patch.city_enabled = cities; }

  const intFields = CONFIG_SCHEMA
    .filter((s) => s.t === 'int')
    .map((s) => [s.f, s.min, s.max]);
  for (const [f, lo, hi] of intFields) {
    if (event[f] !== undefined) {
      const v = parseInt(event[f], 10);
      if (!Number.isInteger(v) || v < lo || v > hi) return fail('config_bad_' + f, `${f} 须为 ${lo}-${hi} 的整数`);
      touch(f, v);
    }
  }
  if (patch.rate_min_fen !== undefined || patch.rate_max_fen !== undefined) {
    const minF = patch.rate_min_fen !== undefined ? patch.rate_min_fen : (config.rate_min_fen || 3000);
    const maxF = patch.rate_max_fen !== undefined ? patch.rate_max_fen : (config.rate_max_fen || 10000);
    if (minF >= maxF) return fail('config_bad_rate_range', '最低时薪必须小于最高时薪');
  }
  if (patch.fixed_price_min_fen !== undefined || patch.fixed_price_max_fen !== undefined) {
    const fmin = patch.fixed_price_min_fen !== undefined ? patch.fixed_price_min_fen : config.fixed_price_min_fen;
    const fmax = patch.fixed_price_max_fen !== undefined ? patch.fixed_price_max_fen : config.fixed_price_max_fen;
    if (fmin !== undefined && fmax !== undefined && fmin > fmax) return fail('config_bad_fixed_range', '一口价下限必须不高于上限');
  }

  if (patch.time_redline_close_min !== undefined || patch.time_redline_open_min !== undefined) {
    const parseCur = (v, d) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : d; };
    const closeR = patch.time_redline_close_min !== undefined
      ? patch.time_redline_close_min
      : parseCur(config.time_redline_close_min, 1440);
    const openR = patch.time_redline_open_min !== undefined
      ? patch.time_redline_open_min
      : parseCur(config.time_redline_open_min, 360);
    if (closeR > 0 && openR >= closeR) {
      return fail('config_bad_time_redline', '接单开放须早于接单截止；截止设 0 表示全天开放');
    }
  }

  if (event.modify_config !== undefined) {
    if (typeof event.modify_config !== 'object' || Array.isArray(event.modify_config) || event.modify_config === null) {
      return fail('config_bad_modify_config', 'modify_config 须为对象');
    }
    const mcRanges = [
      ['minLeadHours', 0, 72], ['maxTimes', 0, 10],
      ['maxSpanH', 1, 720], ['confirmHours', 1, 168]
    ];
    const nextMC = Object.assign(
      { minLeadHours: 4, maxTimes: 2, maxSpanH: 72, confirmHours: 24 },
      config.modify_config || {}
    );
    for (const [k, lo, hi] of mcRanges) {
      if (event.modify_config[k] !== undefined) {
        const v = parseInt(event.modify_config[k], 10);
        if (!Number.isInteger(v) || v < lo || v > hi) {
          return fail('config_bad_modify_' + k, `modify_config.${k} 须为 ${lo}-${hi} 的整数`);
        }
        nextMC[k] = v;
      }
    }
    before.modify_config = config.modify_config || {};
    patch.modify_config = nextMC;
  }

  if (event.sub_msg_templates !== undefined) {
    if (typeof event.sub_msg_templates !== 'object' || Array.isArray(event.sub_msg_templates) || event.sub_msg_templates === null) {
      return fail('config_bad_sub_msg', 'sub_msg_templates 须为对象');
    }
    const TMPL_WHITELIST = ['demand_grab', 'demand_urge'];
    before.sub_msg_templates = config.sub_msg_templates || {};
    const merged = Object.assign({}, before.sub_msg_templates);
    for (const tk of TMPL_WHITELIST) {
      const cur = (before.sub_msg_templates || {})[tk] || {};
      const next = Object.assign({}, cur, event.sub_msg_templates[tk] || {});
      if (next.tmpl_id !== undefined && next.tmpl_id !== '' && !/^[A-Za-z0-9_-]{1,80}$/.test(String(next.tmpl_id))) {
        return fail('config_bad_sub_tmpl', `订阅模板(${tk})ID格式不符(字母数字下划线短横线, ≤80字)`);
      }
      merged[tk] = next;
    }
    patch.sub_msg_templates = merged;
  }

  let scenes = (config.scene_list || []).map((s) => Object.assign({}, s, { options: (s.options || []).slice() }));
  let scenesTouched = false;
  const sceneOpt = event.scene_option_add || event.scene_option_remove;
  if (sceneOpt) {
    const isAdd = !!event.scene_option_add;
    const req = isAdd ? event.scene_option_add : event.scene_option_remove;
    const sc = scenes.find((s) => s.code === req.scene);
    if (!sc) return fail('config_scene_not_found', '场景不存在: ' + req.scene);
    const opt = String(req.option || '').trim();
    if (!opt || opt.length > 10) return fail('config_bad_option', '服务项名称须为 1-10 字');
    if (isAdd) {
      if ((sc.options || []).length >= 8) return fail('config_too_many_options', '单场景服务项最多 8 个');
      if (sc.options.indexOf(opt) < 0) { sc.options.push(opt); scenesTouched = true; }
    } else {
      const next = sc.options.filter((x) => x !== opt);
      if (next.length !== sc.options.length) { sc.options = next; scenesTouched = true; }
    }
  }
  if (scenesTouched) { before.scene_list = config.scene_list || []; patch.scene_list = scenes; }

  if (event.scene_add) {
    const req = event.scene_add;
    const code = String(req.code || '').trim().toUpperCase();
    const name = String(req.name || '').trim();
    if (!code || !/^W\d{1,3}$/.test(code)) return fail('config_bad_scene_code', '场景编码须为 W + 1-3 位数字(如 W12)');
    if (!name || name.length > 12) return fail('config_bad_scene_name', '场景名称须为 1-12 字');
    if (scenes.find((s) => s.code === code)) return fail('config_scene_exists', '场景编码已存在: ' + code);
    const newScene = {
      code, name,
      options: (req.options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 8),
      disclaimer_type: String(req.disclaimer_type || 'general_disclaimer').trim(),
      builtin: false,
      created_at: now
    };
    scenes.push(newScene);
    before.scene_list = config.scene_list || [];
    patch.scene_list = scenes;
    scenesTouched = true;
  }

  if (event.scene_delete) {
    const code = String(event.scene_delete || '').trim().toUpperCase();
    const idx = scenes.findIndex((s) => s.code === code);
    if (idx < 0) return fail('config_scene_not_found', '场景不存在: ' + code);
    if (scenes[idx].builtin) return fail('config_scene_builtin', `内置场景 ${code} 不可删除, 仅可修改服务项`);
    if (scenes[idx].options && scenes[idx].options.length > 0) {
      return fail('config_scene_has_options', `场景 ${code} 还有服务项, 请先清空服务项再删除`);
    }
    scenes.splice(idx, 1);
    before.scene_list = config.scene_list || [];
    patch.scene_list = scenes;
    scenesTouched = true;
  }

  if (event.scene_migrate_builtin) {
    let touched = 0;
    before.scene_list = config.scene_list || [];
    scenes.forEach((s) => { if (s.builtin !== true) { s.builtin = true; touched++; } });
    if (touched > 0) {
      patch.scene_list = scenes;
      scenesTouched = true;
      logEvent('P2', 'scene_migrate_builtin', openid, { count: touched });
    }
  }

  let templates = (config.system_templates || []).slice();
  let tplTouched = false;
  if (event.template_add) {
    const text = String(event.template_add).trim();
    if (!text || text.length > 30) return fail('config_bad_template', '模板文案须为 1-30 字');
    const maxNum = templates.reduce((m, t) => {
      const n = parseInt(String(t.id || '').replace(/^T/, ''), 10);
      return Number.isInteger(n) && n > m ? n : m;
    }, 0);
    templates.push({ id: 'T' + (maxNum + 1), text });
    tplTouched = true;
  }
  if (event.template_remove) {
    const id = String(event.template_remove).trim();
    const next = templates.filter((t) => t.id !== id);
    if (next.length !== templates.length) { templates = next; tplTouched = true; }
  }
  if (tplTouched) { before.system_templates = config.system_templates || []; patch.system_templates = templates; }

  const legalFields = [
    ['legal_disclaimer_text', 0, 8000],
    ['legal_service_agreement', 0, 20000],
    ['legal_privacy_policy', 0, 20000],
    ['legal_aa_promise', 0, 8000],
    ['legal_pet_authorization', 0, 8000]
  ];
  for (const [f, lo, hi] of legalFields) {
    if (event[f] !== undefined) {
      const v = String(event[f]);
      if (v.length < lo || v.length > hi) return fail('config_bad_' + f, `${f} 长度须为 ${lo}-${hi}`);
      touch(f, v);
    }
  }
  if (event.legal_scene_disclaimers !== undefined) {
    if (typeof event.legal_scene_disclaimers !== 'object' || Array.isArray(event.legal_scene_disclaimers)) {
      return fail('config_bad_scene_disclaimers', 'legal_scene_disclaimers 须为 {scene_code: text} 对象');
    }
    const next = {};
    for (const [code, text] of Object.entries(event.legal_scene_disclaimers)) {
      const t = String(text || '');
      if (t.length > 4000) return fail('config_bad_scene_disclaimer_' + code, `${code} 免责声明不得超过 4000 字`);
      if (t) next[code] = t;
    }
    before.legal_scene_disclaimers = config.legal_scene_disclaimers || {};
    patch.legal_scene_disclaimers = next;
  }

  const changed = Object.keys(patch).filter((k) => k !== 'updated_at');
  if (!changed.length) return fail('config_no_change', '没有需要修改的字段');
  await col('admin_config').where({ _id: 'global' }).update({ data: patch });
  const reason = event.reason !== undefined ? String(event.reason).trim().slice(0, 100) : '';
  const eventPayload = { before, after: patch };
  if (reason) eventPayload.reason = reason;
  await logEvent('P2', 'config_change', openid, eventPayload);
  try {
    await db.createCollection('config_history').catch(() => {});
    const SENSITIVE_RE = /key|secret|token/i;
    const snapshot = { keys: changed, before: {}, after: {}, reason, operator: operatorAccount || openid || '', at: now };
    changed.forEach((k) => {
      const mask = (v) => (SENSITIVE_RE.test(k) ? '***' : v);
      snapshot.before[k] = mask(before[k]);
      snapshot.after[k] = mask(patch[k]);
    });
    await col('config_history').add({ data: { ...snapshot, created_at: now, updated_at: now, is_deleted: false } });
    const cnt = await col('config_history').where({ is_deleted: _.neq(true) }).count();
    if ((cnt.total || 0) > 100) {
      const extra = await col('config_history').where({ is_deleted: _.neq(true) }).orderBy('created_at', 'asc').limit((cnt.total || 0) - 100).get();
      await Promise.allSettled((extra.data || []).map((d) => col('config_history').doc(d._id).remove()));
    }
  } catch (e) { log.d(`config_history write fail: ${e.message}`); }
  return ok({ updated: changed });
}

module.exports = { config_set };
