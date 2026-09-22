// 对应 PRD 章节：16 数据库设计与数据模型 / 附录M 参数总表
// init-db 是部署工具函数,用于一次性初始化数据库集合、索引与运营参数种子配置
// 幂等:重复运行不报错、不覆盖已有数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 19 个业务集合(rules.md 第五节第7条; 2026-09-16 +withdraw_record/+demand_draft; 2026-09-17 +withdraw_lock)
const COLLECTIONS = [
  'user_account', 'partner_profile', 'demand', 'order_main', 'order_confirmations',
  'order_status_log', 'pay_transaction', 'im_conversation', 'im_message', 'safety_report',
  'credit_score_log', 'emergency_contact', 'evaluation', 'settlement', 'platform_event', 'admin_config',
  'disclaimer_signature', 'withdraw_record', 'demand_draft', 'withdraw_lock',
  'system_notice', 'insurance_record'
];

// 索引清单(rules.md 第五节第7条索引设计规范)
// unique 唯一索引 / 复合索引按查询模式建
const INDEXES = [
  { coll: 'user_account', name: 'uk_openid', keys: { openid: 1 }, unique: true },
  { coll: 'partner_profile', name: 'uk_openid', keys: { openid: 1 }, unique: true },
  { coll: 'demand', name: 'idx_creator_status_created', keys: { creator_openid: 1, status: 1, created_at: -1 } },
  { coll: 'demand', name: 'idx_status_created', keys: { status: 1, created_at: -1 } },
  { coll: 'demand', name: 'idx_expire_at', keys: { expire_at: 1 } },
  // 大厅查询: home-action square 用 (等值 is_deleted+status+broadcast) → orderBy created_at → 范围 expire_at
  { coll: 'demand', name: 'idx_hall_broadcast_status_created', keys: { is_deleted: 1, status: 1, broadcast: 1, created_at: -1, expire_at: 1 } },
  // 大厅按场景查询: 多一个 scene 等值条件
  { coll: 'demand', name: 'idx_hall_scene_status_created', keys: { is_deleted: 1, status: 1, broadcast: 1, scene: 1, created_at: -1, expire_at: 1 } },
  { coll: 'order_main', name: 'uk_order_no', keys: { order_no: 1 }, unique: true },
  { coll: 'order_main', name: 'idx_demand_id', keys: { demand_id: 1 } },
  { coll: 'order_main', name: 'idx_partner_status', keys: { partner_openid: 1, status: 1 } },
  { coll: 'order_main', name: 'idx_user_status', keys: { user_openid: 1, status: 1 } },
  { coll: 'order_main', name: 'idx_created', keys: { created_at: -1 } },
  { coll: 'pay_transaction', name: 'idx_order_id', keys: { order_id: 1 } },
  { coll: 'order_status_log', name: 'idx_order_created', keys: { order_id: 1, created_at: -1 } },
  { coll: 'im_conversation', name: 'uk_order_id', keys: { order_id: 1 }, unique: true },
  { coll: 'im_message', name: 'idx_conv_created', keys: { conv_id: 1, created_at: -1 } },
  { coll: 'evaluation', name: 'idx_order_id', keys: { order_id: 1 } },
  { coll: 'settlement', name: 'idx_order_id', keys: { order_id: 1 } },
  { coll: 'withdraw_record', name: 'idx_openid_created', keys: { openid: 1, created_at: -1 } },
  { coll: 'demand_draft', name: 'idx_openid_updated', keys: { openid: 1, updated_at: -1 } },
  // safety_report 查询: SOS 进行中单(order_id+type+status orderBy created_at) / 报备列表(order_id+type)
  { coll: 'safety_report', name: 'idx_order_type_status_created', keys: { order_id: 1, type: 1, status: 1, created_at: -1 } },
  // checkin 频控: 同订单同人报备最新一条(order_id+reporter_openid+type orderBy created_at)
  { coll: 'safety_report', name: 'idx_order_reporter_type_created', keys: { order_id: 1, reporter_openid: 1, type: 1, created_at: -1 } },
  // system_notice: 消息中心按收件人查, 未读过滤, 点击后标记已读
  { coll: 'system_notice', name: 'idx_to_read_created', keys: { to_openid: 1, read: 1, created_at: -1 } },
  { coll: 'system_notice', name: 'idx_order_created', keys: { order_id: 1, created_at: -1 } },
  { coll: 'system_notice', name: 'idx_to_created', keys: { to_openid: 1, created_at: -1 } }
];

// 运营参数种子配置(PRD 附录M / 8.5节 可运营参数 · SSOT)
const SEED_CONFIG = {
  _id: 'global',
  // 抽成:冷启动期 10%(可运营参数)
  platform_fee_rate_fen: 1000,
  city_enabled: ['成都'],
  // 超时规则(PRD 8.3 SSOT)
  s0_timeout_min: 30,        // S0 待支付 30 分钟未支付 → S6
  s1_timeout_min: 15,       // S1 待确认 15 分钟未四确认 → S6
  interrupt_timeout_h: 24,   // S3.5 履约中断 24 小时 → 默认转 S4
  eval_window_h: 48,         // S5 完成后 48 小时未评价 → 系统默认 4 星转 S9
  dispute_escalate_d: 30,  // PRD S10.5 争议升级天数 · 预留字段, 当前争议为人工处理, 超期自动升级逻辑待实现
  // aa_tiers 已下线: 前端 AA_OPTIONS 硬编码, 格式不同; 第二批云化 AA_OPTIONS 时再按 admin_config.aa_tiers 接通
  // 信用分(PRD 8.1 SSOT)
  min_credit_take_order: 600,
  min_credit_place_order: 600,
  credit_freeze_line: 400,
  // 青少年保护(PRD 1.7.1):18-22 岁单笔上限 200 元
  youth_limit_fen: 20000,
  // 耍伴时薪区间 30-100 元/小时
  rate_min_fen: 3000,
  rate_max_fen: 10000,
  // 耍伴默认时薪(可运营, accept-config 首次接场景时补默认值用)
  scene_default_rate_fen: 5000,
  // 距离校验(公里, 可运营): 发布位置↔履约地 / 耍伴接单位置↔履约地
  publish_distance_max_km: 50,
  take_distance_max_km: 50,
  // 默认评价:超时未评价记 4 星(非 5 星)
  default_star: 4,
  // 场景白名单(MVP-V1 一期 · PRD 3.2/11章) · 每个场景含 disclaimer_type(与 demand-publish/order-create 统一)
  scene_list: [
    { code: 'W1',  name: '就医陪诊', options: ['挂号排队', '取药送药', '陪诊解压'], aa_default: true, disclaimer_type: 'medical_disclaimer', builtin: true },
    { code: 'W2',  name: '学习陪伴', options: ['自习陪伴', '口语陪练', '作业督促'], disclaimer_type: 'general_disclaimer', builtin: true },
    { code: 'W8',  name: '生活协助', options: ['排队代办', '搬家帮手', '采买陪同'], disclaimer_type: 'general_disclaimer', builtin: true },
    { code: 'W10', name: '出行陪伴', options: ['逛街同行', '夜跑陪跑', '活动搭子'], disclaimer_type: 'general_disclaimer', builtin: true },
    { code: 'W11', name: '线上陪伴', options: ['树洞倾听', '游戏陪玩', '打卡监督'], disclaimer_type: 'online_disclaimer', builtin: true }
  ],
  // aa_tiers 已下线: 前端 AA_OPTIONS 硬编码格式不同, 第二批云化 AA_OPTIONS 时再按 admin_config.aa_tiers 接通
  // IM 系统模板消息(PRD 3.3.2 四确认前仅允许这些)
  system_templates: [
    { id: 'TM1', text: '时间确认' },
    { id: 'TM2', text: '地点确认' },
    { id: 'TM3', text: '内容确认' },
    { id: 'TM4', text: '费用确认' },
    { id: 'TM5', text: '特殊需求' },
    { id: 'TM6', text: '到达提醒' },
    { id: 'TM7', text: '取消申请' },
    { id: 'TM8', text: '改期申请' }
  ],
  // 首页活动栏: 后台运营配置, init-db 仅存空数组, 由 admin-action home_activity_create 填充
  home_activities: [],
  // 本地兜底词库(msgSecCheck 不可用时使用)
  block_words: ['加微信', '加V', '转账', '私聊我'],
  // 环境开关: dev(测试期,允许 mock_openid 模拟身份) / prod(上线,强制忽略 mock_openid)
  env: 'prod',
  // 上线前必须改为 false(当前是 true 方便 MVP bootstrap)
  auto_approve_partner: false,
  // 管理员 openid 白名单(阶段 5 由产品经理填入自己的 openid)
  admin_openids: [],
  // 四确认前仅允许模板消息(PRD 3.3.2)
  security_only_template_before_confirm: true,
  version: 'V15-MVP',
  // 基础字段(rules.md 第五节第7条)
  created_at: Date.now(),
  updated_at: Date.now(),
  is_deleted: false
};

exports.main = async (event, context) => {
  const { resolveOpenid, warmEnv, invalidateEnvCache } = require('./openid');
  await warmEnv(cloud);

  // ── force_set_env 过期自毁: 每次 init-db 被调用时检查, 超 4h 自动切回 prod ──
  try {
    const _cfg = (await db.collection('admin_config').doc('global').get()).data;
    if (_cfg && _cfg.force_expire_at && _cfg.force_expire_at < Date.now()) {
      await db.collection('admin_config').doc('global').update({
        data: { env: 'prod', force_expire_at: null, force_operator: null, force_reason: null, force_used_at: null, updated_at: Date.now(), updated_by: { action: 'force_expired_auto_revert', at: Date.now() } }
      });
      console.warn('[init-db] force_set_env 已过期, 自动切回 prod');
    }
  } catch (_) {}

  // ── 鉴权: lookup/check_pp/force_migrate_scenes 需管理员; quick_check + 默认幂等种子补齐放行 ──
  const action = event && event.action;
  const openid = await resolveOpenid(cloud, event);
  const ADMIN_ACTIONS = ['lookup', 'force_migrate_scenes', 'check_pp'];
  if (ADMIN_ACTIONS.indexOf(action) >= 0) {
    let cfg = null;
    try { cfg = (await db.collection('admin_config').doc('global').get()).data; } catch (e) {}
    const adminOpenids = (cfg && cfg.admin_openids) || [];
    const isAdmin = !!openid && adminOpenids.indexOf(openid) >= 0;
    // 鸡生蛋兼容: admin_openids 为空时首次部署放行(等 init-db 建好 admin_config 后 admin-action claim_admin 初始化)
    if (adminOpenids.length > 0 && !isAdmin) {
      return { ok: false, code: 'idb_forbidden', msg: '无权限,仅管理员可调用此动作' };
    }
  }

  // ── 运维查询模式 ──
  if (event && event.action === 'lookup') {
    const _ = db.command;
    const names = Array.isArray(event.nicknames) ? event.nicknames : [];
    const openids = Array.isArray(event.openids) ? event.openids : [];
    const results = {};
    if (names.length) {
      for (const nick of names) {
        const r = await db.collection('user_account').where({
          nickname: nick, is_deleted: _.neq(true)
        }).limit(1).get();
        const u = r.data && r.data[0];   // where().get() 返回数组, 必须取 [0]
        results[nick] = u ? {
          openid: u.openid,
          roles: u.roles || [],
          partner_profile_exists: false,
          exam_scores: null
        } : null;
        if (u) {
          const pR = await db.collection('partner_profile').where({ openid: u.openid, is_deleted: _.neq(true) }).limit(1).get();
          const p = pR.data && pR.data[0];
          results[nick].partner_profile_exists = !!p;
          if (p) {
            results[nick].accept_scenes = p.accept_scenes || [];
            results[nick].exam_scores = p.exam_scores || null;
          }
        }
      }
    }
    return { ok: true, mode: 'lookup', results };
  }

  // ── 临时查询: 查 demand 最近 5 条 + admin_config 关键项 ──
  if (event && event.action === 'quick_check') {
    const _ = db.command;
    let demands = [];
    try {
      const dr = await db.collection('demand').where({ is_deleted: _.neq(true) })
        .orderBy('created_at', 'desc').limit(5).get();
      demands = (dr.data || []).map(d => ({
        _id: d._id.slice(0, 12) + '...',
        status: d.status, broadcast: d.broadcast, scene: d.scene,
        creator: d.creator_openid ? d.creator_openid.slice(0, 8) + '...' : '',
        expire_at: d.expire_at ? new Date(d.expire_at).toISOString().slice(0, 16) : '',
        created_at: d.created_at ? new Date(d.created_at).toISOString().slice(0, 16) : ''
      }));
    } catch (e) { demands = [{ error: e.message }]; }
    let cfg = {};
    try {
      const cr = await db.collection('admin_config').doc('global').get();
      const c = cr.data || {};
      cfg = {
        env: c.env,
        enabled_cities: c.enabled_cities || c.city,
        scene_list: c.scene_list || [],
        scene_count: (c.scene_list || []).length,
        seed_expected_codes: SEED_CONFIG.scene_list.map(s => s.code)
      };
    } catch (e) { cfg = { error: e.message }; }
    return { ok: true, mode: 'quick_check', demands, config: cfg };
  }

  // ── 强制迁移 scene_list / system_templates ──
  if (event && event.action === 'force_migrate_scenes') {
    const patch = { scene_list: SEED_CONFIG.scene_list, updated_at: Date.now() };
    try {
      await db.collection('admin_config').doc('global').update({ data: patch });
      return { ok: true, mode: 'force_migrate_scenes', scene_count: SEED_CONFIG.scene_list.length, codes: SEED_CONFIG.scene_list.map(s => s.code) };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }

  // ── 临时: 切换 admin_config.env(仅 dev/prod, 用于云端测试面板 mock_openid 放行) ──
  // prod 环境 fail-closed 禁止切 dev(防云端测试面板被人滥用身份门控)
  if (event && event.action === 'set_env') {
    const { env } = event;
    if (env !== 'dev' && env !== 'prod') return { ok: false, msg: 'env 只能是 dev 或 prod' };
    try {
      const cur = await db.collection('admin_config').doc('global').get();
      const curEnv = (cur.data && cur.data.env) || 'prod';
      if (curEnv === 'prod' && env === 'dev') {
        return { ok: false, msg: 'prod 环境禁止切 dev, 请用 force_set_env 并填 reason' };
      }
      await db.collection('admin_config').doc('global').update({ data: { env, updated_at: Date.now() } });
      return { ok: true, mode: 'set_env', env };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  // ── 应急: 强制切 env(任何方向, 需 reason + openid 在 admin_openids 白名单) ──
  // 真机调试时需要 prod→dev 拿 send_sms_code 的 dev_code, 测完立即切回 prod 并移除本 action
  if (event && event.action === 'force_set_env') {
    const { env, reason, mock_openid } = event;
    if (env !== 'dev' && env !== 'prod') return { ok: false, msg: 'env 只能是 dev 或 prod' };
    if (!reason) return { ok: false, msg: 'force_set_env 必须填 reason 留审计' };
    try {
      const wxCtx = cloud.getWXContext();
      const curOpenid = wxCtx.OPENID || mock_openid || null;
      if (!curOpenid) return { ok: false, code: 'no_identity', msg: '请提供 mock_openid(云端测试面板) 或真机身份' };
      const acr = await db.collection('admin_config').doc('global').get();
      const allowed = (acr.data && acr.data.admin_openids) || [];
      if (allowed.indexOf(curOpenid) < 0) {
        return { ok: false, code: 'forbidden', msg: '仅白名单管理员可调用 force_set_env' };
      }
      const before = (acr.data.env) || 'prod';
      const now = Date.now();
      const EXPIRE_MS = 4 * 60 * 60 * 1000; // 4 小时自毁
      await db.collection('admin_config').doc('global').update({
        data: {
          env,
          updated_at: now,
          force_expire_at: env === 'dev' ? now + EXPIRE_MS : null,
          force_operator: env === 'dev' ? curOpenid : null,
          force_reason: env === 'dev' ? reason : null,
          force_used_at: env === 'dev' ? now : null,
          updated_by: { action: 'force_set_env', operator: curOpenid, from: before, to: env, reason, at: now, auto_revert_at: env === 'dev' ? now + EXPIRE_MS : null }
        }
      });
      invalidateEnvCache(); // 强制清缓存, 后续 init-db 操作立即感知新 env
      return { ok: true, mode: 'force_set_env', from: before, to: env, operator: curOpenid, auto_revert_in_hours: env === 'dev' ? 4 : null };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  // ── 一次性: 生成 admin-web HTTP 鉴权密钥(长随机字符串, 加 reason 审计) ──
  // admin_openids 为空时自动 bootstrap seed 当前 openid + 放行 (打破鸡生蛋)
  if (event && event.action === 'generate_admin_web_key') {
    const { reason, mock_openid } = event;
    if (!reason) return { ok: false, msg: '必须填 reason 审计' };
    try {
      const wxCtx = cloud.getWXContext();
      const curOpenid = wxCtx.OPENID || mock_openid || null;
      if (!curOpenid) return { ok: false, msg: '需要 openid 身份' };
      const now = Date.now();
      const acr = await db.collection('admin_config').doc('global').get();
      let allowed = (acr.data && acr.data.admin_openids) || [];
      const bootstrapped = allowed.length === 0;
      // Bootstrap: admin_openids 为空时先 seed + 放行 (鸡生蛋解法)
      if (bootstrapped) {
        await db.collection('admin_config').doc('global').update({
          data: { admin_openids: [curOpenid], updated_at: now }
        });
        allowed = [curOpenid];
      }
      if (allowed.indexOf(curOpenid) < 0) return { ok: false, msg: '仅白名单管理员可执行' };
      const crypto = require('crypto');
      const key = 'AWK-' + crypto.randomBytes(32).toString('hex');
      await db.collection('admin_config').doc('global').update({
        data: { admin_web_key: key, admin_web_key_at: now, admin_web_key_by: curOpenid,
                admin_web_key_reason: reason, updated_at: now,
                admin_openids: allowed // bootstrap 后覆盖回完整列表
              }
      });
      return { ok: true, key, bootstrapped, hint: '请妥善保存此 key, admin-web 前端 HTTP 请求头 X-Admin-Key 需携带' };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  // ── 临时: 按 openid 查 partner_profile 全部文档 ──
  if (event && event.action === 'check_pp') {
    const _ = db.command;
    const oid = event.openid;
    if (!oid) return { ok: false, msg: 'need openid' };
    const r = await db.collection('partner_profile').where({ openid: oid }).limit(20).get();
    return { ok: true, count: r.data.length, profiles: r.data.map(p => ({
      _id: p._id.slice(0, 12) + '...',
      status: p.status, is_deleted: p.is_deleted, accept_switch: p.accept_switch,
      accept_scenes: p.accept_scenes || [],
      exam_scores: p.exam_scores || null,
      updated_at: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 16) : ''
    })) };
  }

  const created = [];
  const skipped = [];
  const warnings = [];

  // 1. 创建集合(幂等:已存在则跳过)
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      created.push(`collection:${name}`);
      console.log(`created collection: ${name}`);
    } catch (e) {
      // 已存在或权限不足均视为跳过
      skipped.push(`collection:${name}`);
      console.log(`skip collection ${name}: ${e.errMsg || e.message}`);
    }
  }

  // 2. 创建索引(幂等:已存在则跳过,SDK 不支持时降级警告)
  for (const idx of INDEXES) {
    try {
      await db.collection(idx.coll).createIndex({
        name: idx.name,
        keys: idx.keys,
        unique: !!idx.unique
      });
      created.push(`index:${idx.coll}.${idx.name}`);
      console.log(`created index: ${idx.coll}.${idx.name}`);
    } catch (e) {
      skipped.push(`index:${idx.coll}.${idx.name}`);
      console.log(`skip index ${idx.coll}.${idx.name}: ${e.errMsg || e.message}`);
    }
  }

  // 3. 写入 admin_config 种子(幂等:不存在则建,已存在则补齐缺失字段,不覆盖已有值)
  try {
    const exist = await db.collection('admin_config').doc('global').get();
    const doc = exist.data;
    if (doc && doc._id) {
      // 检测 SEED_CONFIG 中存在但 doc 中缺失的字段,补齐(不覆盖已有值)
      const patch = {};
      let hasPatch = false;
      for (const k of Object.keys(SEED_CONFIG)) {
        if (k === '_id') continue;
        if (doc[k] === undefined || doc[k] === null) {
          patch[k] = SEED_CONFIG[k];
          hasPatch = true;
        }
      }
      // 旧版 system_templates id 为 T1-T8, 前端/im-send 约定为 TM1-TM8;
      // 检测到任一 TM id 缺失即整组迁移覆盖(幂等: 已是 TM1-TM8 时不动)
      const tplIds = Array.isArray(doc.system_templates)
        ? doc.system_templates.map((t) => String(t && t.id).toUpperCase())
        : [];
      const seedTplIds = SEED_CONFIG.system_templates.map((t) => t.id);
      const needMigrate = seedTplIds.some((id) => tplIds.indexOf(id) < 0);
      if (needMigrate) {
        patch.system_templates = SEED_CONFIG.system_templates;
        hasPatch = true;
      }

      // 旧版 scene_list 可能含 W3/W7/W9 隐藏场景; 需与 SEED_CONFIG.scene_list 全量对齐
      // 检测维度: ① scene code 有无增减 ② 每个 scene 对象的完整字段有无差异
      const seedCodes = SEED_CONFIG.scene_list.map((s) => s.code);
      const docCodes = (Array.isArray(doc.scene_list) ? doc.scene_list : []).map((s) => s && s.code).filter(Boolean);
      const extraInDoc = docCodes.filter((c) => seedCodes.indexOf(c) < 0);
      const missingInDoc = seedCodes.filter((c) => docCodes.indexOf(c) < 0);
      // 字段级比对: 同 code 的 scene 对象 JSON 序列化后必须完全一致
      let sceneFieldChanged = false;
      if (extraInDoc.length === 0 && missingInDoc.length === 0) {
        for (let i = 0; i < SEED_CONFIG.scene_list.length; i++) {
          const seedS = SEED_CONFIG.scene_list[i];
          const docS = doc.scene_list.find((d) => d.code === seedS.code);
          if (!docS) { sceneFieldChanged = true; break; }
          if (JSON.stringify(docS) !== JSON.stringify(seedS)) { sceneFieldChanged = true; break; }
        }
      }
      if (extraInDoc.length > 0 || missingInDoc.length > 0 || sceneFieldChanged) {
        patch.scene_list = SEED_CONFIG.scene_list;
        hasPatch = true;
      }
      if (hasPatch) {
        patch.updated_at = Date.now();
        await db.collection('admin_config').doc('global').update({ data: patch });
        created.push('seed:admin_config (patched: ' + Object.keys(patch).filter(k => k !== 'updated_at').join(',') + ')');
        console.log('patched seed: admin_config fields: ' + Object.keys(patch).filter(k => k !== 'updated_at').join(','));
      } else {
        skipped.push('seed:admin_config (already complete)');
        console.log('skip seed: admin_config already complete');
      }
    } else {
      await db.collection('admin_config').add({ data: SEED_CONFIG });
      created.push('seed:admin_config');
      console.log('created seed: admin_config');
    }
  } catch (e) {
    warnings.push(`seed:admin_config (${e.errMsg || e.message})`);
    console.log(`fail seed admin_config: ${e.errMsg || e.message}`);
  }

  return {
    ok: true,
    data: {
      created,
      skipped,
      warnings,
      collections_total: COLLECTIONS.length,
      indexes_total: INDEXES.length
    }
  };
};
