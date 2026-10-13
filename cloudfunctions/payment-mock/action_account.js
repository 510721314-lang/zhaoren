// action_account.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // ───────── 5. 耍伴钱包: 余额+收益汇总 ─────────
async function balanceInfoAction(ctx) {
  const { event, openid, clientIp, device, action, _, $, col, computeBalance, aggRowSum, settleDueWithdrawals } = ctx;
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
async function incomeListAction(ctx) {
  const { event, openid, clientIp, device, action, _, $, col } = ctx;
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
async function tipIncomeListAction(ctx) {
  const { event, openid, clientIp, device, action, _, $, col } = ctx;
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
async function migrateTipPartnerAction(ctx) {
  const { event, openid, clientIp, device, action, _, col, getOrder } = ctx;
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

module.exports = {
  balance_info: balanceInfoAction,
  income_list: incomeListAction,
  tip_income_list: tipIncomeListAction,
  migrate_tip_partner: migrateTipPartnerAction,
};
