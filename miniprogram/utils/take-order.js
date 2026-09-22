// utils/take-order.js · 耍伴接单链路（P0-1）
// 流程: 实名门禁 → 场景免责声明(wx.showModal·接单方双签) → wx.getLocation → sign_disclaimer(幂等) → create_from_take
// 拒绝规则(身份/资料审核/信用分/距离50km/时间冲突/接单范围)以后端 order-create 为准, 前端只做入口校验
const { SCENES } = require('../config/enums.js');

// demand: 需求对象(需 _id / scene_code / match_mode)
// opts:   { onSuccess(data), onError(result) }  data = { order_id, order_no, status: 'S1', ... }
function takeOrder(demand, opts) {
  if (!demand || !demand._id) {
    wx.showToast({ title: '需求数据异常', icon: 'none' });
    return;
  }
  // 实名门禁: 动态加载避免冷启动时序
  try {
    const { requireRealname } = require('./bootstrap.js');
    if (!requireRealname('接单')) return;
  } catch (e) {}
  // 选单模式接单走报名→确认流程(P1-12), P0 仅支持抢单 broadcast
  if (demand.match_mode === 'select') {
    wx.showToast({ title: '选单需求请通过报名流程接单(即将上线)', icon: 'none' });
    return;
  }
  const scene = SCENES.find((s) => s.code === demand.scene_code) || null;
  const d = scene && scene.disclaimer;
  if (d) {
    // 免责声明用 wx.showModal(真机稳定, 与发布侧弹法统一, 禁用 bottom-sheet)
    // 注意: confirmText 上限 4 字符, 超限真机上弹窗不渲染且无反应(教训已入 skill)
    wx.showModal({
      title: d.title,
      content: d.content,
      confirmText: '同意接单',
      cancelText: '不同意',
      success: (r) => {
        if (r.confirm) _locate(demand, opts);
      },
      fail: (err) => {
        // 静默失败兜底: 弹窗渲染失败时给出可见反馈, 不允许无反应
        console.error('[takeOrder] showModal fail:', err);
        wx.showToast({ title: '弹窗加载失败,请重试', icon: 'none' });
      }
    });
  } else {
    _locate(demand, opts);
  }
}

// 真实客户端 create_from_take 必传 partner_location(服务端 50km 距离校验), 定位失败 fallback 到 chooseLocation
function _locate(demand, opts) {
  wx.showLoading({ title: '获取定位...', mask: true });
  wx.getLocation({
    type: 'gcj02',
    success: (loc) => {
      wx.hideLoading();
      _signThenCreate(demand, { latitude: loc.latitude, longitude: loc.longitude }, opts);
    },
    fail: () => {
      wx.hideLoading();
      // getLocation 可能因 API 未通过审核或用户权限被拒而失败, fallback 到 chooseLocation(已审核通过)
      wx.showModal({
        title: '定位不可用',
        content: '需要位置信息用于距离校验, 是否手动在地图上选择你的当前位置?',
        confirmText: '选点',
        cancelText: '取消',
        success: (r) => {
          if (!r.confirm) return;
          wx.chooseLocation({
            success: (loc) => {
              _signThenCreate(demand, { latitude: loc.latitude, longitude: loc.longitude }, opts);
            },
            fail: () => {
              wx.showToast({ title: '未选择位置,无法接单', icon: 'none' });
            }
          });
        }
      });
    }
  });
}

function _signThenCreate(demand, loc, opts) {
  wx.showLoading({ title: '接单中...', mask: true });
  wx.cloud.callFunction({
    name: 'order-create',
    data: { action: 'sign_disclaimer', scene: demand.scene_code }
  }).then((res) => {
    const r = res.result || {};
    if (!r.ok) {
      wx.hideLoading();
      wx.showToast({ title: r.msg || '签署失败,请重试', icon: 'none' });
      return;
    }
    return wx.cloud.callFunction({
      name: 'order-create',
      data: {
        action: 'create_from_take',
        demand_id: demand._id,
        partner_location: loc
      }
    }).then((res2) => {
      wx.hideLoading();
      const r2 = res2.result || {};
      if (r2.ok && r2.data) {
        if (opts && opts.onSuccess) opts.onSuccess(r2.data);
      } else {
        // 拒绝原因以云函数 r.msg 为准(已被抢/距离超限/资料未审核/时间冲突等)
        wx.showModal({ title: '无法接单', content: r2.msg || '接单失败,请稍后重试', showCancel: false });
        if (opts && opts.onError) opts.onError(r2);
      }
    });
  }).catch(() => {
    wx.hideLoading();
    wx.showToast({ title: '网络异常,请重试', icon: 'none' });
  });
}

module.exports = { takeOrder };
