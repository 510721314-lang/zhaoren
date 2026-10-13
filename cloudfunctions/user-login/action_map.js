// action_map.js — 从 index.js 物理抽出(地图即时定位共享三 action: set_map_share / report_map_gps / nearby_map_list)
// 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')(防循环依赖)

// 地图即时定位共享开关(双向对称): 允许/不允许 TA 通过地图找到我
async function set_map_share_action(ctx) {
  const { event, openid, col, _, log, writeAudit, db, clientIp, device } = ctx;
  if (typeof event.allow !== 'boolean') {
    return { ok: false, code: 'bad_allow', msg: '参数格式有误' };
  }
  try {
    const r = await col('user_account').where({ openid }).limit(1).get();
    if (!(r.data && r.data.length > 0)) {
      return { ok: false, code: 'no_user', msg: '请先登录' };
    }
    const u = r.data[0];
    await col('user_account').doc(u._id).update({ data: {
      allow_map_share: event.allow,
      // 关闭时清除已上报的实时定位(隐私: 不允许再被地图定位)
      ...(event.allow ? {} : { map_gps: _.remove() }),
      updated_at: Date.now()
    }});
    await writeAudit(db, log, {
      action: 'set_map_share', target_type: 'user_account', target_id: u._id,
      detail: { allow: event.allow, result: 'ok' }, result: 'ok', client_ip: clientIp, device
    });
    return { ok: true, data: { allow_map_share: event.allow } };
  } catch (e) {
    log.d('set_map_share fail:', e && e.message);
    return { ok: false, code: 'business_error', msg: '操作失败' };
  }
}

// 实时定位上报(进地图页时调用): 记录本人当前坐标, 供已「允许」的两侧相互发现
async function report_map_gps_action(ctx) {
  const { event, openid, col, log } = ctx;
  const lat = Number(event.latitude);
  const lng = Number(event.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, code: 'bad_location', msg: '定位数据异常' };
  }
  try {
    const r = await col('user_account').where({ openid }).limit(1).get();
    if (!(r.data && r.data.length > 0)) {
      // 未建号也能上报(游客), 但无 openid 关联则丢弃——需要账号, 跳过
      return { ok: false, code: 'no_user', msg: '请先登录' };
    }
    const u = r.data[0];
    // 未允许共享, 不上报真实坐标(防越权写库+隐私)
    if (u.allow_map_share !== true) {
      return { ok: false, code: 'share_off', msg: '你未开启地图共享' };
    }
    await col('user_account').doc(u._id).update({ data: {
      map_gps: { lat, lng, at: Date.now() },
      updated_at: Date.now()
    }});
    return { ok: true, data: { saved: true } };
  } catch (e) {
    log.d('report_map_gps fail:', e && e.message);
    return { ok: false, code: 'business_error', msg: '操作失败' };
  }
}

// 查周边已开启共享且定位有效(15min 内)的 TA(剔除自己): 地图 marker 数据源
async function nearby_map_list_action(ctx) {
  const { event, openid, col, _, pickGps, haversineMeters, log } = ctx;
  try {
    const r = await col('user_account').where({ openid }).limit(1).get();
    if (!(r.data && r.data.length > 0)) {
      return { ok: false, code: 'no_user', msg: '请先登录' };
    }
    const me = r.data[0];
    const freshCut = Date.now() - 15 * 60 * 1000; // 定位 15 分钟内有效
    const qr = await col('user_account').where({ allow_map_share: true, is_deleted: _.neq(true) })
      .limit(100).get().catch(() => ({ data: [] }));
    const mePt = pickGps(me);
    const list = (qr.data || [])
      .filter((t) => t.openid && t.openid !== me.openid)
      .map((t) => {
        const gps = pickGps(t);
        return {
          openid: t.openid,
          nickname: t.nickname || '微信用户',
          avatar: (t.avatar && /^https?:/.test(t.avatar)) ? t.avatar : '',
          roles: t.roles || [],
          is_partner: (t.roles || []).indexOf('partner') >= 0,
          lat: gps ? gps.lat : 0,
          lng: gps ? gps.lng : 0,
          gps_at: gps ? gps.at : 0,
          online: !!gps && gps.at >= freshCut,
          distance_m: mePt ? haversineMeters(mePt.lat, mePt.lng, gps ? gps.lat : 0, gps ? gps.lng : 0) : -1
        };
      })
      // 仅展示定位有效(在线)的 TA
      .filter((t) => t.online && t.lat !== 0 && t.lng !== 0);
    return { ok: true, data: { list }, my_allow: me.allow_map_share === true };
  } catch (e) {
    log.d('nearby_map_list fail:', e && e.message);
    return { ok: false, code: 'business_error', msg: '查询失败' };
  }
}

module.exports = {
  set_map_share: set_map_share_action,
  report_map_gps: report_map_gps_action,
  nearby_map_list: nearby_map_list_action,
};
