// action_lifecycle.js — 从 index.js 物理抽出(cancel / lazy_expire), 行为逐字不变
// 共享符号经 ctx 注入; 禁反向 require 入口文件防循环依赖(约束见 .trae/skills/cloud-function-split)

// 取消需求(仅创建者, 仅 matching 状态) — 原 case 'cancel'
async function cancel_action(ctx) {
  const { event, openid, col, log, writeAudit, db, clientIp, device, isValidDocId, lazyExpire } = ctx;
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
    await writeAudit(db, log, {
      openid, role: 'user', category: 'business', action: 'demand_cancel',
      target_type: 'demand', target_id: demand_id,
      detail: { demand_no: d.demand_no, scene: d.scene || '' },
      result: 'ok', client_ip: clientIp, device
    });
    return { ok: true, data: { demand_id, status: 'cancelled' } };
  } catch (e) {
    return { ok: false, code: 'cancel_fail', msg: '取消失败' };
  }
}

// 懒过期:把过期 matching 需求置为 expired — 原 case 'lazy_expire'
async function lazy_expire_action(ctx) {
  const { lazyExpire } = ctx;
  const n = await lazyExpire();
  return { ok: true, data: { expired_count: n } };
}

module.exports = { cancel: cancel_action, lazy_expire: lazy_expire_action };
