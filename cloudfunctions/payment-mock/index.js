// 对应 PRD 章节：3.5.1 资金担保与分账架构 / 8.4 退款规则 / 3.4 AA费用 / 附录G 状态机
// payment-mock 模拟支付与退款(MVP 无真实微信支付,一律 is_mock=true)
// 9 个 action: cashier_info(收银台摘要) / mock_pay(模拟支付) / mock_refund(模拟全额退款)
//             / mock_tip(模拟打赏, 已履约完成订单 S5/S8/S9/S10, 发单人可多次打赏) / aa_record(W2 AA记账)
//             / balance_info(钱包汇总) / income_list(收益明细)
//             / withdraw(普通提现 T+1) / fast_withdraw(极速提现 T+0) / withdraw_list(提现记录)
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;  // 聚合操作符(balance_info 历史上漏定义导致 ReferenceError,已修复)
const col = (n) => db.collection(n);

const SCENE_NAMES = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };

async function getConfig() {
  try {
    const r = await col('admin_config').where({ _id: 'global' }).limit(1).get();
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { s0_timeout_min: 30 };
}

function genPayNo(prefix) {
  const d = new Date();
  const pad = (n) => n < 10 ? '0' + n : '' + n;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const r = Math.floor(100000 + Math.random() * 900000);
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

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
    const { resolveOpenid } = require('../_shared/openid');
  const openid = await resolveOpenid(cloud, event);
  if (!openid) return { ok: false, code: 'pay_no_openid', msg: '未获取到登录身份' };

  const { action } = event;
  console.log(`payment-mock action=${action} openid=${openid}`);

  // 订单 _id 格式预检(避免 doc(非法ID) 抛错被吞成"订单不存在")
  if (['cashier_info', 'mock_pay', 'mock_refund', 'mock_tip', 'aa_record'].indexOf(action) >= 0 && !isValidDocId(event.order_id)) {
    return { ok: false, code: 'pay_bad_order_id', msg: '订单 ID 格式不正确:请传入订单 _id(32位十六进制),不是订单号(ORD 开头)或支付流水号(PAY 开头)' };
  }

  switch (action) {

    // 1. 收银台摘要(仅订单 user 可看)
    case 'cashier_info': {
      const { order_id } = event;
      if (!order_id) return { ok: false, code: 'cashier_no_order', msg: '缺少订单 ID' };
      // getOrder + getConfig 并行
      const [order, config] = await Promise.all([
        getOrder(order_id),
        getConfig()
      ]);
      if (!order) return { ok: false, code: 'cashier_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'cashier_not_owner', msg: '只能查看自己的订单' };
      }
      const sceneList = config.scene_list || [];
      const sceneConf = sceneList.find(s => s.code === order.scene) || {};
      // 0-50 元档免 AA 承诺书(兼容新旧档位取值:'0-50' / '0-50元')
      const needAaPromise = !!order.aa_tier && ['0-50', '0-50元'].indexOf(order.aa_tier) < 0;

      return {
        ok: true,
        data: {
          order_id: order._id,
          order_no: order.order_no,
          scene_code: order.scene,
          scene_name: sceneConf.name || SCENE_NAMES[order.scene] || order.scene,
          content_options: order.content_options || [],
          start_time: order.start_time,
          duration_h: order.duration_h,
          location: order.location,
          total_fen: order.total_fen,
          fee_fen: order.fee_fen,
          aa_tier: order.aa_tier || '',
          need_aa_promise: needAaPromise,
          status: order.status,
          pay_expire_at: order.pay_expire_at,
          is_mock: true
        }
      };
    }

    // 2. 模拟支付
    case 'mock_pay': {
      const { order_id, aa_promise_checked } = event;
      if (!order_id) return { ok: false, code: 'pay_no_order', msg: '缺少订单 ID' };

      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'pay_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'pay_not_owner', msg: '只能支付自己的订单' };
      }

      // 幂等:已有 success 支付流水直接返回成功(不重复执行)
      try {
        const exist = await col('pay_transaction').where({
          order_id, type: 'pay', status: 'success', is_deleted: false
        }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          console.log(`mock_pay idempotent hit: ${order.order_no}`);
          return { ok: true, data: { order_id, order_no: order.order_no, status: order.status, idempotent: true } };
        }
      } catch (e) {}

      if (order.status !== 'S0') {
        return { ok: false, code: 'pay_status', msg: `订单当前状态(${order.status})不可支付` };
      }
      if (order.pay_expire_at && order.pay_expire_at < Date.now()) {
        return { ok: false, code: 'pay_expired', msg: '支付超时,请重新下单' };
      }
      // AA 承诺书:非 0-50 元档位必须勾选(兼容新旧档位取值)
      if (order.aa_tier && ['0-50', '0-50元'].indexOf(order.aa_tier) < 0 && !aa_promise_checked) {
        return { ok: false, code: 'pay_aa_promise', msg: '请先阅读并同意《线下费用自理承诺书》' };
      }

      const now = Date.now();
      const payNo = genPayNo('PAY');

      // ① CAS 抢占: S0→S2, 并发双发/超时取消只有一方成功(资金红线)
      let casRes;
      try {
        casRes = await col('order_main').where({ _id: order_id, status: 'S0' }).update({
          data: { status: 'S2', updated_at: now }
        });
      } catch (e) {
        console.log(`mock_pay cas fail: ${e.message}`);
        return { ok: false, code: 'pay_db_fail', msg: '支付失败,请稍后重试' };
      }
      if (!casRes.stats || casRes.stats.updated !== 1) {
        // 未抢到: 查成功流水判幂等, 否则按最新状态给原因
        const dup = await col('pay_transaction').where({
          order_id, type: 'pay', status: 'success', is_deleted: false
        }).limit(1).get().catch(() => ({ data: [] }));
        if (dup.data && dup.data[0]) {
          const latest = await getOrder(order_id);
          console.log(`mock_pay idempotent after cas miss: ${order.order_no}`);
          return { ok: true, data: { order_id, order_no: order.order_no, status: latest ? latest.status : 'S2', idempotent: true } };
        }
        const latest = await getOrder(order_id);
        if (latest && latest.status === 'S6') {
          return { ok: false, code: 'pay_closed', msg: '订单已取消,无法支付' };
        }
        return { ok: false, code: 'pay_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      }

      // ② 事务: 支付流水 + 状态流水同成同败; 失败补偿订单回 S0
      try {
        await db.runTransaction(async (t) => {
          await t.collection('pay_transaction').add({ data: {
            pay_no: payNo,
            order_id,
            order_no: order.order_no,
            type: 'pay',
            amount_fen: order.total_fen,
            fee_fen: order.fee_fen,
            channel: 'mock',
            is_mock: true,
            status: 'success',
            paid_at: now,
            created_at: now, updated_at: now, is_deleted: false
          }});
          await t.collection('order_status_log').add({ data: {
            order_id, from_status: 'S0', to_status: 'S2',
            action: 'mock_pay', operator: openid,
            created_at: now, updated_at: now, is_deleted: false
          }});
        });
      } catch (e) {
        console.log(`mock_pay txn fail: ${e.message}; compensating order ${order_id} → S0`);
        await col('order_main').where({ _id: order_id, status: 'S2' }).update({
          data: { status: 'S0', updated_at: Date.now() }
        }).catch(() => {});
        return { ok: false, code: 'pay_db_fail', msg: '支付失败,请稍后重试' };
      }

      console.log(`mock_pay success: ${order.order_no} pay_no=${payNo}`);
      return {
        ok: true,
        data: { order_id, order_no: order.order_no, pay_no: payNo, status: 'S2', is_mock: true }
      };
    }

    // 3. 模拟全额退款(本期自动全额退款;demand 保持 matched)
    case 'mock_refund': {
      const { order_id } = event;
      if (!order_id) return { ok: false, code: 'refund_no_order', msg: '缺少订单 ID' };

      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'refund_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'refund_not_owner', msg: '只能对自己的订单申请退款' };
      }
      if (['S2', 'S3'].indexOf(order.status) < 0) {
        return { ok: false, code: 'refund_status', msg: `订单当前状态(${order.status})不可退款` };
      }

      // 幂等:已有退款流水直接返回(返回订单真实状态, 不硬编码)
      try {
        const exist = await col('pay_transaction').where({
          order_id, type: 'refund', status: 'success', is_deleted: false
        }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          const latest = await getOrder(order_id);
          console.log(`mock_refund idempotent hit: ${order.order_no}`);
          return { ok: true, data: { order_id, order_no: order.order_no, status: latest ? latest.status : 'S7', idempotent: true } };
        }
      } catch (e) {}

      const now = Date.now();
      const refundNo = genPayNo('REF');
      const fromStatus = order.status;   // S2 或 S3(已通过上面的状态校验)

      // ① CAS 抢占: S2/S3→S7, 并发双退只有一方成功
      let casRes;
      try {
        casRes = await col('order_main').where({
          _id: order_id, status: _.in(['S2', 'S3'])
        }).update({ data: { status: 'S7', refunded_at: now, updated_at: now } });
      } catch (e) {
        console.log(`mock_refund cas fail: ${e.message}`);
        return { ok: false, code: 'refund_db_fail', msg: '退款失败,请联系管理员' };
      }
      if (!casRes.stats || casRes.stats.updated !== 1) {
        const dup = await col('pay_transaction').where({
          order_id, type: 'refund', status: 'success', is_deleted: false
        }).limit(1).get().catch(() => ({ data: [] }));
        if (dup.data && dup.data[0]) {
          const latest = await getOrder(order_id);
          return { ok: true, data: { order_id, order_no: order.order_no, status: latest ? latest.status : 'S7', idempotent: true } };
        }
        return { ok: false, code: 'refund_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      }

      // ② 事务: 退款流水 + 状态流水; 失败补偿订单回原状态
      try {
        await db.runTransaction(async (t) => {
          await t.collection('pay_transaction').add({ data: {
            pay_no: refundNo,
            order_id,
            order_no: order.order_no,
            type: 'refund',
            amount_fen: order.total_fen,
            channel: 'mock',
            is_mock: true,
            status: 'success',
            paid_at: now,
            created_at: now, updated_at: now, is_deleted: false
          }});
          await t.collection('order_status_log').add({ data: {
            order_id, from_status: fromStatus, to_status: 'S7',
            action: 'mock_refund', operator: openid,
            created_at: now, updated_at: now, is_deleted: false
          }});
        });
      } catch (e) {
        console.log(`mock_refund txn fail: ${e.message}; compensating order ${order_id} → ${fromStatus}`);
        await col('order_main').where({ _id: order_id, status: 'S7' }).update({
          data: { status: fromStatus, updated_at: Date.now() }
        }).catch(() => {});
        return { ok: false, code: 'refund_db_fail', msg: '退款失败,请联系管理员' };
      }

      console.log(`mock_refund success: ${order.order_no} refund_no=${refundNo}`);
      return {
        ok: true,
        data: { order_id, order_no: order.order_no, refund_no: refundNo, status: 'S7', is_mock: true }
      };
    }

    // 4. 模拟打赏(已履约完成订单; 发单人主动给耍伴, 可多次; is_mock=true, 不改变订单状态)
    case 'mock_tip': {
      const { order_id, amount_fen } = event;
      if (!order_id) return { ok: false, code: 'tip_no_order', msg: '缺少订单 ID' };

      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'tip_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'tip_not_owner', msg: '只能给自己的订单打赏' };
      }
      // 已履约完成: S5已完成 / S8已评价 / S9评价超时 / S10已关闭
      if (['S5', 'S8', 'S9', 'S10'].indexOf(order.status) < 0) {
        return { ok: false, code: 'tip_status', msg: `订单当前状态(${order.status})暂不能打赏,服务完成后可打赏` };
      }
      const amount = Number(amount_fen);
      if (!Number.isInteger(amount) || amount < 100 || amount > 50000) {
        return { ok: false, code: 'tip_amount', msg: '打赏金额需为 1-500 元之间的整数' };
      }

      const now = Date.now();
      const tipNo = genPayNo('TIP');
      try {
        // 打赏流水(is_mock=true)
        await col('pay_transaction').add({ data: {
          pay_no: tipNo,
          order_id,
          order_no: order.order_no,
          type: 'tip',
          amount_fen: amount,
          channel: 'mock',
          is_mock: true,
          status: 'success',
          paid_at: now,
          created_at: now, updated_at: now, is_deleted: false
        }});

        // 累计打赏总额: 原子 inc, 避免并发打赏读改写丢更新
        await col('order_main').doc(order_id).update({ data: {
          tip_total_fen: _.inc(amount), updated_at: now
        }});
        const after = await getOrder(order_id);
        const tipTotal = after ? (after.tip_total_fen || 0) : amount;

        console.log(`mock_tip success: ${order.order_no} tip_no=${tipNo} amount=${amount}`);
        return {
          ok: true,
          data: { order_id, order_no: order.order_no, tip_no: tipNo, amount_fen: amount, tip_total_fen: tipTotal, is_mock: true }
        };
      } catch (e) {
        console.log(`mock_tip fail: ${e.message}`);
        return { ok: false, code: 'tip_db_fail', msg: '打赏失败,请稍后重试' };
      }
    }

    // W2 AA制 SSOT 账本:记录线下 AA 消费(凭证+金额+付款方),平台仅记账不代收
    case 'aa_record': {
      const { order_id, amount_fen, note, evidence_url } = event;
      if (!order_id) return { ok: false, code: 'aa_no_order', msg: '缺少订单 ID' };
      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'aa_not_found', msg: '订单不存在' };
      // 仅 W2 学习陪伴场景启用 AA 制
      if (order.scene !== 'W2') {
        return { ok: false, code: 'aa_scene_not_supported', msg: '仅学习陪伴(W2)场景支持AA记账' };
      }
      if (!order.aa_promise_signed) {
        return { ok: false, code: 'aa_no_promise', msg: '该订单未签署AA费用自理承诺' };
      }
      const amount = Number(amount_fen);
      if (!Number.isInteger(amount) || amount <= 0) {
        return { ok: false, code: 'aa_amount', msg: 'AA金额需为正整数(分)' };
      }
      const role = order.user_openid === openid ? 'user' : (order.partner_openid === openid ? 'partner' : null);
      if (!role) return { ok: false, code: 'aa_not_participant', msg: '你不是该订单参与方' };

      const now = Date.now();
      const record = {
        record_id: 'AA' + now,
        amount_fen: amount,
        note: String(note || '').slice(0, 200),
        evidence_url: evidence_url || '',
        paid_by: role,
        paid_openid: openid,
        created_at: now
      };
      // 累加到 order_main.aa_ledger(SSOT 单一账本)
      await col('order_main').doc(order_id).update({
        data: {
          'aa_ledger.records': _.push([record]),
          'aa_ledger.total_fen': _.inc(amount),
          updated_at: now
        }
      });
      console.log(`aa_record: ${order.order_no} amount=${amount} by=${role}`);
      return { ok: true, data: { order_id, record_id: record.record_id, amount_fen: amount, paid_by: role } };
    }

    // ───────── 5. 耍伴钱包: 余额+收益汇总 ─────────
    case 'balance_info': {
      const partnerOpenid = openid;
      if (!partnerOpenid) return { ok: false, code: 'pay_no_openid', msg: '未获取到登录身份' };
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const monthMs = monthStart.getTime();
      // 6 次独立查询合并为 1 批: 已结算收入/提现占用/在途/本月/完成数/信用等级, 冷启动压到 2s 内
      const [settled, wR, splitting, monthList, countR, pp] = await Promise.all([
        col('order_main').aggregate().match({ partner_openid: partnerOpenid, status: _.in(['S8','S9','S10']) }).group({ _id: null, total: $.sum('$partner_income_fen') }).end().catch(() => ({ list: [] })),
        col('withdraw_record').aggregate().match({ openid: partnerOpenid, is_deleted: false }).group({ _id: '$status', total: $.sum('$amount_fen') }).end().catch(() => ({ list: [] })),
        col('order_main').aggregate().match({ partner_openid: partnerOpenid, status: _.in(['S2','S3','S5','S6']) }).group({ _id: null, total: $.sum('$partner_income_fen') }).end().catch(() => ({ list: [] })),
        col('order_main').aggregate().match({ partner_openid: partnerOpenid, status: _.in(['S8','S9','S10']), service_completed_at: _.gte(monthMs) }).group({ _id: null, total: $.sum('$partner_income_fen') }).end().catch(() => ({ list: [] })),
        col('order_main').where({ partner_openid: partnerOpenid, status: _.in(['S8','S9','S10']) }).count().catch(() => ({ total: 0 })),
        col('partner_profile').where({ openid: partnerOpenid }).limit(1).get().catch(() => ({ data: [] }))
      ]);
      const settledFen = (settled.list && settled.list[0] && settled.list[0].total) || 0;
      let processingW = 0, withdrawnW = 0;
      ((wR && wR.list) || []).forEach((g) => {
        if (g._id === 'processing') processingW = g.total || 0;
        else if (g._id === 'success') withdrawnW = g.total || 0;
      });
      const withdrawableFen = Math.max(0, settledFen - processingW - withdrawnW);
      const splittingFen = (splitting.list && splitting.list[0] && splitting.list[0].total) || 0;
      const monthIncomeFen = (monthList.list && monthList.list[0] && monthList.list[0].total) || 0;
      let creditLevel = 'L1';
      if (pp.data && pp.data[0]) {
        const score = pp.data[0].score || 0;
        creditLevel = score >= 800 ? 'L3' : score >= 600 ? 'L2' : 'L1';
      }
      return {
        ok: true,
        data: {
          withdrawable_fen: withdrawableFen,
          splitting_fen: splittingFen,
          processing_fen: processingW,
          month_income_fen: monthIncomeFen,
          total_completed: countR.total || 0,
          credit_level: creditLevel
        }
      };
    }

    // ───────── 6. 耍伴钱包: 收益明细列表 ─────────
    case 'income_list': {
      const partnerOpenid = openid;
      if (!partnerOpenid) return { ok: false, code: 'pay_no_openid', msg: '未获取到登录身份' };
      const limit = Math.min(event.limit || 20, 50);
      const skip = event.skip || 0;
      const q = { partner_openid: partnerOpenid, is_deleted: _.neq(true) };
      if (event.status) q.status = event.status;
      const r = await col('order_main').where(q).orderBy('created_at', 'desc').skip(skip).limit(limit).get();
      const list = (r.data || []).map((o) => ({
        order_id: o._id,
        order_no: o.order_no,
        scene: o.scene,
        status: o.status,
        partner_income_fen: o.partner_income_fen || 0,
        fee_fen: o.fee_fen || 0,
        total_fen: o.total_fen || 0,
        service_completed_at: o.service_completed_at || null,
        created_at: o.created_at
      }));
      return { ok: true, data: { list } };
    }

    // ───────── 7. 提现申请(普通 T+1, mock 落 withdraw_record status=processing) ─────────
    // ───────── 8. 极速提现(T+0 即时到账; 单笔≤200元/当日累计≤2000元, 与小程序 config WITHDRAW 对齐) ─────────
    case 'withdraw':
    case 'fast_withdraw': {
      const isFast = action === 'fast_withdraw';
      const amount = Number(event.amount_fen);
      if (!Number.isInteger(amount) || amount <= 0) {
        return { ok: false, code: 'wd_amount', msg: '提现金额格式有误' };
      }
      // 单次最低 10 元(config/index.js WITHDRAW.minAmount=10)
      if (amount < 1000) {
        return { ok: false, code: 'wd_too_small', msg: '单次最低提现 10 元' };
      }
      // 极速提现单笔上限 200 元(WITHDRAW.fastPerOrderMax=200)
      if (isFast && amount > 20000) {
        return { ok: false, code: 'wd_fast_cap', msg: '极速提现单笔上限 200 元' };
      }

      // 串行锁: 余额校验→落库期间禁止同 openid 并发, 防双击/并发双花
      const locked = await acquireWithdrawLock(openid);
      if (!locked) {
        return { ok: false, code: 'wd_busy', msg: '上一笔提现正在处理,请勿重复操作' };
      }
      try {
      // 可提现余额 = 已结算收入(S8/S9/S10) - 提现占用(processing+success)
      // 极速提现当日限额查询也合并进同一批(非 fast 时仍执行一次轻量聚合, 无妨)
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const [settledR, wUsedR, dayR] = await Promise.all([
        col('order_main').aggregate().match({ partner_openid: openid, status: _.in(['S8', 'S9', 'S10']) })
          .group({ _id: null, total: $.sum('$partner_income_fen') }).end().catch(() => ({ list: [] })),
        col('withdraw_record').aggregate().match({ openid, is_deleted: false })
          .group({ _id: '$status', total: $.sum('$amount_fen') }).end().catch(() => ({ list: [] })),
        col('withdraw_record').aggregate().match({ openid, type: 'fast', created_at: _.gte(dayStart.getTime()), is_deleted: false })
          .group({ _id: null, total: $.sum('$amount_fen') }).end().catch(() => ({ list: [] }))
      ]);
      const settledFen = (settledR.list && settledR.list[0] && settledR.list[0].total) || 0;
      let usedFen = 0;
      ((wUsedR && wUsedR.list) || []).forEach((g) => {
        if (g._id === 'processing' || g._id === 'success') usedFen += g.total || 0;
      });
      const available = Math.max(0, settledFen - usedFen);
      if (amount > available) {
        return { ok: false, code: 'wd_insufficient', msg: '可提现余额不足' };
      }

      // 极速提现当日累计上限 2000 元(WITHDRAW.fastPerDayMax=2000)
      if (isFast) {
        const todayFast = (dayR.list && dayR.list[0] && dayR.list[0].total) || 0;
        if (todayFast + amount > 200000) {
          return { ok: false, code: 'wd_fast_daily', msg: '极速提现当日累计上限 2000 元' };
        }
      }

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
        console.log(`${action} success: openid=${openid} no=${wdNo} amount=${amount}`);
        return {
          ok: true,
          data: {
            withdraw_no: wdNo, amount_fen: amount, type: record.type, status: record.status,
            balance_after_fen: Math.max(0, available - amount), is_mock: true
          }
        };
      } catch (e) {
        console.log(`${action} fail: ${e.message}`);
        return { ok: false, code: 'wd_db_fail', msg: '提现失败,请稍后重试' };
      }
      } finally {
        await releaseWithdrawLock(openid);
      }
    }

    // ───────── 9. 提现记录列表 ─────────
    case 'withdraw_list': {
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
