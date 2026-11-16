// zz-openapi-probe — cloud.openapi 通道探针（无副作用，仅返回 errCode）
// 用途：验证 cloud.openapi.security.msgSecCheck + subscribeMessage.send 通道是否恢复（-604101 环境级失效排查）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// paid 模板测试参数（与 admin_config.sub_msg_templates.paid 一致）
const PAID_TMPL_ID = '6z4MazbNfIU47NDfR-779KySIYpqT81kQxCgDX2gRlM';
const DEMAND_GRAB_TMPL_ID = 'x1TfKgMBQCa2PpfpW10AVewcaFfm8BfuPCKOLk2Dx3Q';
const TEST_OPENID = 'oLDJ73VEzT_UTK-HfQgiFRV2LPA4'; // 测试耍伴 openid

exports.main = async () => {
  const result = { checked_at: Date.now(), probes: {} };

  // 探针1: msgSecCheck
  try {
    const res = await cloud.openapi.security.msgSecCheck({ content: 'test' });
    result.probes.msgSecCheck = { ok: true, errCode: res.errCode || 0, errMsg: res.errMsg || '', channel: 'alive' };
  } catch (e) {
    result.probes.msgSecCheck = {
      ok: false,
      errCode: (e && e.errCode !== undefined) ? e.errCode : 'uncaught',
      errMsg: String((e && (e.errMsg || e.message)) || ''),
      channel: 'down',
    };
  }

  // 探针2: subscribeSend（paid 模板，trial 状态不影响正式版）
  try {
    const res = await cloud.openapi.subscribeMessage.send({
      touser: TEST_OPENID,
      templateId: PAID_TMPL_ID,
      page: 'pages-v2/order-detail/order-detail',
      data: {
        character_string1: { value: 'TEST123456' },
        phrase4: { value: '支付成功' },
        time5: { value: '2026-11-16 12:00' },
      },
      miniprogramState: 'trial',
    });
    result.probes.subscribeSend_paid = { ok: true, errCode: res.errCode || 0, errMsg: res.errMsg || '', channel: 'alive' };
  } catch (e) {
    result.probes.subscribeSend_paid = {
      ok: false,
      errCode: (e && e.errCode !== undefined) ? e.errCode : 'uncaught',
      errMsg: String((e && (e.errMsg || e.message)) || ''),
      channel: 'down',
    };
  }

  // 探针3: subscribeSend（demand_grab 模板，用于区分接口级 vs 模板级问题）
  try {
    const res = await cloud.openapi.subscribeMessage.send({
      touser: TEST_OPENID,
      templateId: DEMAND_GRAB_TMPL_ID,
      page: 'pages-v2/demand-detail/demand-detail',
      data: {
        thing1: { value: '测试' },
        thing2: { value: '测试主题' },
        time: { value: '2026-11-16 12:00' },
        time22: { value: '2026-11-16 13:00' },
      },
      miniprogramState: 'formal',
    });
    result.probes.subscribeSend_demand_grab = { ok: true, errCode: res.errCode || 0, errMsg: res.errMsg || '', channel: 'alive' };
  } catch (e) {
    result.probes.subscribeSend_demand_grab = {
      ok: false,
      errCode: (e && e.errCode !== undefined) ? e.errCode : 'uncaught',
      errMsg: String((e && (e.errMsg || e.message)) || ''),
      channel: 'down',
    };
  }

  // 汇总：任一 -604101 则通道未完全恢复
  const has604101 = Object.values(result.probes).some(p => p.errCode === -604101);
  result.channel = has604101 ? 'partial_down' : (Object.values(result.probes).every(p => p.channel === 'alive') ? 'alive' : 'check_errCode');
  return result;
};
