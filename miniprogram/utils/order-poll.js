// miniprogram/utils/order-poll.js · 订单详情「定时器/通知轮询」服务模块
// 拆分阶段2c(2026-10-16): 原 order-detail.js 方法逐字迁出(用户书面批准, 方案 §8.2 前置3); 接收 page
// 设计: 只搬不改逻辑; 禁 getApp()/globalData(方案 §5.8); 页面 order-detail.js 留同名薄代理, 全部调用点零改
// 迁出源: order-detail.js clearTimers(现 L371) / startTipPoll(现 L380) / stopTipPoll(现 L434) / onTipNoticeTap(现 L439) / startCountdown(现 L446) / fetchTipList(现 L466)
// 注: __fmtNoticeTime 为纯格式化, 按用户裁定移 utils/order-view.js(导出 fmtNoticeTime), 本模块 require 复用

const { callCloud } = require('./cloud.js');
const { ORDER_STATUS } = require('../config/enums.js');
const { fmtNoticeTime } = require('./order-view.js');

// 迁自 order-detail.js clearTimers(定时器清理; 不依赖 wx, 仅 page 实例属性)
function clearTimers(page) {
  if (page._timer) { clearInterval(page._timer); page._timer = null; }
  if (page._tipTimer) { clearInterval(page._tipTimer); page._tipTimer = null; }
}

// 迁自 order-detail.js startTipPoll
// 通知轮询: 停在订单详情页时每 8s 查本人该订单未读通知(多条递增展示)
// - 全状态轮询: 耍伴停留等待对方确认时(改期/加时 S2_5), 需求方任何变动即时横幅+toast 提示
// - 拉到新通知后静默刷新订单详情, 同步最新状态/新服务时间
// 幂等去重: 已展示过的通知 id 不再重复展示(本地 Map 记忆)
function startTipPoll(page) {
  stopTipPoll(page);
  page.__shownTipIds = page.__shownTipIds || {};
  page._tipTimer = setInterval(() => {
    callCloud('order-action', { action: 'notice_poll', order_id: page.data.order.order_id }).then((r) => {
      const d = r && r.ok && r.data;
      if (!d || !d.list || !d.list.length) return;
      // 多次打赏/多通知: 依次追加到列表, 已展示过的不再重复
      const fresh = d.list.filter((n) => n && n.id && !page.__shownTipIds[n.id]);
      if (!fresh.length) return;
      fresh.forEach((n) => { page.__shownTipIds[n.id] = 1; });
      const iconOf = (type) => (type === 'tip' ? '💝' : '🔔');
      const textOf = (n) => (n.type === 'tip' ? (n.body || '收到打赏') : (n.body || n.title || '新通知'));
      const items = fresh.map((n) => ({
        id: n.id,
        text: `${iconOf(n.type)} ${textOf(n)}`,
        time: n.created_at ? fmtNoticeTime(n.created_at) : ''
      }));
      page.setData({ tipNotices: [...items, ...page.data.tipNotices] });
      // 即时提示: 对方(需求方/耍伴)对该订单的变动, toast 醒目提示; 关键类型用明确文案
      // 四确认单步通知(title=订单沟通)只进横幅不弹 toast, 避免逐项刷屏
      // 加时/改期被对方响应(同意/拒绝, 含超时自动拒绝): 震动 + 弹窗醒目提醒(该通知仅发起方会收到)
      const RESPOND_ALERT = {
        extend_confirm: '✅ 对方已同意加时',
        extend_reject: '❌ 对方已拒绝加时',
        modify_confirm: '✅ 对方已同意改期',
        modify_reject: '❌ 对方已拒绝改期'
      };
      const respondHit = fresh.find((n) => RESPOND_ALERT[n.type]);
      if (respondHit) {
        try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
        wx.showModal({
          title: RESPOND_ALERT[respondHit.type],
          content: respondHit.body || '',
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        const key = fresh[0];
        const TITLE_OF = {
          accept: '有人接单了', paid: '对方已支付',
          confirm_done: '四确认完成,待支付', start: '耍伴已开始履约',
          finish: '履约已完成', milestone: '履约进度更新',
          cancel: '订单已取消', tip: '收到打赏'
        };
        const toastTitle = TITLE_OF[key.type] || (key.title && key.title !== '订单沟通' ? key.title : '');
        if (toastTitle) wx.showToast({ title: toastTitle.slice(0, 12), icon: 'none', duration: 2500 });
      }
      // 静默刷新同步最新状态/时间(不闪 loading)
      page.fetchData({ orderId: page.__orderId }, true);
    }).catch(() => {});
  }, 8000);
}

// 迁自 order-detail.js stopTipPoll
function stopTipPoll(page) {
  if (page._tipTimer) { clearInterval(page._tipTimer); page._tipTimer = null; }
}

// 迁自 order-detail.js onTipNoticeTap; 点击单条横幅 → 标记该通知已读 + 移除(后续轮询不再带回)
function onTipNoticeTap(page, e) {
  const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
  if (!id) return;
  page.setData({ tipNotices: page.data.tipNotices.filter((n) => n.id !== id) });
  callCloud('order-action', { action: 'notice_read', notice_id: id }).catch(() => {});
}

// 迁自 order-detail.js startCountdown
function startCountdown(page) {
  clearTimers(page);
  page._timer = setInterval(() => {
    const o = page.data.order;
    if (!o) return;
    // PRD 3.5.2：倒计时文案以 ORDER_STATUS.timeoutText 为唯一 SSOT
    const st = ORDER_STATUS[o.status];
    page.setData({ countdownText: st ? st.timeoutText : '' });
  }, 1000);
}

// 迁自 order-detail.js fetchTipList; 💝 打赏逐笔明细(订单双方可见, 时间升序; 打赏成功后由 onTip 刷新触发重拉)
function fetchTipList(page) {
  const o = page.data.order || {};
  if (!o.order_id) return;
  callCloud('payment-mock', { action: 'tip_list', order_id: o.order_id }).then((r) => {
    if (!r.ok || !r.data || !r.data.list) return;
    page.setData({
      tipList: r.data.list.map((t) => ({
        pay_no: t.pay_no,
        amountYuan: ((t.amount_fen || 0) / 100).toFixed(2),
        note: t.note || '',
        timeText: t.created_at ? fmtNoticeTime(t.created_at) : ''
      }))
    });
  }).catch(() => {});
}

module.exports = { clearTimers, startTipPoll, stopTipPoll, onTipNoticeTap, startCountdown, fetchTipList };
