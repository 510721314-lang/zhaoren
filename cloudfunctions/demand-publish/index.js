// 对应 PRD 章节：3.3 需求发布功能 / 8.4.1 需求超时与梯度退款 / 11 业务场景白名单
// demand-publish 需求发布 · 身份取自 getWXContext().OPENID
// 8 个 action: publish / cancel / my_demands / lazy_expire / detail
//             / save_draft(新增或更新草稿) / list_drafts(草稿列表,过滤过期) / delete_draft(软删)
// 草稿上限与有效期与小程序 config/index.js DRAFT 对齐: maxCount=20 / expireDays=30
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');

// 场景白名单(MVP-V1 · rules.md 三.11)
const SCENE_WHITELIST = ['W1', 'W2', 'W3', 'W7', 'W8', 'W9', 'W10', 'W11'];

// 接单模式白名单: direct=定向邀约(指定耍伴,不入大厅) · broadcast=抢单(先到先得) · select=选单(耍伴报名→需求者确认)
const MATCH_MODE_WHITELIST = ['direct', 'broadcast', 'select'];

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

// 生成需求编号 DR + yyyymmdd + 8字节密码学随机
function genDemandNo() {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const r = require('crypto').randomBytes(8).toString('hex');
  return `DR${ymd}${r}`;
}

// Haversine 球面距离(公里) · 两经纬度间直线距离
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validLngLat(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number'
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0);
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
    city_enabled: ['成都'],
    publish_distance_max_km: 50,
    take_distance_max_km: 50
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

// 写入自愈:集合不存在(-502005)时建集合并重试一次(demand_draft 首次落库兜底)
async function addWithColl(name, doc) {
  try {
    return await col(name).add({ data: doc });
  } catch (e) {
    const sig = `${e && e.errCode || ''} ${e && e.message || ''}`;
    if (!/502005|not exist|不存在/i.test(sig)) throw e;
    await db.createCollection(name);
    return await col(name).add({ data: doc });
  }
}

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'publish_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`demand-publish action=${action} openid=${openid}`);

  switch (action) {

    // 1. 发布需求
    case 'publish': {
      const {
        scene, start_time, duration_h, location, publish_location, content_option, content_options,
        remark, rate_fen, aa_tier, aa_promise_checked,
        match_mode, disclaimer_signed, target_openid
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
      // 履约地点: MVP 阶段只校验 name 非空, 经纬度可选(隐私指引审核期间用户无法选点, 允许 0)
      if (!location || !location.name) {
        return { ok: false, code: 'publish_location', msg: '请填写履约地点名称' };
      }
      // 发布地址(发布者当前精确 GPS, 只读留痕且不可手改):
      // 这里只解析, 强校验(必须真实坐标/与履约地距离)在 config 读取后执行; 禁止再用履约地兜底
      const pubLoc = (publish_location
        && validLngLat(Number(publish_location.latitude), Number(publish_location.longitude)))
        ? {
            name: publish_location.name || '当前位置',
            latitude: Number(publish_location.latitude),
            longitude: Number(publish_location.longitude),
            city: publish_location.city
          }
        : null;
      // 服务端自测链路(mock_openid 且无真实 OPENID)无定位, 沿用旧兜底以免阻断自动化回归
      const isMockCall = !wxCtx.OPENID && !!event.mock_openid;
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

      // ── 实名 + 紧急联系人（首次发布自动 bootstrap MVP 账号）──
      // is_realname_simulated 是 user-login 为新用户标记的"模拟实名", MVP 阶段自动升级为真实实名
      if (!user.is_realname_done) {
        if (user.is_realname_simulated) {
          await col('user_account').doc(user._id).update({
            data: { is_realname_done: true, updated_at: Date.now() }
          });
          user.is_realname_done = true;
        } else {
          return { ok: false, code: 'publish_not_realname', msg: '请先完成实名认证' };
        }
      }
      if (!hasEC) {
        // MVP bootstrap: 首次发布自动创建一个占位紧急联系人
        await col('emergency_contact').add({
          data: {
            openid, name: '紧急联系人', phone: '13800000000',
            relation: '家人', is_deleted: false,
            created_at: Date.now(), updated_at: Date.now()
          }
        });
      }

      // ── 信用分 ──
      if ((user.user_credit_score || 800) < (config.min_credit_place_order || 600)) {
        return { ok: false, code: 'publish_credit_low', msg: '信用分低于下单门槛,暂不能发布需求' };
      }

      // ── 发布地址强校验(发布者当前精确GPS, 只读不可手改, 防恶意虚拟定位) ──
      // mock 自测链路无 GPS 跳过; 真实客户端必须携带真实坐标
      if (!isMockCall && !pubLoc) {
        return { ok: false, code: 'publish_location_required', msg: '发布需求需要获取你的当前位置,请授权定位后重试' };
      }
      // 发布位置 ↔ 履约地直线距离 ≤ 后台阈值(默认50km); 履约地无坐标时跳过(隐私审核期允许手填地点)
      if (!isMockCall && validLngLat(Number(location.latitude), Number(location.longitude))) {
        const pubDistKm = haversineKm(
          pubLoc.latitude, pubLoc.longitude,
          Number(location.latitude), Number(location.longitude)
        );
        const maxPubKm = Number(config.publish_distance_max_km) || 50;
        if (pubDistKm > maxPubKm) {
          return {
            ok: false,
            code: 'publish_too_far',
            msg: `你当前位置距履约地点约 ${Math.round(pubDistKm)} 公里,超过 ${maxPubKm} 公里,请确认履约地点或到达当地后发布`
          };
        }
      }

      // ── 定向邀约: 必须指定一个已审核通过的耍伴, 需求不入大厅仅TA可接 ──
      if (mode === 'direct') {
        if (!target_openid || typeof target_openid !== 'string') {
          return { ok: false, code: 'publish_target_required', msg: '定向邀约缺少指定耍伴' };
        }
        if (target_openid === openid) {
          return { ok: false, code: 'publish_target_self', msg: '不能定向邀约自己' };
        }
        const tpR = await col('partner_profile')
          .where({ openid: target_openid, status: 'approved', is_deleted: _.neq(true) })
          .limit(1).get().catch(() => ({ data: [] }));
        if (!(tpR.data && tpR.data[0])) {
          return { ok: false, code: 'publish_target_invalid', msg: '指定耍伴不存在或未通过审核' };
        }
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
        project_attr: 'commercial',
        start_time,
        duration_h,
        location: { name: location.name, latitude: location.latitude, longitude: location.longitude, city },
        // 发布地址: 发布时实际GPS定位(只读留痕, 不参与接单距离/通勤计算)
        // 真实调用 pubLoc 已强校验非空; mock 自测链路无GPS, 沿用履约地兜底以免阻断自动化回归
        publish_location: isMockCall
          ? { name: location.name || '当前位置', latitude: Number(location.latitude) || 0, longitude: Number(location.longitude) || 0, city }
          : {
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
        invited: mode === 'direct' ? [target_openid] : [],  // 定向: 仅受邀耍伴可接
        broadcast: mode === 'broadcast',  // 仅抢单模式入厅; 定向/选单不入公共大厅
        expire_at: now + 24 * 3600 * 1000,  // 24h 后过期
        created_at: now,
        updated_at: now,
        is_deleted: false
      };

      try {
        const addRes = await col('demand').add({ data: doc });
        log.d(`demand created: ${demand_no}`);

        // 定向邀约: 给受邀耍伴写系统通知(不阻断主流程), 通知点击直达需求详情
        if (mode === 'direct') {
          try {
            const callerName = user.nickname || user.surname || '发单人';
            await col('system_notice').add({
              data: {
                to_openid: target_openid,
                order_id: '',
                demand_id: addRes._id,
                type: 'direct_invite',
                title: '你收到一条定向需求邀约',
                body: `${callerName}定向向你发布了一条需求,请在24小时内查看并接单`,
                action_key: 'jump_demand',
                action_payload: { demand_id: addRes._id },
                created_at: now,
                read: false
              }
            });
          } catch (ne) {
            log.d(`direct invite notice fail: ${ne.message}`);
          }
        }

        // 发布成功后清理来源草稿(若本次发布由草稿发起), 避免残留草稿导致重复发布
        let draftCleared = false;
        const srcDraftId = event.draft_id;
        if (srcDraftId && isValidDocId(srcDraftId)) {
          try {
            const dRes = await col('demand_draft').doc(srcDraftId).get();
            const d = dRes.data;
            if (d && d.openid === openid && !d.is_deleted) {
              await col('demand_draft').doc(srcDraftId).update({
                data: { is_deleted: true, updated_at: now }
              });
              draftCleared = true;
            }
          } catch (e) { /* 草稿清理失败不阻断发布 */ }
        }
        return {
          ok: true,
          data: {
            _id: addRes._id, demand_no, total_fen, status: 'matching',
            expire_at: doc.expire_at, draft_cleared: draftCleared
          }
        };
      } catch (e) {
        log.d(`demand publish fail: ${e.message}`);
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
        log.d(`demand cancelled: ${d.demand_no}`);
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

    // 5. 需求详情(公开, 含发布者姓氏)
    case 'detail': {
      const { demand_id } = event;
      if (!demand_id) return { ok: false, code: 'detail_no_id', msg: '缺少需求 ID' };
      if (!isValidDocId(demand_id)) return { ok: false, code: 'detail_bad_id', msg: '需求 ID 格式不正确' };

      try {
        const r = await col('demand').doc(demand_id).get();
        const d = r.data;
        if (!d || d.is_deleted) return { ok: false, code: 'detail_not_found', msg: '需求不存在或已删除' };

        // 发布者姓氏(取 surname / real_name / nickname 首字)
        let surname = '匿';
        try {
          const uR = await col('user_account').where({ openid: d.creator_openid }).limit(1).get();
          const u = (uR.data && uR.data[0]) || {};
          const name = u.surname || u.real_name || u.nickname || '';
          surname = name ? String(name).charAt(0) : '匿';
        } catch (e) {}

        // 备注拆分: 标题｜描述(full-width ｜)
        const remarkParts = String(d.remark || '').split('｜');
        const title = remarkParts[0] ? remarkParts[0].trim() : (d.content_options && d.content_options[0]) || '需求';
        const description = remarkParts[1] ? remarkParts[1].trim() : '';

        // 时间格式化
        const dt = new Date(d.start_time);
        const pad = (n) => n < 10 ? '0' + n : '' + n;
        const service_date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
        const service_time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

        // 发布于 X 分钟前
        const minutes_ago = Math.max(1, Math.floor((Date.now() - (d.created_at || Date.now())) / 60000));

        const data = {
          _id: d._id,
          demand_no: d.demand_no,
          scene_code: d.scene,
          project_attr: d.project_attr || 'commercial',
          title,
          description,
          service_date,
          service_time,
          duration_hours: d.duration_h,
          location: d.location || { name: '', address: '' },
          district: (d.location && d.location.city) || '',
          distance_km: null,
          headcount: 1,
          budget: Math.round((d.rate_fen || 0) / 100),
          aa_estimate: d.aa_tier || '0-50',
          match_mode: d.match_mode || 'broadcast',
          // 是否入公共大厅(定向需求不在大厅/首页出现)
          broadcast: !!d.broadcast,
          status: d.status,
          is_owner: d.creator_openid === openid,
          // 非发布者是否可接单: 选单走报名流程放行; 抢单需 broadcast; 定向需在受邀名单
          can_take: d.creator_openid === openid
            ? false
            : ((d.match_mode || 'broadcast') === 'select'
              || !!d.broadcast
              || ((d.invited || []).indexOf(openid) >= 0)),
          publisher: {
            surname,
            real_name_verified: true,
            minutes_ago
          },
          created_at: d.created_at
        };
        return { ok: true, data };
      } catch (e) {
        log.d(`demand detail fail: ${e.message}`);
        return { ok: false, code: 'detail_fail', msg: '查询需求详情失败' };
      }
    }

    // 6. 保存需求草稿(有 draft_id 则更新,无则新增;上限 20 条/有效期 30 天)
    case 'save_draft': {
      const { draft_id, demand_data } = event;
      const data = (demand_data && typeof demand_data === 'object' && !Array.isArray(demand_data)) ? demand_data : null;
      if (!data) return { ok: false, code: 'draft_no_data', msg: '草稿内容为空' };
      if (JSON.stringify(data).length > 10000) {
        return { ok: false, code: 'draft_too_large', msg: '草稿内容过大' };
      }
      const now = Date.now();
      const expire_at = now + 30 * 24 * 3600 * 1000;  // DRAFT.expireDays=30

      // 更新已有草稿
      if (draft_id) {
        if (!isValidDocId(draft_id)) return { ok: false, code: 'draft_bad_id', msg: '草稿 ID 格式不正确' };
        try {
          const r = await col('demand_draft').doc(draft_id).get();
          const d = r.data;
          if (!d || d.is_deleted) return { ok: false, code: 'draft_not_found', msg: '草稿不存在' };
          if (d.openid !== openid) return { ok: false, code: 'draft_not_owner', msg: '只能编辑自己的草稿' };
          await col('demand_draft').doc(draft_id).update({
            data: { demand_data: data, expire_at, updated_at: now }
          });
          return { ok: true, data: { draft_id, updated: true } };
        } catch (e) {
          return { ok: false, code: 'draft_fail', msg: '草稿保存失败' };
        }
      }

      // 新增草稿: 数量上限 20 条(DRAFT.maxCount=20)
      try {
        // 新增草稿: 数量上限 20 条(DRAFT.maxCount=20); 计数只算未过期未删除,
        // 否则过期草稿在列表不可见/不可删却占名额, 会永久无法保存新草稿
        const c = await col('demand_draft').where({
          openid, is_deleted: false, expire_at: _.gt(now)
        }).count()
          .catch(() => ({ total: 0 }));  // 集合尚未创建时按 0 处理
        if ((c.total || 0) >= 20) {
          return { ok: false, code: 'draft_limit', msg: '草稿最多保存 20 条,请先清理草稿箱' };
        }
        const addR = await addWithColl('demand_draft', {
          openid, demand_data: data, expire_at,
          created_at: now, updated_at: now, is_deleted: false
        });
        return { ok: true, data: { draft_id: addR._id, created: true } };
      } catch (e) {
        return { ok: false, code: 'draft_fail', msg: '草稿保存失败' };
      }
    }

    // 7. 草稿列表(过滤已过期,最近更新在前; 集合尚未创建时返回空列表)
    case 'list_drafts': {
      try {
        const r = await col('demand_draft').where({
          openid, is_deleted: false, expire_at: _.gt(Date.now())
        }).orderBy('updated_at', 'desc').limit(20).get().catch(() => ({ data: [] }));
        const list = (r.data || []).map((d) => ({
          _id: d._id,
          demand_data: d.demand_data || {},
          created_at: d.created_at,
          updated_at: d.updated_at,
          expire_at: d.expire_at
        }));
        return { ok: true, data: { list } };
      } catch (e) {
        return { ok: false, code: 'draft_list_fail', msg: '草稿查询失败' };
      }
    }

    // 8. 删除草稿(软删,仅创建者)
    case 'delete_draft': {
      const { draft_id } = event;
      if (!draft_id) return { ok: false, code: 'draft_no_id', msg: '缺少草稿 ID' };
      if (!isValidDocId(draft_id)) return { ok: false, code: 'draft_bad_id', msg: '草稿 ID 格式不正确' };
      try {
        const r = await col('demand_draft').doc(draft_id).get();
        const d = r.data;
        if (!d || d.is_deleted) return { ok: false, code: 'draft_not_found', msg: '草稿不存在' };
        if (d.openid !== openid) return { ok: false, code: 'draft_not_owner', msg: '只能删除自己的草稿' };
        await col('demand_draft').doc(draft_id).update({
          data: { is_deleted: true, updated_at: Date.now() }
        });
        return { ok: true, data: { draft_id, deleted: true } };
      } catch (e) {
        return { ok: false, code: 'draft_fail', msg: '草稿删除失败' };
      }
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
          log.d(`demand expired: ${d.demand_no}`);
        }
      } catch (e) {}
    }
    return n;
  } catch (e) {
    log.d(`lazy_expire error: ${e.message}`);
    return 0;
  }
}
