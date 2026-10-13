// action_withdraw.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // ───────── 7. 提现申请(普通 T+1, mock 落 withdraw_record status=processing) ─────────
    // ───────── 8. 极速提现(T+0 即时到账; 单笔≤200元/当日累计≤2000元, 与小程序 config WITHDRAW 对齐) ─────────
async function withdrawAction(ctx) {
  const { event, openid, clientIp, device, action, db, _, $, col, log, writeAudit, validateWithdrawBasic, validateWithdrawBalance, computeBalance, getConfig, genPayNo, addWithColl, acquireWithdrawLock, releaseWithdrawLock } = ctx;
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
async function withdrawListAction(ctx) {
  const { event, openid, clientIp, device, action, col, settleDueWithdrawals } = ctx;
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

module.exports = {
  withdraw: withdrawAction,      // 与 fast_withdraw 共享同一落穿 case 体(isFast 由 ctx.action 区分)
  fast_withdraw: withdrawAction,
  withdraw_list: withdrawListAction,
};
