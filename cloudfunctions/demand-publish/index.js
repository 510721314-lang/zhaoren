// 对应 PRD 章节：3.3 需求发布功能 / 8.4.1 需求超时与梯度退款 / 11 业务场景白名单
// demand-publish 需求发布 · 身份取自 getWXContext().OPENID
// 4 个 action: publish / cancel / my_demands / lazy_expire
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

// 场景白名单(MVP-V1 · rules.md 三.11)
const SCENE_WHITELIST = ['W1', 'W2', 'W8', 'W10', 'W11'];

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

// ─────────────── 主入口 ───────────────
exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return { ok: false, code: 'publish_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`demand-publish action=${action} openid=${openid}`);

  switch (action) {

    // 1. 发布需求
    case 'publish': {
      const {
        scene, start_time, duration_h, location, content_options, remark,
        rate_fen, aa_tier
      } = event;

      // ── 基础校验 ──
      if (!scene || SCENE_WHITELIST.indexOf(scene) < 0) {
        return { ok: false, code: 'publish_scene_invalid', msg: '场景不在白名单(仅 W1/W2/W8/W10/W11)' };
      }
      if (!start_time || typeof start_time !== 'number' || start_time <= Date.now()) {
        return { ok: false, code: 'publish_start_time', msg: '开始时间必须是未来时间戳' };
      }
      if (!duration_h || duration_h < 1 || duration_h > 12) {
        return { ok: false, code: 'publish_duration', msg: '时长需 1-12 小时' };
      }
      if (!rate_fen || typeof rate_fen !== 'number' || rate_fen < 100) {
        return { ok: false, code: 'publish_rate', msg: '时薪金额格式有误' };
      }
      if (!location || !location.name || !location.latitude || !location.longitude) {
        return { ok: false, code: 'publish_location', msg: '服务地点信息不完整' };
      }
      if (!aa_tier) {
        return { ok: false, code: 'publish_aa_tier', msg: '请选择 AA 档位' };
      }

      const config = await getConfig();
      const user = await getUser(openid);
      if (!user) return { ok: false, code: 'publish_no_user', msg: '用户不存在,请先登录' };

      // ── 实名 + 紧急联系人 ──
      if (!user.is_realname_done) {
        return { ok: false, code: 'publish_not_realname', msg: '请先完成实名认证' };
      }
      const hasEC = await hasEmergencyContact(openid);
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

      // ── 城市 ──
      const city = (location.city || '成都');
      if ((config.city_enabled || ['成都']).indexOf(city) < 0) {
        return { ok: false, code: 'publish_city_disabled', msg: '当前城市未开通服务' };
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
        content_options: Array.isArray(content_options) ? content_options : [],
        remark: remark || '',
        rate_fen,
        total_fen,
        aa_tier,
        aa_promise_signed: true,   // rules.md 三.6 AA承诺书
        match_mode: 'broadcast',   // 默认广场广播
        status: 'matching',
        match_candidates: [],
        invited: [],
        broadcast: false,
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
        await col('demand').doc(demand_id).update({ data: {
          status: 'cancelled', updated_at: Date.now()
        }});
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
    for (const d of r.data) {
      await col('demand').doc(d._id).update({ data: {
        status: 'expired', updated_at: Date.now()
      }});
      console.log(`demand expired: ${d.demand_no}`);
    }
    return r.data.length;
  } catch (e) {
    console.log(`lazy_expire error: ${e.message}`);
    return 0;
  }
}
