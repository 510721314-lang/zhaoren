'use strict';
// utils/order-modal.js —— 订单详情页「操作互斥弹窗」（前端巨页分拆阶段B B1）
// 逐字搬迁自 pages-v2/order-detail/order-detail.js `_modal` L160-171（零行为变更）；
// 搬迁自 @VERIFIED 文件第 1 行覆盖区的调用链（加时/协商取消等经此弹窗），B1 范围经用户 2026-11-12 书面批准。
// `_acting` 为页实例态，经 page 首参 ctx 读写（先例 utils/order-poll.js）；禁止模块级状态/require 页面。
// 契约：showModal(page, opts) —— opts.cancelIsAction=true 时取消键也执行业务回调（如加时弹窗的「拒绝」）。
function showModal(page, opts) {
  if (page._acting) return;
  page._acting = true;
  const release = () => { page._acting = false; };
  wx.showModal(Object.assign({}, opts, {
    success: (res) => {
      if (!res.confirm && !opts.cancelIsAction) { release(); return; }
      Promise.resolve().then(() => opts.success(res)).then(release, release);
    },
    fail: () => { release(); if (opts.fail) opts.fail(); }
  }));
}

module.exports = { showModal };
