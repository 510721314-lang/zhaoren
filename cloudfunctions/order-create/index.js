// 对应 PRD 章节：3.5 订单交易系统 / 3.5.2 订单创建 / 附录G 状态机 / 8.1 信用分 / 1.7.1 青少年保护
// order-create 订单创建 · 耍伴接单(create_from_take) · 免责声明签署(sign_disclaimer)
// 2 个 action: create_from_take / sign_disclaimer · 订单初始状态 S1(待确认/四确认阶段)
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);
const log = require('./logger');
const { writeAudit } = require('./audit');
// 物理拆分后的 action handler 分发(aux: 只读/留证类; take: create_from_take 建单)
const HANDLERS = { ...require('./action_aux'), ...require('./action_take') };

// 进行中订单状态集合(用于"无进行中订单"校验)
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

// ── 接单互斥锁 ──
// 事务不支持 where 批量查询(官方限制), 「时间重叠/日上限检查 → CAS → 建单」无法放进同一事务原子化;
// 用 user_account 文档上的咨询锁把整段串行化: 同一耍伴并发接单(F1 retry 风暴等)只有一个能持有锁,
// 另一个返回 order_take_busy, 杜绝并发同时通过检查造成时间重叠/日上限超卖。
// 锁字段挂 user_account(openid 为字段; 曾误挂 users 集合致 `_id: openid` 永不命中 → 全部抢单被拦, 已修)。
const TAKE_LOCK_TTL = 30000;   // 30s 锁超时(覆盖函数执行时长上限), 异常退出遗留的过期锁可被抢占

async function acquireTakeLock(openid, token) {
  const exp = Date.now() + TAKE_LOCK_TTL;
  for (let i = 0; i < 4; i++) {
    try {
      // 原子抢占: 仅锁空闲(''或字段缺失)或已过期时命中; 锁挂 user_account(openid 为字段, _id 非 openid)
      const res = await col('user_account').where(_.or([
        { openid, take_lock_owner: _.exists(false) },
        { openid, take_lock_owner: '' },
        { openid, take_lock_expire: _.lt(Date.now()) }
      ])).update({ data: { take_lock_owner: token, take_lock_expire: exp } });
      if (res.stats && res.stats.updated === 1) return true;
    } catch (e) {
      // 锁基础设施异常 = fail-open: 放行接单(不阻断主业), 仅记日志, 修复退化为旧行为而非全拒
      log.d(`take lock acquire error(fail-open): ${e.message}`);
      return true;
    }
    // 被并发的同耍伴接单短暂持有: 等待重试(持锁窗口极短, 通常一两次即成功)
    await new Promise((r) => setTimeout(r, 100));
  }
  // 兜底: 用户文档不存在(openid 无 user_account 记录)时无法加锁, 退化为放行, 避免误伤
  try {
    const ur = await col('user_account').where({ openid }).limit(1).get();
    if (!ur.data || !ur.data.length) return true;
  } catch (e) { return true; }
  return false;
}

async function releaseTakeLock(openid, token) {
  // token 匹配才释放, 防 TTL 过期被抢占后误释放他人锁
  await col('user_account').where({ openid, take_lock_owner: token })
    .update({ data: { take_lock_owner: '', take_lock_expire: 0 } })
    .catch((e) => log.d(`take lock release fail: ${e.message}`));
}

async function getConfig() {
  try {
    const r = await col('admin_config').doc('global').get();
    if (r.data) return r.data;   // doc().get() 返回单个对象(非数组)
  } catch (e) {}
  return {
    platform_fee_rate_fen: 1000,
    min_credit_take_order: 600,
    min_credit_place_order: 600,
    youth_limit_fen: 20000,
    take_distance_max_km: TAKE_MAX_DISTANCE_KM
  };
}

// ── 接单配置校验辅助(时间红线 / 价格区间 / 每周时段 / 距离) ──
// D2-3 防漂移抽取: 规范源 _shared/take_rules.js(修改后跑 sync-take-rules.ps1 同步四个函数)
const {
  isServiceTimeAllowed, readRateRange, readTotalRange, slotCovers, cnDayStart, DAY_MS,
  suspendLeftDays, haversineKm, TAKE_MAX_DISTANCE_KM
} = require('./take_rules');
// D4-5 防漂移抽取: 资金规则规范源 _shared/money_rules.js(修改后跑 sync-money-rules.ps1 同步)
const { splitOrderAmount } = require('./money_rules');
// D4-5 防漂移抽取: 测试数据打标规范源 _shared/test_data.js(修改后跑 sync-test-data.ps1 同步)
const { isTestPair } = require('./test_data');

async function getUser(openid) {
  const r = await col('user_account').where({ openid }).limit(1).get();
  return (r.data && r.data[0]) || null;
}

// 容错读取耍伴资料: is_deleted 缺省(历史坏文档)视为有效并惰性治愈(见 ./heal)
const { getHealedPartnerProfile } = require('./heal');
async function getPartnerProfile(openid) {
  return getHealedPartnerProfile(col, _, openid);
}

async function getDemand(demandId) {
  try {
    return (await col('demand').doc(demandId).get()).data || null;
  } catch (e) {
    return null;
  }
}

// 接单被拒写 P3 事件,便于排查
async function logReject(openid, demand_id, reason) {
  try {
    await col('platform_event').add({ data: {
      level: 'P3', type: 'take_rejected', openid,
      payload: { demand_id, reason },
      created_at: Date.now(), updated_at: Date.now(), is_deleted: false
    }});
    log.d(`take_rejected: openid=${openid} demand=${demand_id} reason=${reason}`);
  } catch (e) {
    log.d(`logReject fail: ${e.message}`);
  }
}

// 生成订单编号(2026-10-21 用户确认改为纯数字): yyyymmdd + 10 位密码学随机数字 = 18 位
// - 唯一性: 单日随机空间 10^10, 另有唯一索引 uk_order_no 兜底;
// - 兼容性: 历史订单仍为 ORD+yyyymmdd+16hex, 反查逻辑需同时支持两种形态
function genOrderNo() {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  let r = '';
  for (let i = 0; i < 10; i++) r += String(crypto.randomInt(0, 10));
  return `${ymd}${r}`;
}

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制(拦截需求编号/占位符)
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

// ─────────────── P1 节点留证(勾选同意型) ───────────────
// 接单前耍伴勾选《场景免责声明》; 服务端记录所同意文档全文 + SHA-256 落 disclaimer_signature 集合。
// 与实名手写签名留证(kind=realname_agreement)同集合不同 kind; 全文入库保证事后可举证"当时同意的是什么"
function sceneDocText(config, scene) {
  const m = config && config.legal_scene_disclaimers;
  const t = (m && typeof m === 'object') ? m[scene] : '';
  return typeof t === 'string' ? t.trim() : '';
}
function buildCheckboxEvidence(o) {
  const text = sceneDocText(o.config, o.scene);
  const docs = text ? [{
    key: 'scene_disclaimer',
    title: `场景免责声明(${o.scene})`,
    hash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    text
  }] : [];
  const data = {
    openid: o.openid,
    role: o.role,
    scene: o.scene,
    kind: 'scene_disclaimer',
    disclaimer_type: o.disclaimerType,
    agree_type: 'checkbox',   // 勾选同意(无手写签名; 手写签名见 kind=realname_agreement)
    docs,
    // 兼容旧字段: 原为占位 sig_xxx, 现为所同意文档的 SHA-256(文档缺失时保留占位以标记异常)
    signature_hash: docs.length ? docs[0].hash : `sig_missing_${o.openid}_${o.scene}_${o.signedAt}`,
    signed_at: o.signedAt,
    created_at: o.signedAt,
    updated_at: o.signedAt,
    is_deleted: false
  };
  if (o.demandId) data.demand_id = o.demandId;
  if (o.orderId) data.order_id = o.orderId;
  return data;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('./openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'order_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  log.d(`order-create action=${action} openid=${openid}`);

  // 审计留痕公共字段
  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  // 分发: 已物理抽出的 action(aux: check_signed/sign_disclaimer/check_take_result; take: create_from_take)
  // 共享符号经 ctx 注入; handler 内禁止 require('./index') 以免循环依赖
  if (HANDLERS[action]) {
    return await HANDLERS[action]({
      event, openid, wxCtx, clientIp, device, db, col, _, log, writeAudit,
      crypto, BUSY_STATUS, acquireTakeLock, releaseTakeLock, getConfig,
      isServiceTimeAllowed, readRateRange, readTotalRange, slotCovers, cnDayStart, DAY_MS,
      suspendLeftDays, haversineKm, TAKE_MAX_DISTANCE_KM, splitOrderAmount, isTestPair,
      getUser, getPartnerProfile, getDemand, logReject, genOrderNo, isValidDocId, buildCheckboxEvidence
    });
  }

  return { ok: false, code: 'order_unknown_action', msg: '未知动作' };
};
