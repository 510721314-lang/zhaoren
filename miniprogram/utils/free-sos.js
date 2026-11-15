// utils/free-sos.js — 无单紧急求助(自由求助)统一流程(2026-11-15 P3-39)
// 依据: 红线附录A 第9条「无单=自由求助(P0事件、本人/客服解除、10min冷却)」, 不读写 order_main
// 云端 safety-report 的 free_sos / free_sos_status / free_sos_resolve 不校验角色(仅按 openid 落 safety_report),
// 故耍伴与纯需求方共用本流程, 无需任何后端改动。
// 单一真相: workbench 与 profile 均委托本模块, 禁止各自复制一份(安全链路双实现易走偏)。
const { callCloud } = require('./cloud.js');

function toast(title) { wx.showToast({ title: title, icon: 'none' }); }

function confirmModal(opts) {
  return new Promise(function (resolve) {
    wx.showModal(Object.assign({}, opts, {
      fail: function () { toast('弹窗加载失败'); resolve(false); },
      success: function (r) { resolve(!!r.confirm); }
    }));
  });
}

// 三态流程: 已有 active → 询问是否解除; 无 → 直接上报 P0 事件
// 返回 Promise<{ ok, action: 'reported' | 'resolved' | 'kept' }>
function startFreeSos(source) {
  const src = String(source || 'app').slice(0, 32);
  return callCloud('safety-report', { action: 'free_sos_status' }).then(function (r) {
    if (!r.ok) { toast('状态查询失败,请直接拨打110'); return { ok: false }; }
    if (r.data && r.data.active) {
      return confirmModal({
        title: '已有进行中的求助',
        content: '你已上报过自由求助,是否解除？',
        confirmText: '解除求助',
        confirmColor: '#fa5151'
      }).then(function (confirmed) {
        if (!confirmed) return { ok: true, action: 'kept' };
        return callCloud('safety-report', { action: 'free_sos_resolve', report_id: r.data.report_id })
          .then(function (x) {
            toast(x.ok ? '已解除求助' : (x.msg || '解除失败'));
            return { ok: !!x.ok, action: 'resolved' };
          })
          .catch(function () { toast('网络异常,解除失败'); return { ok: false, action: 'resolved' }; });
      });
    }
    return callCloud('safety-report', { action: 'free_sos', source: src }).then(function (x) {
      if (!x.ok) { toast('上报失败, 请直接拨打110'); return { ok: false, action: 'reported' }; }
      wx.showToast({ title: '已上报平台安全中心', icon: 'none', duration: 2500 });
      return { ok: true, action: 'reported' };
    }).catch(function () { toast('网络异常, 请直接拨打110'); return { ok: false, action: 'reported' }; });
  }).catch(function () { toast('网络异常, 请直接拨打110'); return { ok: false }; });
}

module.exports = { startFreeSos };
