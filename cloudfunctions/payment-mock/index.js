// 对应 PRD 章节：3.5.1 资金担保与分账架构 / 8.4 退款规则 / 3.4 AA费用 / 附录G 状态机
// payment-mock 模拟支付与退款(MVP 无真实微信支付,一律 is_mock=true)
// 9 个 action: cashier_info(收银台摘要) / mock_pay(模拟支付) / mock_refund(模拟全额退款)
//             / mock_tip(模拟打赏, 已履约完成订单 S5/S8/S9/S10, 发单人可多次打赏) / aa_record(W2 AA记账)
//             / balance_info(钱包汇总) / income_list(收益明细)
//             / withdraw(普通提现 T+1) / fast_withdraw(极速提现 T+0) / withdraw_list(提现记录)
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;  // 聚合操作符(balance_info 历史上漏定义导致 ReferenceError,已修复)
const col = (n) => db.collection(n);
const log = require('./logger');
const { writeAudit } = require('./audit');
// D4-5 防漂移抽取: 资金规则规范源 _shared/money_rules.js(修改后跑 sync-money-rules.ps1 同步)
const { isValidTipAmount, validateWithdrawBasic, validateWithdrawBalance, computeBalance, aggRowSum } = require('./money_rules');

// 场景中文名兜底映射(规范源 _shared/scene_meta.js, 修改后跑 sync-scene-meta.ps1)
const { SCENE_NAMES } = require('./scene_meta');

// 物理拆分(2026-10-14): 各 action 组 handler 与 index 同级; 共享符号经 ctx 注入, handler 禁 require('./index')
const HANDLERS = Object.assign({},
  require('./action_pay'),
  require('./action_tip'),
);

// 全局配置缓存(5 分钟 TTL, 与 im-conv/partner-action 同惯例; 后台改值 ≤5min 生效)
let _cfgCache = null;
let _cfgCacheUntil = 0;
async function getConfig() {
  const now = Date.now();
  if (_cfgCache !== null && now < _cfgCacheUntil) return _cfgCache;
  try {
    const r = await col('admin_config').doc('global').get();
    if (r.data) { _cfgCache = r.data; _cfgCacheUntil = now + 5 * 60 * 1000; return r.data; }
  } catch (e) {}
  return { s0_timeout_min: 30 };
}

function genPayNo(prefix) {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  // 8 字节密码学随机(16 hex), 防高并发碰撞(Math.random 6 位约 100 万分之一)
  const r = crypto.randomBytes(8).toString('hex');
  return `${prefix}${ymd}${r}`;
}

async function getOrder(orderId) {
  try {
    const r = await col('order_main').doc(orderId).get();
    return r.data || null;
  } catch (e) {
    return null;
  }
}

// 云数据库文档 ID 校验:自动生成的 _id 为 32 位十六进制(拦截订单号/流水号/占位符)
function isValidDocId(id) {
  return typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id);
}

// 写状态流水
async function logStatus(orderId, from, to, action, operator) {
  await col('order_status_log').add({ data: {
    order_id: orderId, from_status: from, to_status: to,
    action, operator,
    created_at: Date.now(), updated_at: Date.now(), is_deleted: false
  }});
}

// 写入自愈:集合不存在(-502005)时建集合并重试一次(withdraw_record 首次落库兜底)
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

// 提现串行锁(防 TOCTOU 双花): 每 openid 一把, _id=openid; TTL 30s 防异常死锁
const WD_LOCK_TTL_MS = 30000;
async function acquireWithdrawLock(openid) {
  const now = Date.now();
  const lockCol = col('withdraw_lock');
  // 快路径: 锁文档存在且当前未锁定(含 locked 字段缺省) → 抢锁
  try {
    const u = await lockCol.where({ _id: openid, locked: _.neq(true) }).update({
      data: { locked: true, locked_at: now, updated_at: now }
    });
    if (u.stats && u.stats.updated === 1) return true;
  } catch (e) {}
  // 30s 内的活跃锁 → 拒绝并发
  try {
    const active = await lockCol.where({ _id: openid, locked: true, locked_at: _.gt(now - WD_LOCK_TTL_MS) }).count();
    if (active.total > 0) return false;
  } catch (e) {}
  // 锁文档不存在(集合首次使用自愈) → 新增
  try {
    await addWithColl('withdraw_lock', { _id: openid, locked: true, locked_at: now, updated_at: now, is_deleted: false });
    return true;
  } catch (e) {
    // 并发新增落败或存在陈旧锁 → 仅当锁超过 TTL 时抢占
    try {
      const u2 = await lockCol.where({ _id: openid, locked: true, locked_at: _.lte(now - WD_LOCK_TTL_MS) }).update({
        data: { locked: true, locked_at: now, updated_at: now }
      });
      return !!(u2.stats && u2.stats.updated === 1);
    } catch (e2) { return false; }
  }
}
async function releaseWithdrawLock(openid) {
  try {
    await col('withdraw_lock').doc(openid).update({ data: { locked: false, updated_at: Date.now() } });
  } catch (e) {}
}

// 普通提现 T+1 惰性到账回写(mock): 到期(expect_arrive_at≤now)仍在途(processing)的记录置 success+arrived_at
// 纯 mock 闭环,无定时器基建; 在 balance_info/withdraw_list 入口触发,到账即从"处理中"归零并入已提现
async function settleDueWithdrawals(openid) {
  try {
    const due = await col('withdraw_record').where({
      openid, status: 'processing', expect_arrive_at: _.lte(Date.now()), is_deleted: false
    }).update({ data: { status: 'success', arrived_at: Date.now(), updated_at: Date.now() } });
    return !!(due.stats && due.stats.updated > 0);
  } catch (e) { return false; }
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const { resolveOpenid, warmEnv, getCachedEnv } = require('./openid');
  await warmEnv(cloud);
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'pay_no_openid', msg: '未获取到登录身份' };

  const clientIp = (wxCtx && wxCtx.CLIENTIP) || '';
  const device = String(event.device || '').slice(0, 200);

  const { action } = event;
  const env = getCachedEnv();
  log.d(`payment-mock action=${action} openid=${openid} env=${env}`);

  // ── prod 环境 mock 资金动作门控 ──
  // mock 资金入口(含打赏 mock_tip)默认仅 dev 放行;
  // 后台 mock_payment_enabled=true 时 prod 亦放行(测试期持续可用, 正式上线前必须置回 false, fail-closed 默认关)。
  // 身份校验不受影响(mock_openid prod 仍失效)。
  const MOCK_ONLY_ACTIONS = ['mock_pay', 'mock_refund', 'mock_tip', 'mock_ins', 'withdraw', 'fast_withdraw'];
  const envIsProd = env === 'prod';
  if (MOCK_ONLY_ACTIONS.indexOf(action) >= 0) {
    const cfg = await getConfig();
    const mockAllowed = !envIsProd || cfg.mock_payment_enabled === true;
    if (!mockAllowed) {
      log.d(`payment-mock BLOCKED action=${action} env=prod openid=${openid}`);
      await writeAudit(db, log, { openid, role: 'user', category: 'security', action: 'mock_pay_blocked', target_type: 'order', target_id: event.order_id || '', detail: { order_id: event.order_id || '', action }, result: 'fail', code: 'pay_mock_disabled', client_ip: clientIp, device });
      return { ok: false, code: 'pay_mock_disabled', msg: '模拟支付/提现功能已关闭,请联系管理员' };
    }
  }

  // 订单 _id 格式预检(避免 doc(非法ID) 抛错被吞成"订单不存在")
  if (['cashier_info', 'mock_pay', 'mock_refund', 'mock_tip', 'mock_ins', 'aa_record'].indexOf(action) >= 0 && !isValidDocId(event.order_id)) {
    return { ok: false, code: 'pay_bad_order_id', msg: '订单 ID 格式不正确:请传入订单 _id(32位十六进制),不是订单号(ORD 开头)或支付流水号(PAY 开头)' };
  }

  // 物理拆分分发: 命中 HANDLERS 的 action 走同级 handler(等价于原内联 case, 行为逐字不变)
  if (HANDLERS[action]) {
    const ctx = {
      event, openid, clientIp, device, action,
      cloud, crypto, db, col, _, $, log, writeAudit,
      isValidTipAmount, validateWithdrawBasic, validateWithdrawBalance, computeBalance, aggRowSum, SCENE_NAMES,
      getConfig, genPayNo, getOrder, isValidDocId, logStatus,
      addWithColl, acquireWithdrawLock, releaseWithdrawLock, settleDueWithdrawals
    };
    return await HANDLERS[action](ctx);
  }
  switch (action) {

    // ───────── 5. 耍伴钱包: 余额+收益汇总 ─────────
    case 'balance_info': {
      const partnerOpenid = openid;
      if (!partnerOpenid) return { ok: false, code: 'pay_no_openid', msg: '未获取到登录身份' };
      await settleDueWithdrawals(openid);  // T+1 到账回写(mock)
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const monthMs = monthStart.getTime();
      // 6 次独立查询合并为 1 批: 已结算收入/提现占用/在途/本月/完成数/信用等级, 冷启动压到 2s 内
      // 收入口径 = 服务收入 + 打赏(2026-10-05 打赏计入耍伴可结算收入, 与订单记录分列展示)
      const [settled, wR, splitting, monthList, countR, pp] = await Promise.all([
        col('order_main').aggregate().match({ partner_openid: partnerOpenid, status: _.in(['S8','S9','S10']), is_deleted: _.neq(true) }).group({ _id: null, total: $.sum('$partner_income_fen'), tip: $.sum('$tip_total_fen') }).end().catch(() => ({ list: [] })),
        col('withdraw_record').aggregate().match({ openid: partnerOpenid, is_deleted: false }).group({ _id: '$status', total: $.sum('$amount_fen') }).end().catch(() => ({ list: [] })),
        col('order_main').aggregate().match({ partner_openid: partnerOpenid, status: _.in(['S2','S3','S5','S6']), is_deleted: _.neq(true) }).group({ _id: null, total: $.sum('$partner_income_fen'), tip: $.sum('$tip_total_fen') }).end().catch(() => ({ list: [] })),
        col('order_main').aggregate().match({ partner_openid: partnerOpenid, status: _.in(['S8','S9','S10']), service_completed_at: _.gte(monthMs), is_deleted: _.neq(true) }).group({ _id: null, total: $.sum('$partner_income_fen'), tip: $.sum('$tip_total_fen') }).end().catch(() => ({ list: [] })),
        col('order_main').where({ partner_openid: partnerOpenid, status: _.in(['S8','S9','S10']), is_deleted: _.neq(true) }).count().catch(() => ({ total: 0 })),
        col('partner_profile').where({ openid: partnerOpenid }).limit(1).get().catch(() => ({ data: [] }))
      ]);
      // 余额口径统一走 _shared/money_rules.js computeBalance(与 withdraw 同源防漂移)
      const bal = computeBalance({ settledAgg: settled.list && settled.list[0], withdrawGroups: (wR && wR.list) || [] });
      const settledFen = bal.settledFen;
      const processingW = bal.processingFen;
      const withdrawableFen = bal.availableFen;
      const splittingFen = aggRowSum(splitting.list && splitting.list[0]);
      const monthIncomeFen = aggRowSum(monthList.list && monthList.list[0]);
      // 打赏累计(已结算口径, 与订单记录 tip_total_fen 一致) —— 2026-10-05 打赏进入可结算收入
      const settledTipFen = bal.tipFen;
      let creditLevel = 'L1';
      if (pp.data && pp.data[0]) {
        const score = pp.data[0].score || 0;
        // 对齐 PRD R005(与 enums.js CREDIT_LEVEL 一致): 百段制
        creditLevel = score >= 900 ? 'L4' : score >= 800 ? 'L3' : score >= 700 ? 'L2' : 'L1';
      }
      return {
        ok: true,
        data: {
          withdrawable_fen: withdrawableFen,
          splitting_fen: splittingFen,
          processing_fen: processingW,
          month_income_fen: monthIncomeFen,
          total_income_fen: settledFen,   // 累计收入 = 已结算总收入(2026-09-24 wallet 累计收入显示修复)
          tip_income_fen: settledTipFen,  // 其中打赏累计(订单记录与钱包对账用)
          total_completed: countR.total || 0,
          credit_level: creditLevel
        }
      };
    }

    // ───────── 6. 耍伴钱包: 收益明细列表(接单收入栏, 支持时间段条件查询) ─────────
    case 'income_list': {
      const partnerOpenid = openid;
      if (!partnerOpenid) return { ok: false, code: 'pay_no_openid', msg: '未获取到登录身份' };
      const limit = Math.min(event.limit || 20, 50);
      const skip = event.skip || 0;
      // 时间段条件: start_ts/end_ts(按服务完成时间 service_completed_at, 与 balance_info 本月口径一致)
      const q = { partner_openid: partnerOpenid, is_deleted: _.neq(true) };
      if (event.status_in) q.status = _.in(String(event.status_in).split(','));
      else if (event.status) q.status = event.status;
      if (event.start_ts) q.service_completed_at = _.gte(event.start_ts);
      if (event.end_ts) q.service_completed_at = _.lte(event.end_ts);
      // 汇总(当前筛选范围): 笔数 + 服务收入合计 + 打赏合计, 与明细同口径
      const summaryR = await col('order_main').aggregate().match(q)
        .group({ _id: null, count: $.sum(1), total: $.sum('$partner_income_fen'), tip: $.sum('$tip_total_fen') })
        .end().catch(() => ({ list: [] }));
      const sg = (summaryR.list && summaryR.list[0]) || {};
      const r = await col('order_main').where(q).orderBy('service_completed_at', 'desc').orderBy('created_at', 'desc').skip(skip).limit(limit).get();
      const list = (r.data || []).map((o) => ({
        order_id: o._id,
        order_no: o.order_no,
        scene: o.scene,
        status: o.status,
        partner_income_fen: o.partner_income_fen || 0,
        tip_total_fen: o.tip_total_fen || 0,
        fee_fen: o.fee_fen || 0,
        total_fen: o.total_fen || 0,
        service_completed_at: o.service_completed_at || null,
        created_at: o.created_at
      }));
      return {
        ok: true,
        data: {
          list,
          summary: { count: sg.count || 0, service_income_fen: sg.total || 0, tip_fen: sg.tip || 0 }
        }
      };
    }

    // ───────── 6b. 耍伴钱包: 打赏逐笔明细(打赏专栏, 按耍伴维度, 支持时间段条件查询) ─────────
    case 'tip_income_list': {
      const partnerOpenid = openid;
      if (!partnerOpenid) return { ok: false, code: 'pay_no_openid', msg: '未获取到登录身份' };
      const limit = Math.min(event.limit || 20, 50);
      const skip = event.skip || 0;
      const q = { type: 'tip', status: 'success', partner_openid: partnerOpenid, is_deleted: _.neq(true) };
      if (event.start_ts) q.created_at = _.gte(event.start_ts);
      if (event.end_ts) q.created_at = _.lte(event.end_ts);
      // 汇总(当前筛选范围): 笔数 + 金额合计
      const summaryR = await col('pay_transaction').aggregate().match(q)
        .group({ _id: null, count: $.sum(1), total: $.sum('$amount_fen') })
        .end().catch(() => ({ list: [] }));
      const sg = (summaryR.list && summaryR.list[0]) || {};
      const r = await col('pay_transaction').where(q).orderBy('created_at', 'desc').skip(skip).limit(limit).get();
      const list = (r.data || []).map((t) => ({
        pay_no: t.pay_no,
        order_no: t.order_no || '',
        scene: t.scene || '',
        amount_fen: t.amount_fen || 0,
        note: t.note || '',
        created_at: t.created_at
      }));
      return {
        ok: true,
        data: { list, summary: { count: sg.count || 0, sum_fen: sg.total || 0 } }
      };
    }

    // ───────── 6c. 一次性回填: 历史打赏流水补 partner_openid/scene(幂等, 可重复调用) ─────────
    case 'migrate_tip_partner': {
      const cursor = await col('pay_transaction').where({ type: 'tip', status: 'success', partner_openid: _.exists(false) }).limit(100).get().catch(() => ({ data: [] }));
      let fixed = 0;
      for (const t of (cursor.data || [])) {
        const o = await getOrder(t.order_id).catch(() => null);
        if (!o) continue;
        await col('pay_transaction').doc(t._id).update({ data: { partner_openid: o.partner_openid || '', scene: o.scene || '' } }).catch(() => {});
        fixed++;
      }
      return { ok: true, data: { fixed, remain: fixed } };
    }

    // ───────── 7. 提现申请(普通 T+1, mock 落 withdraw_record status=processing) ─────────
    // ───────── 8. 极速提现(T+0 即时到账; 单笔≤200元/当日累计≤2000元, 与小程序 config WITHDRAW 对齐) ─────────
    case 'withdraw':
    case 'fast_withdraw': {
      const isFast = action === 'fast_withdraw';
      const amount = Number(event.amount_fen);
      const wcfg = await getConfig();
      const fastPerOrder = parseInt(wcfg.fast_withdraw_per_order_max_fen, 10) || 20000;
      const fastPerDay = parseInt(wcfg.fast_withdraw_per_day_max_fen, 10) || 200000;
      // 基础校验(格式 / 最低 10 元 / 极速单笔上限) —— 规则收敛到 _shared/money_rules.js
      const preBad = validateWithdrawBasic(amount, { isFast, perOrderMaxFen: fastPerOrder });
      if (preBad) return { ok: false, code: preBad.code, msg: preBad.msg };

      // 串行锁: 余额校验→落库期间禁止同 openid 并发, 防双击/并发双花
      const locked = await acquireWithdrawLock(openid);
      if (!locked) {
        return { ok: false, code: 'wd_busy', msg: '上一笔提现正在处理,请勿重复操作' };
      }
      try {
      // 可提现余额 = 已结算收入(S8/S9/S10) - 提现占用(processing+success)
      // 极速提现当日限额查询也合并进同一批(非 fast 时仍执行一次轻量聚合, 无妨)
      // 极速提现当日限额按北京时间(UTC+8)日切分, 与订单/结算 cnDayStart 口径一致
      const CN_OFFSET_MS = 8 * 3600 * 1000;
      const DAY_MS = 24 * 3600 * 1000;
      const dayStart = Math.floor((Date.now() + CN_OFFSET_MS) / DAY_MS) * DAY_MS - CN_OFFSET_MS;
      const [settledR, wUsedR, dayR] = await Promise.all([
        col('order_main').aggregate().match({ partner_openid: openid, status: _.in(['S8', 'S9', 'S10']), is_deleted: _.neq(true) })
          .group({ _id: null, total: $.sum('$partner_income_fen'), tip: $.sum('$tip_total_fen') }).end().catch(() => ({ list: [] })),
        col('withdraw_record').aggregate().match({ openid, is_deleted: false })
          .group({ _id: '$status', total: $.sum('$amount_fen') }).end().catch(() => ({ list: [] })),
        col('withdraw_record').aggregate().match({ openid, type: 'fast', created_at: _.gte(dayStart), is_deleted: false })
          .group({ _id: null, total: $.sum('$amount_fen') }).end().catch(() => ({ list: [] }))
      ]);
      // 可提现口径与 balance_info 一致 —— 规则收敛到 _shared/money_rules.js computeBalance
      const bal = computeBalance({
        settledAgg: settledR.list && settledR.list[0],
        withdrawGroups: (wUsedR && wUsedR.list) || []
      });
      const available = bal.availableFen;
      // 余额充足 + 极速当日累计 —— validateWithdrawBalance
      const balBad = validateWithdrawBalance(amount, {
        isFast,
        perDayMaxFen: fastPerDay,
        todayFastFen: (dayR.list && dayR.list[0] && dayR.list[0].total) || 0,
        availableFen: available
      });
      if (balBad) return { ok: false, code: balBad.code, msg: balBad.msg };

      const now = Date.now();
      const wdNo = genPayNo('WD');
      // 普通 T+1 在途(无定时器回写,保持 processing); 极速 T+0 即时到账(mock)
      const record = {
        withdraw_no: wdNo,
        openid,
        type: isFast ? 'fast' : 'normal',
        amount_fen: amount,
        status: isFast ? 'success' : 'processing',
        is_mock: true,
        expect_arrive_at: isFast ? now : now + 24 * 3600 * 1000,
        arrived_at: isFast ? now : null,
        created_at: now, updated_at: now, is_deleted: false
      };
      try {
        await addWithColl('withdraw_record', record);
        log.d(`${action} success: openid=${openid} no=${wdNo} amount=${amount}`);
        await writeAudit(db, log, { openid, role: 'partner', category: 'business', action: isFast ? 'mock_fast_withdraw' : 'mock_withdraw', target_type: 'withdraw_record', target_id: wdNo, detail: { withdraw_no: wdNo, amount_fen: amount, type: record.type, status: record.status }, result: 'ok', client_ip: clientIp, device });
        return {
          ok: true,
          data: {
            withdraw_no: wdNo, amount_fen: amount, type: record.type, status: record.status,
            balance_after_fen: Math.max(0, available - amount), is_mock: true
          }
        };
      } catch (e) {
        log.d(`${action} fail: ${e.message}`);
        return { ok: false, code: 'wd_db_fail', msg: '提现失败,请稍后重试' };
      }
      } finally {
        await releaseWithdrawLock(openid);
      }
    }

    // ───────── 9. 提现记录列表 ─────────
    case 'withdraw_list': {
      await settleDueWithdrawals(openid);  // T+1 到账回写(mock)
      const limit = Math.min(event.limit || 20, 50);
      const skip = event.skip || 0;
      // 集合尚未创建时返回空列表(不报错)
      const r = await col('withdraw_record').where({ openid, is_deleted: false })
        .orderBy('created_at', 'desc').skip(skip).limit(limit).get()
        .catch(() => ({ data: [] }));
      const list = (r.data || []).map((w) => ({
        withdraw_no: w.withdraw_no,
        type: w.type,
        amount_fen: w.amount_fen,
        status: w.status,
        expect_arrive_at: w.expect_arrive_at || null,
        arrived_at: w.arrived_at || null,
        created_at: w.created_at
      }));
      return { ok: true, data: { list } };
    }

    default:
      return { ok: false, code: 'pay_unknown_action', msg: '未知动作' };
  }
};
