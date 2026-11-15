// 选单模式: 发布者确认后超时未建单 → 释放回「可重新选择」(2026-11-15 选单立项)
// 背景: demand-match.confirm_apply 只置 matched_openid(需求 status 仍 matching), 需被选中者再走
//   order-create.action_take 建单; 若对方一直不接单, 需求会永久停在「已确认未建单」, 只能人工救。
// 规范: 无订单可依赖 S1/S0 超时, 故在需求层补扫: matched_openid≠null 且 matched_confirm_at 早于阈值。
// 阈值: admin_config.global.select_confirm_timeout_min(缺省 15 分钟, 与 S1 对齐); 新增键需 admin-action 白名单放行。
module.exports = {
  async processSelectStale(ctx) {
    const { out, cfg, num, col, _, log, scanAll } = ctx;
    const limitMin = num(cfg.select_confirm_timeout_min, 15);
    const deadline = Date.now() - limitMin * 60 * 1000;

    const rows = await scanAll('demand', () => ({
      status: 'matching',
      match_mode: 'select',
      matched_openid: _.neq(null),
      matched_confirm_at: _.lt(deadline),
      is_deleted: false
    }), 100);

    for (const d of rows) {
      // CAS 释放: 条件带原 matched_openid + matched_confirm_at, 防与「接单人刚好建单成功」并发冲突
      const r = await col('demand').where({
        _id: d._id,
        status: 'matching',
        matched_openid: d.matched_openid,
        matched_confirm_at: d.matched_confirm_at
      }).update({ data: { matched_openid: null, matched_confirm_at: 0, updated_at: Date.now() } });
      if (!r.stats || r.stats.updated !== 1) continue;

      if (!out.select_stale) out.select_stale = [];
      out.select_stale.push(d._id);
      log.d(`[select_stale] 释放需求 ${d._id}: 确认后 ${limitMin} 分钟未接单`);

      // 通知发布者重新选择(失败不阻断主流程)
      try {
        await col('system_notice').add({ data: {
          to_openid: d.creator_openid,
          order_id: '',
          type: 'select_expired',
          title: '耍伴未接单',
          body: '被选中的耍伴超时未接单，请重新选择',
          action_key: 'jump_demand',
          action_payload: { demand_id: d._id },
          created_at: Date.now(),
          read: false
        }});
      } catch (e) { log.d('[select_stale] 通知发布者失败: ' + (e && e.message || e)); }

      // 通知原被选中者邀请已失效(失败不阻断)
      try {
        await col('system_notice').add({ data: {
          to_openid: d.matched_openid,
          order_id: '',
          type: 'select_released',
          title: '接单邀请已失效',
          body: '你未在规定时间内接单，该需求已重新开放选择',
          action_key: 'jump_demand',
          action_payload: { demand_id: d._id },
          created_at: Date.now(),
          read: false
        }});
      } catch (e) { log.d('[select_stale] 通知被选中者失败: ' + (e && e.message || e)); }
    }
  }
};
