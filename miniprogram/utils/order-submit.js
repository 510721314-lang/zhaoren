'use strict';
// utils/order-submit.js —— 订单详情页「提交/响应编排域」（前端巨页分拆阶段B B2）
// 逐字搬迁自 pages-v2/order-detail/order-detail.js（原 978-1021 / 1024-1047 / 1141-1202 / 1205-1224 / 1227-1246 / 1468-1499）；
// 头注：本模块搬迁自 @VERIFIED 文件第 1 行覆盖区，行为等价，用户 2026-11-12 书面批准（归属表 v1.1）。
// 零行为变更：方法内 this 引用已全部改为 page（含 const that = page）；提交器→page._modal 壳→utils/order-modal 为单向两层转发，非递归。
// 禁止解构/别名缓存 page 成员与 page.data（须实时读）；成功路径 return page.fetchData(...) 不得丢（保 _acting 租约）。
const { callCloud } = require('./cloud.js');
const CONFIG = require('../config/index.js');


function submitExtend(page) {
  const that = page;
  const hours = Number(page.data.extendHours);
  if (!hours || hours < 1 || hours > 12) {
    wx.showToast({ title: '加时时长须为1-12小时', icon: 'none' });
    return;
  }
  // 2026-11-10 评审: 加时原因改为必填 + 类型必选(与服务端 oa_extend_reason/oa_extend_reason_type 同口径)
  const rt = page.data.extendReasonTypes[page.data.extendReasonTypeIndex];
  if (!rt) {
    wx.showToast({ title: '请选择加时原因', icon: 'none' });
    return;
  }
  const reasonTxt = String(page.data.extendReason || '').trim();
  if (reasonTxt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length < page.data.reasonMinLen) {
    wx.showToast({ title: '原因不少于10字', icon: 'none' });
    return;
  }
  wx.showLoading({ title: '提交加时', mask: true });
  callCloud('order-action', {
    action: 'extend',
    order_id: page.data.order._id,
    add_hours: hours,
    reason: reasonTxt.slice(0, page.data.extendReasonMax),
    reason_type: rt.k
  }).then((r) => {
    wx.hideLoading();
    if (!r.ok) {
      wx.showToast({ title: r.msg || '加时申请失败', icon: 'none' });
      return;
    }
    that.setData({ extendPanelVisible: false });
    wx.showModal({
      title: '加时申请已提交',
      content: `+${hours}小时\n等待对方确认`,
      showCancel: false, confirmText: '知道了',
      fail: () => {},
      success: () => that.fetchData({ orderId: that.data.order._id })
    });
  }).catch(() => {
    wx.hideLoading();
    wx.showToast({ title: '网络异常', icon: 'none' });
  });
}

function onExtendConfirm(page) {
  const that = page;
  const pe = page.data.order && page.data.order.pending_extend;
  if (!pe) { wx.showToast({ title: '无待处理的加时申请', icon: 'none' }); return; }
  page._modal({
    title: '确认同意加时',
    content: `+${pe.add_hours}小时\n确认后时长延长(加时暂不计费)`,
    confirmText: '同意',
    cancelText: '拒绝',
    // F1: 本弹窗取消键=「拒绝加时」业务动作而非放弃, 回调须照常执行
    cancelIsAction: true,
    fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
    success: (res) => {
      const act = res.confirm ? 'extend_confirm' : 'extend_reject';
      wx.showLoading({ title: res.confirm ? '确认加时' : '拒绝加时', mask: true });
      return callCloud('order-action', { action: act, order_id: that.data.order._id }).then((r) => {
        wx.hideLoading();
        if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
        wx.showToast({ title: res.confirm ? '加时已确认' : '已拒绝加时', icon: 'success' });
        return that.fetchData({ orderId: that.data.order._id });
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
    }
  });
}

function submitModify(page) {
  const that = page;
  const { modifyDate, modifyTime } = page.data;
  if (!modifyDate || !modifyTime) {
    wx.showToast({ title: '请选择新的日期和时间', icon: 'none' });
    return;
  }
  const ts = page.buildModifyTs();
  if (!ts || isNaN(ts) || ts <= Date.now()) {
    wx.showToast({ title: '新时间无效', icon: 'none' });
    return;
  }
  // 2026-11-05: 选回原时间视为未变更，不生成无意义的 S2_5 在途申请（服务端 oa_modify_same 兜底）
  if (ts === Number(page.data.order && page.data.order.start_time)) {
    wx.showToast({ title: '与当前服务时间相同', icon: 'none' });
    return;
  }
  if (ts - Date.now() < CONFIG.MODIFY.minLeadHours * 3600000) {
    wx.showToast({ title: `须提前${CONFIG.MODIFY.minLeadHours}小时申请改期`, icon: 'none' });
    return;
  }
  // 2026-11-10 评审: 改期原因改为必填 + 类型必选(与服务端 oa_modify_reason/oa_modify_reason_type 同口径)
  const rt = page.data.modifyReasonTypes[page.data.modifyReasonTypeIndex];
  if (!rt) {
    wx.showToast({ title: '请选择改期原因', icon: 'none' });
    return;
  }
  const reasonTxt = String(page.data.modifyReason || '').trim();
  if (reasonTxt.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length < page.data.reasonMinLen) {
    wx.showToast({ title: '原因不少于10字', icon: 'none' });
    return;
  }
  page._modal({
    title: '确认提交改期',
    content: `新服务时间：${modifyDate} ${modifyTime}\n提交后需耍伴${CONFIG.MODIFY.confirmMinutes}分钟内确认`,
    confirmText: '确认',
    fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
    success: (res) => {
      if (!res.confirm) return;
      that.setData({ modifyPanelVisible: false });
      wx.showLoading({ title: '提交改期', mask: true });
      return callCloud('order-action', {
        action: 'modify',
        order_id: that.data.order._id,
        new_start_time: ts,
        reason: reasonTxt.slice(0, that.data.modifyReasonMax),
        reason_type: rt.k
      }).then((r) => {
        wx.hideLoading();
        if (!r.ok) {
          if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '改期失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '改期申请已提交', icon: 'success' });
        return that.fetchData({ orderId: that.data.order._id });
      }).catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
    }
  });
}

function onModifyConfirm(page) {
  const that = page;
  const pm = page.data.order && page.data.order.pending_modify;
  page._modal({
    title: '同意改期',
    content: pm ? `确认将服务时间改为 ${pm.new_date} ${pm.new_time}？` : '确认同意本次改期？',
    confirmText: '同意',
    fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
    success(res) {
      if (!res.confirm) return;
      wx.showLoading({ title: '处理中', mask: true });
      return callCloud('order-action', { action: 'modify_confirm', order_id: that.data.order._id }).then((r) => {
        wx.hideLoading();
        if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
        wx.showToast({ title: '已同意改期', icon: 'success' });
        return that.fetchData({ orderId: that.data.order._id });
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
    }
  });
}

function onModifyReject(page) {
  const that = page;
  page._modal({
    title: '拒绝改期',
    content: '拒绝后服务时间保持不变',
    confirmText: '拒绝',
    confirmColor: '#fa5151',
    fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
    success(res) {
      if (!res.confirm) return;
      wx.showLoading({ title: '处理中', mask: true });
      return callCloud('order-action', { action: 'modify_reject', order_id: that.data.order._id }).then((r) => {
        wx.hideLoading();
        if (!r.ok) { if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '操作失败', icon: 'none' }); return; }
        wx.showToast({ title: '已拒绝改期', icon: 'none' });
        return that.fetchData({ orderId: that.data.order._id });
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); });
    }
  });
}

function onCancel(page) {
  const that = page;
  const tier = page.data.cancelTiers[page.data.currentCancelIdx];
  const ruleLines = page.data.cancelTiers.map((t) => `· ${t.label}：退款${t.rate * 100}%`).join('\n');
  page._modal({
    title: '取消订单',
    content: `退款规则：\n${ruleLines}\n\n当前适用：${tier.label}，退款${tier.rate * 100}%`,
    confirmText: '确认取消',
    confirmColor: '#fa5151',
    fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
    success: (res) => {
      if (!res.confirm) return;
      wx.showLoading({ title: '取消中', mask: true });
      return callCloud('order-action', {
        action: 'cancel',
        order_id: that.data.order._id,
        reason: tier ? `按${tier.label}梯度退款` : ''
      }).then((r) => {
        wx.hideLoading();
        if (!r.ok) {
          if (!that._handleConflict(r)) wx.showToast({ title: r.msg || '取消失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: tier ? `已取消·退款${tier.label}` : '已取消', icon: 'none', duration: 2000 });
        setTimeout(() => wx.navigateBack({ fail: () => {} }), 1500);
      }).catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      });
    }
  });
}

module.exports = { submitExtend, onExtendConfirm, submitModify, onModifyConfirm, onModifyReject, onCancel };
