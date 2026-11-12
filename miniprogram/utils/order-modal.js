'use strict';
// utils/order-modal.js —— 订单详情页「操作互斥弹窗」（前端巨页分拆阶段B B1）
// 逐字搬迁自 pages-v2/order-detail/order-detail.js `_modal` L160-171（零行为变更）；
// 搬迁自 @VERIFIED 文件第 1 行覆盖区的调用链（加时/协商取消等经此弹窗），B1 范围经用户 2026-11-12 书面批准。
// `_acting` 为页实例态，经 page 首参 ctx 读写（先例 utils/order-poll.js）；禁止模块级状态/require 页面。
// 契约：showModal(page, opts) —— opts.cancelIsAction=true 时取消键也执行业务回调（如加时弹窗的「拒绝」）。
// P3-39(2026-11-13 用户 §2 书面批准): 互斥改为「弹窗期不计时 + 业务期 20s 租约」——
//   原实现仅在 modal fail 与业务 Promise 结算时放锁, 请求挂起(无 fail 无结算)会让本页所有操作永久失效。
const ACTING_LEASE_MS = 20000;
function showModal(page, opts) {
  if (page._acting) return;
  page._acting = true;
  const release = () => {
    if (page.__actingTimer) { clearTimeout(page.__actingTimer); page.__actingTimer = null; }
    page._acting = false;
  };
  wx.showModal(Object.assign({}, opts, {
    success: (res) => {
      if (!res.confirm && !opts.cancelIsAction) { release(); return; }
      // 业务期租约: 从进入业务回调起算; 正常结算/失败仍会提前 release, 到点则兜底放锁
      if (page.__actingTimer) clearTimeout(page.__actingTimer);
      page.__actingTimer = setTimeout(release, ACTING_LEASE_MS);
      Promise.resolve().then(() => opts.success(res)).then(release, release);
    },
    fail: () => { release(); if (opts.fail) opts.fail(); }
  }));
}

module.exports = { showModal };
