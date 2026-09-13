// 对应 PRD 章节：3.3 需求发布功能 / 8.4.1 需求超时与梯度退款 / 11 业务场景白名单
// demand-publish 需求发布 · 身份取自 getWXContext().OPENID
// 4 个 action: publish / cancel / my_demands / lazy_expire
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 场景白名单(MVP-V1 · rules.md 三.11)
const SCENE_WHITELIST = ['W1', 'W2', 'W3', 'W7', 'W8', 'W9', 'W10', 'W11'];

// 接单模式白名单: broadcast=抢单(先到先得) · select=选单(耍伴报名→需求者确认)
const MATCH_MODE_WHITELIST = ['broadcast', 'select'];

// 场景→免责声明类型映射(code.html 第一道防线·双签)
const DISCLAIMER_TYPE_MAP = {
  W1: 'medical_disclaimer',     // 就医陪诊免责声明(国标第7条)
  W2: 'general_disclaimer',     // 学习陪伴
  W3: 'sports_disclaimer',      // 健身陪伴(运动伤害免责)
  W7: 'emotion_disclaimer',     // 情绪陪伴(非心理咨询免责)
  W8: 'general_disclaimer',     // 生活协助
  W9: 'pet_disclaimer',         // 宠物陪伴(宠物授权+伤害免责)
  W10: 'general_disclaimer',    // 出行陪伴
  W11: 'online_disclaimer'      // 线上陪伴内容协议
};

// 场景子服务选项兜底(与 init-db 种子 admin_config.scene_list / 小程序 constants 一致)
const SCENE_OPTIONS_FALLBACK = {
  W1: ['挂号排队', '取药送药', '陪诊解压'],
  W2: ['自习陪伴', '口语陪练', '作业督促'],
  W3: ['健身指导', '跑步陪跑', '器械陪同'],
  W7: ['树洞倾听', '情绪疏导', '考前鼓励'],
  W8: ['排队代办', '搬家帮手', '采买陪同'],
  W9: ['遛狗陪伴', '喂猫照料', '宠物就医陪同'],
  W10: ['逛街同行', '夜跑陪跑', '活动搭子'],
  W11: ['树洞倾听', '游戏陪玩', '打卡监督']
};

// 备注安全检测降级词库(rules.md 六 · msgSecCheck 不可用时降级本地违禁词)
const BLOCK_WORDS_FALLBACK = ['加微信', '加V', '转账', '私聊我'];
const REMARK_MAX_LEN = 200;

// 备注内容安全:msgSecCheck v2;87014 明确违规;其他异常(未开通/网络)降级本地违禁词
async function checkText(openid, text, blockWords) {
  try {
    await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 2,   // 2=评论/留言场景
      openid
    });
    return { pass: true };
  } catch (e) {
    if (e && (e.errCode === 87014 || e.errCode === '87014')) {
      return { pass: false, reason: '备注包含违规信息,请修改后重试' };
    }
    // 降级:本地违禁词库
    const words = (blockWords && blockWords.length) ? blockWords : BLOCK_WORDS_FALLBACK;
    const lower = String(text).toLowerCase();
    for (const w of words) {
      if (w && lower.indexOf(String(w).toLowerCase()) >= 0) {
        return { pass: false, reason: '备注包含平台禁止的内容(如联系方式/转账),请修改后重试' };
      }
    }
    return { pass: true };
  }
}

// 生成需求编号 DR + yyyymmdd + 6位随机
function genDemandNo() {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const r = Math.floor(100000 + Math.random() * 900000);
  return `DR${ymd}${r}`;
}

// 取运营参数(失败用兜底)
async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data.length) return r.data[0];
  } catch (e) {}
  return {
    rate_min_fen: 3000, rate_max_fen: 10000,
    youth_limit_fen: 20000,
    min_credit_place_order: 600,
    city_enabled: ['成都']
  };
}

// 获取用户文档
async function getUser(openid) {
  const r = await col('user_account').where({ openid }).limit(1).get();
  return (r.data && r.data[0]) || null;
}

// 检查紧急联系人是否已填
async function hasEmergencyContact(openid) {
  const r = await col('emergency_contact').where({ openid, is_deleted: false }).limit(1).get();
  return r.data && r.data.length > 0;
}

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制(拦截需求编号/占位符)
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || event.mock_openid;  // 测试用:云端测试可传 mock_openid 模拟身份
  if (!openid) return { ok: false, code: 'publish_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`demand-publish action=${action} openid=${openid}`);

  switch (action) {

    // 1. 发布需求
    case 'publish': {
      const {
        scene, start_time, duration_h, location, publish_location, content_option, content_options,
        remark, rate_fen, aa_tier, aa_promise_checked,
        match_mode, disclaimer_signed
      } = event;

      // ── 基础校验 ──
      if (!scene || SCENE_WHITELIST.indexOf(scene) < 0) {
        return { ok: false, code: 'publish_scene_invalid', msg: '场景不在白名单(仅 W1/W2/W8/W10/W11)' };
      }
      // 接单模式(默认抢单 broadcast; 选单 select 需耍伴报名→需求者确认)
      const mode = MATCH_MODE_WHITELIST.indexOf(match_mode) >= 0 ? match_mode : 'broadcast';
      if (!start_time || typeof start_time !== 'number' || start_time <= Date.now()) {
        return { ok: false, code: 'publish_start_time', msg: '开始时间必须是未来时间戳' };
      }
      // 服务时间距发布最长 30 天(产品反馈硬规则)
      const MAX_ADVANCE_MS = 30 * 24 * 3600 * 1000;
      if (start_time > Date.now() + MAX_ADVANCE_MS) {
        return { ok: false, code: 'publish_time_too_far', msg: '服务时间距发布时间不能超过 30 天' };
      }
      if (!duration_h || duration_h < 1 || duration_h > 12) {
        return { ok: false, code: 'publish_duration', msg: '时长需 1-12 小时' };
      }
      if (!rate_fen || typeof rate_fen !== 'number' || rate_fen < 100) {
        return { ok: false, code: 'publish_rate', msg: '时薪金额格式有误' };
      }
      if (!location || !location.name || !location.latitude || !location.longitude) {
        return { ok: false, code: 'publish_location', msg: '履约地点信息不完整,请在地图上选择' };
      }
      // 发布地址(发布时实际GPS, 只读留痕): 真实客户端必传; 自测链路(mock_openid)缺省时用履约地址兜底
      const isMockPub = !wxCtx.OPENID && !!event.mock_openid;
      let pubLoc = (publish_location && publish_location.latitude && publish_location.longitude)
        ? publish_location : null;
      if (!pubLoc) {
        if (isMockPub) {
          pubLoc = { name: location.name, latitude: location.latitude, longitude: location.longitude, city: location.city };
        } else {
          return { ok: false, code: 'publish_pub_location', msg: '发布地址缺失,请允许定位后重新发布' };
        }
      }
      if (!aa_tier) {
        return { ok: false, code: 'publish_aa_tier', msg: '请选择 AA 档位' };
      }
      // AA 承诺书必勾(rules.md 三.6 · 服务端兜底,不勾不能提交)
      if (!aa_promise_checked) {
        return { ok: false, code: 'publish_aa_promise', msg: '请先阅读并勾选《线下费用自理承诺书》' };
      }
      // 场景免责声明必勾(code.html 第一道防线·需求者下单前签署)
      if (!disclaimer_signed) {
        return { ok: false, code: 'publish_disclaimer', msg: '请先阅读并勾选《场景免责声明》' };
      }

      // 并行拉取 配置/用户/紧急联系人(减少串行往返, 冷启动也能压进超时)
      const [config, user, hasEC] = await Promise.all([
        getConfig(), getUser(openid), hasEmergencyContact(openid)
      ]);
      if (!user) return { ok: false, code: 'publish_no_user', msg: '用户不存在,请先登录' };

      // ── 账号状态: 冻结/封禁统一拦截 ──
      if (user.status === 'frozen') {
        return { ok: false, code: 'publish_frozen', msg: '账号已冻结,不可发布需求' };
      }
      if (user.status === 'banned') {
        return { ok: false, code: 'publish_banned', msg: '账号已封禁,请联系客服' };
      }
      if (user.status === 'closed') {
        return { ok: false, code: 'publish_closed', msg: '账号已注销' };
      }

      // ── 实名 + 紧急联系人 ──
      if (!user.is_realname_done) {
        return { ok: false, code: 'publish_not_realname', msg: '请先完成实名认证' };
      }
      if (!hasEC) {
        return { ok: false, code: 'publish_no_emergency', msg: '请先填写紧急联系人' };
      }

      // ── 信用分 ──
      if ((user.user_credit_score || 800) < (config.min_credit_place_order || 600)) {
        return { ok: false, code: 'publish_credit_low', msg: '信用分低于下单门槛,暂不能发布需求' };
      }

      // ── 金额校验(分单位 · rules.md 三.7) ──
      if (rate_fen < (config.rate_min_fen || 3000) || rate_fen > (config.rate_max_fen || 10000)) {
        return { ok: false, code: 'publish_rate_range', msg: '时薪不在允许区间(30-100 元/小时)' };
      }
      const total_fen = rate_fen * duration_h;
      if (typeof total_fen !== 'number' || total_fen <= 0) {
        return { ok: false, code: 'publish_total_invalid', msg: '总价计算异常' };
      }

      // ── 青少年保护(rules.md 三.10) ──
      if (user.age !== null && user.age !== undefined && user.age >= 18 && user.age <= 22) {
        if (total_fen > (config.youth_limit_fen || 20000)) {
          return { ok: false, code: 'publish_youth_limit', msg: '18-22 岁用户单笔订单上限 200 元' };
        }
      }

      // ── 城市(归一化: 去掉结尾「市」, 兼容「成都市」/「成都」两种写法) ──
      const normCity = (c) => String(c || '').replace(/市$/, '').trim();
      const city = normCity(location.city) || '成都';
      // 白名单: 配置缺失/为空数组时兜底「成都」(空数组是真值, 不会走 || 兜底, 需显式判空)
      let enabledCities = (Array.isArray(config.city_enabled) ? config.city_enabled : [])
        .map(normCity).filter(Boolean);
      if (enabledCities.length === 0) enabledCities = ['成都'];
      // 精确匹配优先; 容错: 城市串/地点名包含任一开通城市名也放行(防止前端解析出「川省成都」类脏值误伤)
      const locName = String((location && location.name) || '');
      const cityOk = enabledCities.indexOf(city) >= 0
        || enabledCities.some((c) => city.indexOf(c) >= 0 || locName.indexOf(c) >= 0);
      if (!cityOk) {
        return { ok: false, code: 'publish_city_disabled', msg: `当前城市未开通服务(${city})` };
      }

      // ── 子服务内容校验(多选;兼容旧版单选 content_option) ──
      let opts = Array.isArray(content_options)
        ? content_options
        : (typeof content_option === 'string' ? [content_option] : []);
      opts = Array.from(new Set(opts.map((s) => String(s || '').trim()).filter(Boolean)));
      if (opts.length === 0) {
        return { ok: false, code: 'publish_content_option', msg: '请选择服务内容' };
      }
      if (opts.length > 3) {
        return { ok: false, code: 'publish_content_too_many', msg: '服务内容最多选择 3 项' };
      }
      // 选项必须属于该场景(admin_config.scene_list 优先,兜底常量)
      const sceneCfg = (config.scene_list || []).find((s) => s.code === scene);
      const allowedOptions = (sceneCfg && sceneCfg.options) || SCENE_OPTIONS_FALLBACK[scene] || [];
      for (const o of opts) {
        if (allowedOptions.indexOf(o) < 0) {
          return { ok: false, code: 'publish_content_invalid', msg: `服务内容「${o}」不在该场景可选项内` };
        }
      }

      // ── 备注安全检测(msgSecCheck v2,降级违禁词 · rules.md 六) ──
      const remarkStr = remark ? String(remark).trim() : '';
      if (remarkStr) {
        if (remarkStr.length > REMARK_MAX_LEN) {
          return { ok: false, code: 'publish_remark_long', msg: `备注最长 ${REMARK_MAX_LEN} 字` };
        }
        const chk = await checkText(openid, remarkStr, config.block_words);
        if (!chk.pass) {
          return { ok: false, code: 'publish_remark_blocked', msg: chk.reason };
        }
      }

      // ── 时间冲突校验:同用户 + 同场景 + 服务内容有交集,时间段不可重叠 ──
      const newStart = start_time;
      const newEnd = start_time + duration_h * 3600 * 1000;
      const existDemands = await col('demand').where({
        creator_openid: openid,
        scene,
        is_deleted: false,
        status: _.neq('cancelled')
      }).get();
      for (const d of existDemands.data) {
        const oldStart = d.start_time;
        const oldEnd = d.start_time + (d.duration_h || 1) * 3600 * 1000;
        // 区间重叠判定:新区间与旧区间有交集(端点相接不算冲突)
        if (!(newStart < oldEnd && oldStart < newEnd)) continue;
        // 多选口径:服务内容有交集才算冲突
        const oldOpts = (d.content_options && d.content_options.length)
          ? d.content_options
          : (d.content_option ? [d.content_option] : []);
        if (opts.some((o) => oldOpts.indexOf(o) >= 0)) {
          return { ok: false, code: 'publish_time_conflict', msg: '该时段已有同类服务需求,请调整时间' };
        }
      }

      // ── 写入 ──
      const now = Date.now();
      const demand_no = genDemandNo();
      const doc = {
        demand_no,
        creator_openid: openid,
        scene,
        start_time,
        duration_h,
        location: { name: location.name, latitude: location.latitude, longitude: location.longitude, city },
        // 发布地址: 发布时实际GPS定位(只读留痕, 不参与接单距离/通勤计算)
        publish_location: {
          name: pubLoc.name || '当前位置',
          latitude: pubLoc.latitude,
          longitude: pubLoc.longitude,
          city: normCity(pubLoc.city) || city
        },
        content_option: opts[0],  // 兼容旧字段:取首项
        content_options: opts,    // 多选全量
        remark: remarkStr,
        rate_fen,
        total_fen,
        aa_tier,
        aa_promise_signed: !!aa_promise_checked,   // rules.md 三.6 AA承诺书(服务端已兜底校验)
        // ── 合规双签(code.html 第一道防线) ──
        disclaimer_type: DISCLAIMER_TYPE_MAP[scene] || 'general_disclaimer',
        disclaimer_signed: true,
        disclaimer_signed_at: now,
        // ── 接单模式 ──
        match_mode: mode,                            // broadcast=抢单 / select=选单
        applicants: [],                              // 选单模式:报名耍伴列表
        matched_openid: null,                        // 选单模式:已确认的耍伴
        status: 'matching',
        match_candidates: [],
        invited: [],
        broadcast: mode === 'broadcast',  // 抢单模式入厅可接;选单模式需报名→确认
        expire_at: now + 24 * 3600 * 1000,  // 24h 后过期
        created_at: now,
        updated_at: now,
        is_deleted: false
      };

      try {
        const addRes = await col('demand').add({ data: doc });
        console.log(`demand created: ${demand_no}`);
        return {
          ok: true,
          data: {
            _id: addRes._id, demand_no, total_fen, status: 'matching', expire_at: doc.expire_at
          }
        };
      } catch (e) {
        console.log(`demand publish fail: ${e.message}`);
        return { ok: false, code: 'publish_db_fail', msg: '需求发布失败' };
      }
    }

    // 2. 取消需求(仅创建者,仅 matching 状态)
    case 'cancel': {
      const { demand_id } = event;
      if (!demand_id) return { ok: false, code: 'cancel_no_id', msg: '缺少需求 ID' };
      if (!isValidDocId(demand_id)) return { ok: false, code: 'cancel_bad_id', msg: '需求 ID 格式不正确:请传入需求 _id(32位十六进制),不是需求编号(DR 开头)' };

      // 先懒过期
      await lazyExpire();

      try {
        const r = await col('demand').doc(demand_id).get();
        const d = r.data;
        if (!d) return { ok: false, code: 'cancel_not_found', msg: '需求不存在' };
        if (d.creator_openid !== openid) {
          return { ok: false, code: 'cancel_not_owner', msg: '只能取消自己的需求' };
        }
        if (d.status !== 'matching') {
          return { ok: false, code: 'cancel_status', msg: `当前状态${d.status},不可取消` };
        }
        // CAS: 仅 matching→cancelled, 与接单(order-create CAS matching→matched)/懒过期互斥
        const cr = await col('demand').where({ _id: demand_id, status: 'matching' }).update({ data: {
          status: 'cancelled', cancelled_at: Date.now(), updated_at: Date.now()
        }});
        if (!cr.stats || cr.stats.updated !== 1) {
          return { ok: false, code: 'cancel_status', msg: '需求状态已变化,请刷新后重试' };
        }
        console.log(`demand cancelled: ${d.demand_no}`);
        return { ok: true, data: { demand_id, status: 'cancelled' } };
      } catch (e) {
        return { ok: false, code: 'cancel_fail', msg: '取消失败' };
      }
    }

    // 3. 我的需求列表(含候选耍伴摘要)
    case 'my_demands': {
      // 先懒过期
      await lazyExpire();
      try {
        const r = await col('demand').where({
          creator_openid: openid, is_deleted: false
        }).orderBy('created_at', 'desc').limit(50).get();

        const list = (r.data || []).map(d => ({
          _id: d._id, demand_no: d.demand_no, scene: d.scene,
          start_time: d.start_time, duration_h: d.duration_h,
          total_fen: d.total_fen, status: d.status,
          match_candidates: (d.match_candidates || []).slice(0, 5),
          invited: d.invited || [],
          broadcast: !!d.broadcast,
          created_at: d.created_at
        }));
        return { ok: true, data: { list } };
      } catch (e) {
        return { ok: false, code: 'my_demands_fail', msg: '查询失败' };
      }
    }

    // 4. 懒过期:把过期 matching 需求置为 expired
    case 'lazy_expire': {
      const n = await lazyExpire();
      return { ok: true, data: { expired_count: n } };
    }

    default:
      return { ok: false, code: 'publish_unknown_action', msg: '未知动作' };
  }
};

// ─────────────── 内部函数 ───────────────
// 懒过期:把 expire_at 已过期的 matching 需求置为 expired
async function lazyExpire() {
  try {
    const r = await col('demand').where({
      status: 'matching', expire_at: _.lt(Date.now()), is_deleted: false
    }).limit(100).get();
    if (!r.data || r.data.length === 0) return 0;
    let n = 0;
    for (const d of r.data) {
      // CAS: 仅 matching→expired, 不覆盖刚被接单(matched)/取消的需求
      try {
        const cr = await col('demand').where({ _id: d._id, status: 'matching' }).update({ data: {
          status: 'expired', expired_at: Date.now(), updated_at: Date.now()
        }});
        if (cr.stats && cr.stats.updated === 1) {
          n++;
          console.log(`demand expired: ${d.demand_no}`);
        }
      } catch (e) {}
    }
    return n;
  } catch (e) {
    console.log(`lazy_expire error: ${e.message}`);
    return 0;
  }
}
