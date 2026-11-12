'use strict';
// utils/chat-notice.js —— chat 页「弹窗/提醒编排域」（前端巨页分拆阶段A，归属表 v1.1 段9-15 + applyNotices 域）
// 逐字搬迁自 pages-v2/chat/chat.js（零行为变更）；依赖经 page 首参 ctx 注入（先例 utils/order-poll.js）；
// 禁止 require 页面（循环引用）。once 键前缀口径：本模块弹窗群用 status: / chat_notice: / chat_comm:，
// 与 confirm-flow 无键交集（方案 §三-阶段A 约束④）。
//
// ── @VERIFIED 随迁（用户 2026-11-12 书面批准，标记同迁语义不变）──
// @VERIFIED 2026-11-10 已真机验证：通知去重键含 created_at，二次同类事件两次都提示（applyNotices）
// @VERIFIED 2026-10-18 已真机验证：#88 耍伴端四确认沟通即时提示——聊天页弹窗 + 微信订阅消息 confirm_comm 全链 ①-⑦ + 催办订阅复验（applyNotices commHit 分支，内联锚点见下方分区二）
// @VERIFIED 2026-11-10 已真机验证：回前台立即补拉一次提示，不再等首个轮询 tick（onShow，留页面未动）

const once = require('./once-anchor.js');

// ── 分区一：applyConfirmation 的 setData 回调内弹窗群（归属表段9-15，原 chat.js L350-475 逐字）──
// 状态提示 catch-up 模式: 每状态只提示一次, 不依赖轮询跳变/瞬时窗口(根治"提示不跳出/丢失"类问题)
// 2026-10-30(§34): 状态提示幂等键落 Storage(once:status:<order_id>:<阶段>), 重进聊天页不再重复弹
// 死代码口径（方案 §三-阶段A⑤，原样随迁禁清理）：「💳 订单支付」分支不可达——
//   同条件 1b 分支（user_S0）先 mark，本分支永假；firstLoad 死变量随 confirm-flow 原样保留
function runConfirmationPopups(page, d, nextStatus, view) {
  const stOid = page.data.orderId || '';
  const shown = (k) => once.has('status:' + stOid + ':' + k);
  const mark = (k) => once.mark('status:' + stOid + ':' + k);

  // 1) S0 耍伴端: 对方已确认, 待付款
  if (page.data.role === 'partner' && nextStatus === 'S0' && !shown('partner_S0')) {
    mark('partner_S0');
    wx.showModal({
      title: '📋 对方已确认',
      content: `${page.__orderSummary(d)}\n需求方已完成四项确认,订单进入待支付,等待需求方付款`,
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#07C160',
      fail: () => wx.showToast({ title: '对方已确认,待付款', icon: 'none' })
    });
  }
  // 1b) 2026-11-09 S0 需求方端: 四项已全部确认 → 弹窗引导完成支付(once 幂等, 点确定直达收银台)
  if (page.data.role === 'user' && nextStatus === 'S0' && !shown('user_S0')) {
    mark('user_S0');
    wx.showModal({
      title: '✅ 四项已全部确认',
      content: `${page.__orderSummary(d)}\n双方确认完毕,请完成支付后耍伴即开始履约`,
      showCancel: false,
      confirmText: '去支付',
      confirmColor: '#07C160',
      fail: () => wx.showToast({ title: '四项已确认,待支付', icon: 'none' }),
      success: (res) => {
        if (res.confirm) {
          // redirectTo: 全齐后聊天页使命已完成, 直达收银台(与"去履约"先例同模式)
          wx.redirectTo({
            url: `/pages-v2/pay/pay?orderId=${page.data.orderId}`,
            fail: (err) => {
              console.error('[chat] redirectTo pay fail:', err && err.errMsg);
              wx.showToast({ title: '支付页打开失败', icon: 'none' });
            }
          });
        }
      }
    });
  }
  // 1c) 2026-11-10(用户需求): 待我处理的变更 → 弹窗引导进入处理(once 按变更 token 幂等, 处理入口=本页变更卡片)
  const pcn = page.data.pendingChange;
  if (pcn && pcn.can_respond) {
    // 2026-11-10 评审 P0: 键去 token, 改 field:expire_at —— 与订单详情页共用同一 Storage 键, 避免跨页双弹
    // §39 双侧对账纪律: 本键与 order-detail.js 逐字一致, 外移后双侧 grep 复核（方案阶段A 约束⑥）
    const chKey = `change_${pcn.field}:${((d.pending_change || {}).expire_at) || 0}`;
    if (!shown(chKey)) {
      mark(chKey);
      wx.showModal({
        title: `对方申请变更「${pcn.field_cn}」`,
        content: `${pcn.old_text} → ${pcn.new_text}\n${pcn.expire_text}，请及时处理`,
        confirmText: '去处理',
        cancelText: '稍后',
        confirmColor: '#07C160',
        fail: () => wx.showToast({ title: '有变更待你处理', icon: 'none' })
      });
    }
  }
  // 2) S2 耍伴端: 对方已支付, 去履约
  if (page.data.role === 'partner' && nextStatus === 'S2' && !shown('partner_S2')) {
    mark('partner_S2');
    wx.showModal({
      title: '💰 对方已支付',
      content: `${page.__orderSummary(d)}\n对方已完成支付，请依约履约`,
      showCancel: true,
      confirmText: '去履约',
      cancelText: '知道了',
      confirmColor: '#07C160',
      fail: () => wx.showToast({ title: '对方已支付', icon: 'none' }),
      success: (res) => {
        if (res.confirm) {
          // 引导进入履约界面(订单详情页, S2 时可点"开始履约")
          wx.redirectTo({
            url: `/pages-v2/order-detail/order-detail?orderId=${page.data.orderId}`,
            fail: (err) => {
              console.error('[chat] redirectTo order-detail fail:', err && err.errMsg);
              wx.navigateBack({ fail: () => {} });
            }
          });
        }
      }
    });
  }
  // 3) S5 发布者端: 履约完成, 去评价
  if (page.data.role === 'user' && nextStatus === 'S5' && !shown('user_S5')) {
    mark('user_S5');
    wx.showModal({
      title: '🎉 履约完成',
      content: `${page.__orderSummary(d)}\n耍伴已完成履约，请对本次服务进行评价`,
      showCancel: true,
      confirmText: '去评价',
      cancelText: '稍后',
      confirmColor: '#07C160',
      fail: () => wx.showToast({ title: '履约完成，请评价', icon: 'none' }),
      success: (res) => {
        if (res.confirm) {
          wx.redirectTo({
            url: `/pages-v2/pkg-low/evaluate/evaluate?orderId=${page.data.orderId}`,
            fail: (err) => {
              console.error('[chat] redirectTo evaluate fail:', err && err.errMsg);
              wx.showToast({ title: '评价页打开失败,请从订单详情进入', icon: 'none', duration: 2500 });
            }
          });
        }
      }
    });
  }
  // 4) S0 发布者端: 订单支付(catch-up: 进入/轮询即弹, 不再限定"确认完成瞬间"或"非首次加载")
  //    【死代码·不可达】同条件 1b 分支先 mark('user_S0')，本分支永假；原样随迁保持不可达（方案 §三-阶段A⑤）
  if (page.data.role === 'user' && nextStatus === 'S0' && !shown('user_S0')) {
    mark('user_S0');
    wx.showModal({
      title: '💳 订单支付',
      content: `${page.__orderSummary(d)}\n四项确认已全部完成,订单进入待支付\n请在 30 分钟内完成支付,超时订单将自动取消`,
      confirmText: '支付',
      cancelText: '放弃支付',
      confirmColor: '#07C160',
      fail: () => wx.showToast({ title: '弹窗调用失败', icon: 'none' }),
      success: (res) => {
        if (res.confirm) page.goPay(); // 放弃支付 → 留在四确认完成窗口(顶部横幅可再次进入支付)
      }
    });
  }
  if (view.unlocked && !view.wasUnlocked) {
    wx.showToast({ title: '已解锁自由沟通,请遵守平台规则', icon: 'none', duration: 2000 });
  }
}

// ── 分区二：订单动态通知展示域（原 chat.js applyNotices L632-718 逐字，@VERIFIED 两枚随迁见文件头）──
// 对方对订单的任何变动(接单/支付/改期/履约等)即时 toast 提示
// 幂等去重: 已提示过的通知不再重复(Storage once:chat_notice:<order_id> 持久化); 数据源为 chat_poll.notices(60s 一轮)
// 2026-11-10(提示滞后): 去重键改为 id|created_at —— writeNotice 合并时复用同一 _id 并刷新 created_at, 仅按 id 会吞掉第二次同类事件
function applyNotices(page, d) {
  // 2026-10-30(§34): 通知/沟通提示幂等键落 Storage, 重进聊天页不再重复弹(§2 #88 已获放行: 文案与触发条件不变)
  const nOid = page.data.orderId || '';
  const shownIds = once.getMap('chat_notice:' + nOid);
  {
    if (!d || !d.list || !d.list.length) return;
    const fresh = d.list.filter((n) => n && n.id && !shownIds[n.id + '|' + (n.created_at || 0)]);
    if (!fresh.length) return;
    fresh.forEach((n) => { shownIds[n.id + '|' + (n.created_at || 0)] = 1; });
    once.putMap('chat_notice:' + nOid, shownIds);
    // 加时/改期被对方响应(同意/拒绝, 含超时自动拒绝): 震动 + 弹窗醒目提醒(该通知仅发起方会收到)
    const RESPOND_ALERT = {
      extend_confirm: '✅ 对方已同意加时',
      extend_reject: '❌ 对方已拒绝加时',
      modify_confirm: '✅ 对方已同意改期',
      modify_reject: '❌ 对方已拒绝改期',
      // 2026-11-04: 四确认变更协商的生效/拒绝结果(仅发起方收到)
      change_accept: '✅ 对方已接受变更',
      change_reject: '❌ 对方已拒绝变更'
    };
    const respondHit = fresh.find((n) => RESPOND_ALERT[n.type]);
    // 2026-11-10 评审 P0: 变更提醒收敛为单一来源(上方 1c token 键弹窗), 通知弹窗降级为横幅, 避免同轮双弹
    // 2026-11-10(3B): 收到「对方发起改期」→ 震动+弹窗引导进入处理(原仅顶部横幅, 易错过确认窗口)
    const modifyHit = !respondHit
      ? fresh.find((n) => n && n.type === 'modify' && String(n.title || '').indexOf('发起改期') >= 0)
      : null;
    // @VERIFIED 2026-10-18 已真机验证：#88 耍伴端四确认沟通即时提示（聊天页弹窗 + 微信订阅消息 confirm_comm 全链 ①-⑦ + 催办订阅复验）——随迁自 chat.js（内联锚点回归本分支）
    // 2026-10-17: 对方(发单人)在四确认面板提交修改/沟通 → 耍伴端醒目弹窗引导回到四确认(通知标题「订单沟通」)
    // 去重键取 id+body: 该通知被后续修改去重合并(同一 _id), 仅按 id 去重会漏掉"第二次改动"; 仅耍伴端提示(默认不做对称)
    const commShown = once.getMap('chat_comm:' + nOid);
    const commHit = (page.data.role === 'partner' && !respondHit)
      ? (d.list || []).find((n) => n && n.type === 'modify' && n.title === '订单沟通'
          && !commShown[n.id + '|' + (n.body || '')])
      : null;
    if (respondHit) {
      try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
      wx.showModal({
        title: RESPOND_ALERT[respondHit.type],
        content: respondHit.body || '',
        showCancel: false,
        confirmText: '知道了'
      });
    } else if (modifyHit) {
      try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
      wx.showModal({
        title: '对方发起改期',
        content: `${modifyHit.body || '对方申请变更服务时间'}\n请在倒计时内处理`,
        confirmText: '去处理',
        cancelText: '稍后',
        confirmColor: '#07C160',
        fail: () => {},
        success: (res) => { if (res.confirm) page.goOrderDetail(); }
      });
    } else if (commHit) {
      // 先记账再弹窗: 弹窗未关时下一轮轮询(5s)不会重复弹出
      commShown[commHit.id + '|' + (commHit.body || '')] = 1;
      once.putMap('chat_comm:' + nOid, commShown);
      try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
      wx.showModal({
        title: '对方发起沟通',
        content: `${commHit.body || '对方修改了确认项'}\n请回到上方四确认面板查看并重新确认`,
        confirmText: '去确认',
        cancelText: '稍后',
        confirmColor: '#07C160',
        fail: () => {},
        success: (res) => {
          if (res.confirm) wx.pageScrollTo({ scrollTop: 0, duration: 200 }); // 四确认面板在页面顶部
        }
      });
    } else {
      const key = fresh[0];
      const TITLE_OF = {
        accept: '有人接单了', paid: '对方已支付',
        confirm_done: '四确认完成,待支付', start: '耍伴已开始履约',
        finish: '履约已完成', milestone: '履约进度更新',
        cancel: '订单已取消', tip: '收到打赏'
      };
      const t = TITLE_OF[key.type] || key.title || '订单有新动态';
      if (t && t !== '订单沟通') wx.showToast({ title: String(t).slice(0, 12), icon: 'none', duration: 2500 });
    }
    // 同一轮 chat_poll 已带回最新四确认数据, 不再额外调用
  }
}

module.exports = { runConfirmationPopups, applyNotices };
