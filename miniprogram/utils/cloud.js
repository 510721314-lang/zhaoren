// @VERIFIED 2026-10-13 已真机验证：统一云调用入口(cloudReady 等待+读重试2次/写不重试+6s超时+device 注入)（依据：project_memory L75）
// utils/cloud.js · 统一云函数调用入口(2026-10-12 评审整改 P2)
//
// 背景: 此前 39 个页面/组件各自定义 `callCloud` 直接 `wx.cloud.callFunction`, 存在两类问题:
//   ① 未等 app.js 的 cloudReady(云初始化 Promise)即发起调用 → 与延迟 bootstrap 竞态, 首屏可能取不到数据;
//   ② 绕过 app.cloudCall 的「写操作不重试」策略 → 超时重试可能造成重复扣款/重复发消息/重复状态推进。
// 本模块统一委托 app.cloudCall: 等云就绪 + 读操作重试2次/写操作不重试 + 单次超时6s + 注入 device 摘要。
//
// 用法(与各页原 callCloud 签名一致): const { callCloud } = require('../../utils/cloud.js');
//   callCloud('order-action', { action: 'detail', order_id }).then((r) => { if (!r.ok) ... });
function callCloud(name, data, opts) {
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && typeof app.cloudCall === 'function' && app.globalData && app.globalData.cloudReady) {
    return app.cloudCall(name, data, opts);
  }
  // 兜底(app 未就绪/单测环境): 退化为直连, 保持与原各页实现一致的返回契约(失败返回 {ok:false})
  return wx.cloud.callFunction({ name, data })
    .then((r) => r.result || {})
    .catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, code: 'cloud_error', msg: '网络异常,请重试' }; });
}

module.exports = { callCloud };
