// 耍伴被选定 → 强制弹窗 → 点确定回写云端已读 → 跳需求详情引导接单/四确认
// B 方案(2026-11-24 用户批准): 仅在 app 切回前台时查一次(不做定时轮询), 省云函数用量
// 显隐真值在云端(select_alert_acked), 跨设备一致; 本地标记仅挡 ack 写入前的竞态窗口(经验 1529186)
const { callCloud } = require('./cloud.js');

let checking = false;  // 防并发重入
let showing = false;   // 防重复弹(云端 select_alert_acked 为最终真值)

// @VERIFIED 2026-11-25 已真机验证：checkOnce 强制弹窗（仅确定/遮罩不可关）+ 点确定调 select_confirmed_ack + 跳需求详情（REGISTRY #213，经验 1529186）
function checkOnce() {
  if (checking || showing) return;
  const app = getApp();
  const user = app && app.globalData && app.globalData.userInfo;
  if (!user || !user.openid) return;  // 游客无 openid, 不查
  checking = true;
  callCloud('order-action', { action: 'select_confirmed_poll' }, { timeout: 10000 }).then((r) => {
    checking = false;
    if (!r || !r.ok || !r.data || !r.data.has) return;
    const n = r.data.notice || {};
    if (!n.id) return;
    showing = true;
    wx.showModal({
      title: n.title || '你被选定了',
      content: n.body || '发布者已选择你承接该需求, 请尽快确认接单',
      showCancel: false,          // 仅保留「确定」, 遮罩不可点关闭 → 强制确认(经验 1529186)
      confirmText: '确定',
      confirmColor: '#07C160',
      success: () => {
        // 点确定: 回写云端 ack(独立字段, 跨设备不重复弹), 再跳需求详情 → 点「去接单」→ 四确认
        // B+: 用 select_confirmed_ack 而非 notice_read, 与消息页 read 解耦, 不被消息页吃掉(经验 1529186)
        callCloud('order-action', { action: 'select_confirmed_ack', notice_id: n.id }).catch((e) => { console.warn('[select-alert] 弹窗 ack 失败', e && e.message); });
        showing = false;
        if (n.demand_id) {
          wx.navigateTo({
            url: '/pages-v2/demand-detail/demand-detail?id=' + n.demand_id,
            fail: () => wx.showToast({ title: '需求页打开失败', icon: 'none' })
          });
        } else {
          wx.showToast({ title: '请前往消息通知查看', icon: 'none' });
        }
      },
      fail: () => { showing = false; }
    });
  }).catch(() => { checking = false; });
}

module.exports = { checkOnce };
