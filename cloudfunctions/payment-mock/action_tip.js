// action_tip.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // ───────── tip_list: 打赏逐笔明细(订单双方可见, 按时间升序) ─────────
async function tipListAction(ctx) {
  const { event, openid, clientIp, device, action, _, col, getOrder } = ctx;
      const { order_id } = event;
      if (!order_id) return { ok: false, code: 'tip_no_order', msg: '缺少订单 ID' };
      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'tip_not_found', msg: '订单不存在' };
      // 权限: 仅订单双方(发单人/耍伴)可查看打赏明细
      if (order.user_openid !== openid && order.partner_openid !== openid) {
        return { ok: false, code: 'tip_forbidden', msg: '无权查看该订单打赏明细' };
      }
      const r = await col('pay_transaction').where({
        order_id, type: 'tip', status: 'success', is_deleted: _.neq(true)
      }).orderBy('created_at', 'asc').limit(100).get();
      const list = (r.data || []).map((t) => ({
        pay_no: t.pay_no,
        amount_fen: t.amount_fen || 0,
        note: t.note || '',
        created_at: t.created_at
      }));
      return { ok: true, data: { list, tip_total_fen: order.tip_total_fen || 0 } };
}

    // ───────── mock_ins: 模拟购买保险(保险费由平台承担, 用户零成本) ─────────
async function mockInsAction(ctx) {
  const { event, openid, clientIp, device, action, db, $, col, log, writeAudit, getConfig, getOrder } = ctx;
      const { order_id } = event;
      if (!order_id) return { ok: false, code: 'ins_no_order', msg: '缺少订单 ID' };
      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'ins_not_found', msg: '订单不存在' };
      // 属主校验(对齐 mock_pay/mock_refund): 仅下单人可为自己的订单购买保险
      if (order.user_openid !== openid) return { ok: false, code: 'ins_forbidden', msg: '仅下单人可操作' };
      // 状态白名单: 仅活跃订单可购险(防为已取消/已完结订单补造保单), 与接单 BUSY_STATUS 对齐
      if (['S0', 'S1', 'S2', 'S3', 'S3.5'].indexOf(order.status) < 0) {
        return { ok: false, code: 'ins_status', msg: `订单当前状态(${order.status})不可购买保险` };
      }
      // 幂等: 已买过直接返回
      const exist = await col('insurance_record').where({ order_id }).limit(1).get().catch(() => ({ data: [] }));
      if (exist.data && exist.data.length > 0) {
        const p = exist.data[0];
        await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_insurance', target_type: 'insurance_record', target_id: order_id, detail: { order_id, policy_no: p.policy_no, status: p.status, idempotent: true }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { policy_no: p.policy_no, status: p.status, is_mock: true, idempotent: true } };
      }
      // 生成保单号 INS + 时间戳 + 6 位随机
      const ts = Date.now();
      const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      const policyNo = `INS${ts}${rand}`;
      const now = ts;
      const pcfg = await getConfig();
      const accidentFen = parseInt(pcfg.insurance_coverage_accident_fen, 10) || 50000000;
      const propertyFen = parseInt(pcfg.insurance_coverage_property_fen, 10) || 5000000;
      try {
        await col('insurance_record').add({
          data: {
            order_id, policy_no: policyNo, status: 'active',
            openid, scene_code: order.scene || '',
            coverage_accident_fen: accidentFen,
            coverage_property_fen: propertyFen,
            premium_fen: 0,                    // 平台承担保费
            is_mock: true,
            created_at: now, updated_at: now, is_deleted: false
          }
        });
        await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_insurance', target_type: 'insurance_record', target_id: order_id, detail: { order_id, policy_no: policyNo, status: 'active', premium_fen: 0 }, result: 'ok', client_ip: clientIp, device });
        return { ok: true, data: { policy_no: policyNo, status: 'active', is_mock: true } };
      } catch (e) {
        log.d(`mock_ins fail: ${e.message}`);
        return { ok: false, code: 'ins_db_fail', msg: '保险购买失败, 请稍后重试' };
      }
}

    // W2 AA制 SSOT 账本:记录线下 AA 消费(凭证+金额+付款方),平台仅记账不代收
async function aaRecordAction(ctx) {
  const { event, openid, clientIp, device, action, db, _, $, log, getConfig, genPayNo, getOrder } = ctx;
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

      // 防滥用上限(后台 admin_config 可调, 超限拒绝; 台账仅记账, 上限目的防刷)
      const acfg = await getConfig();
      const recMax = Number(acfg.aa_record_max_fen) || 100000;
      const totalMax = Number(acfg.aa_ledger_max_fen) || 300000;
      const recCountMax = Number(acfg.aa_ledger_max_records) || 50;
      if (amount > recMax) {
        return { ok: false, code: 'aa_over_record_limit', msg: `单笔 AA 记账上限 ¥${(recMax / 100).toFixed(0)} 元` };
      }

      const now = Date.now();
      const record = {
        record_id: genPayNo('AA'),  // 日期+6位随机, 避免同毫秒并发 AA 记录 ID 碰撞
        amount_fen: amount,
        note: String(note || '').slice(0, 200),
        evidence_url: evidence_url || '',
        paid_by: role,
        paid_openid: openid,
        created_at: now
      };
      // 事务: 上限复核(事务内读最新账本快照)+原子追加(SSOT), 防并发记账冲破条数/累计上限
      try {
        await db.runTransaction(async (t) => {
          const cur = await t.collection('order_main').doc(order_id).get();
          const curLedger = (cur.data && cur.data.aa_ledger) || {};
          const rows = (curLedger.records && curLedger.records.length) || 0;
          const total = Number(curLedger.total_fen) || 0;
          if ((rows + 1) > recCountMax) {
            const err = new Error('aa_over_records_limit'); err.__code = 'aa_over_records_limit'; throw err;
          }
          if ((total + amount) > totalMax) {
            const err = new Error('aa_over_ledger_limit'); err.__code = 'aa_over_ledger_limit'; throw err;
          }
          await t.collection('order_main').doc(order_id).update({
            data: {
              'aa_ledger.records': _.push([record]),
              'aa_ledger.total_fen': _.inc(amount),
              updated_at: now
            }
          });
        });
      } catch (e) {
        if (e && e.__code === 'aa_over_records_limit') {
          return { ok: false, code: 'aa_over_records_limit', msg: `该订单 AA 记账已达 ${recCountMax} 条上限` };
        }
        if (e && e.__code === 'aa_over_ledger_limit') {
          return { ok: false, code: 'aa_over_ledger_limit', msg: `该订单 AA 累计记账已达上限 ¥${(totalMax / 100).toFixed(0)} 元` };
        }
        log.d(`aa_record txn fail: ${e.message}`);
        return { ok: false, code: 'aa_db_fail', msg: 'AA记账失败,请稍后重试' };
      }
      log.d(`aa_record: ${order.order_no} amount=${amount} by=${role}`);
      return { ok: true, data: { order_id, record_id: record.record_id, amount_fen: amount, paid_by: role } };
}

module.exports = {
  tip_list: tipListAction,
  mock_ins: mockInsAction,
  aa_record: aaRecordAction,
};
