// utils/report.js · 产品埋点轻封装
// 通道: wx.reportAnalytics(微信后台「事件分析/漏斗」面板查看), 不在前端写自建库, 避免写库噪声与配额损耗
// 约定: 事件 key 用英文 snake_case(微信后台不支持中文 key); 埋点失败绝不阻塞业务
function report(name, payload) {
  try {
    if (typeof wx.reportAnalytics === 'function') {
      wx.reportAnalytics(name, Object.assign({ hub_time: Date.now() }, payload || {}));
    }
  } catch (e) { /* 静默 */ }
}

// 北极星漏斗对齐(周有效履约订单量):
// app_launch → login_success → realname_done → demand_publish → order_take → order_pay → order_start → order_finish → eval_submit / withdraw
module.exports = { report };