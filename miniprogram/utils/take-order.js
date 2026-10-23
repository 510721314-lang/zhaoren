// utils/take-order.js · 耍伴接单链路（P0-1）
// 流程: 实名门禁 → 场景免责声明(wx.showModal·接单方双签) → wx.getLocation → sign_disclaimer(幂等) → create_from_take
// 拒绝规则(身份/资料审核/信用分/距离50km/时间冲突/接单范围)以后端 order-create 为准, 前端只做入口校验
const { getScene } = require('./redline.js');
const { callCloud } = require('./cloud.js');

// 网络不确定类错误码: app.cloudCall 超时/失败时 resolve 而非 reject(写操作不重试),
// 这两个码等价于旧直调时的 reject, 需走「订单可能已建」的捞回分支
function _isNetUncertain(r) {
  return !!r && (r.code === 'cloud_timeout' || r.code === 'cloud_error');
}

// demand: 需求对象(需 _id / scene_code / match_mode)
// opts:   { onSuccess(data), onError(result) }  data = { order_id, order_no, status: 'S1', ... }
// 防重入锁: 快速反复点击抢单只生效第一次, 链路任何出口(取消/失败/成功)都会释放
let _grabInFlight = false;
function _release() { _grabInFlight = false; }

// 接单资格探针缓存(60s): 申请/考试/开关/实名成功后由调用方 invalidate
let _readyCache = null;
function invalidateTakeReadiness() { _readyCache = null; }
function fetchTakeReadiness(scene, force) {
  const now = Date.now();
  if (!force && _readyCache && (now - _readyCache.at) < 60000 && _readyCache.scene === (scene || '')) {
    return Promise.resolve(_readyCache.data);
  }
  return callCloud('partner-action', { action: 'take_readiness', scene: scene || '' }).then((r) => {
    if (r && r.ok && r.data) {
      _readyCache = { at: Date.now(), scene: scene || '', data: r.data };
      return r.data;
    }
    return null;
  }).catch(() => null);
}

// 按 missing 首项给出唯一出路(modal → 对应页面); 无出路项只做说明
function _guideTakeMissing(rd, demand) {
  const miss = (rd && rd.missing) || [];
  const first = miss[0] || '';
  const go = (url, failTab) => wx.navigateTo({ url, fail: () => { if (failTab) wx.switchTab({ url: failTab, fail: () => {} }); } });
  if (first === 'realname') {
    require('./bootstrap.js').showRealnameGuide('完成实名认证后即可接单。');
    return;
  }
  if (first === 'review_pending') {
    wx.showModal({
      title: '申请审核中',
      content: '你的耍伴入驻申请已提交，审核通过后将自动开通接单权限，通常 24 小时内完成。',
      showCancel: false, confirmText: '我知道了'
    });
    return;
  }
  if (first === 'reapply') {
    wx.showModal({
      title: '申请未通过',
      content: (rd.review_note ? '原因：' + rd.review_note + '\n' : '') + '可修改资料后重新提交申请。',
      confirmText: '重新申请', cancelText: '稍后',
      success: (r) => { if (r.confirm) go('/pages-v2/pkg-low/partner-apply/partner-apply', '/pages-v2/profile/profile'); }
    });
    return;
  }
  if (first === 'apply' || first === 'role') {
    wx.showModal({
      title: first === 'role' ? '开通接单权限' : '还不是耍伴',
      content: first === 'role'
        ? '你的资料已通过审核，重新提交一次即可激活接单权限。'
        : '接单前需先申请成为耍伴：选择可接的场景与日常位置，提交后由平台审核。',
      confirmText: '去申请', cancelText: '暂不',
      success: (r) => { if (r.confirm) go('/pages-v2/pkg-low/partner-apply/partner-apply', '/pages-v2/profile/profile'); }
    });
    return;
  }
  if (first === 'base_exam') {
    wx.showModal({
      title: '需先通过基础考试',
      content: `接单前需通过耍伴基础考试（满分 100，通过线 ${rd.base_pass_line || 100} 分），可多次重考。`,
      confirmText: '去考试', cancelText: '稍后',
      success: (r) => { if (r.confirm) go('/pages-v2/pkg-low/exam-status/exam-status', '/pages-v2/profile/profile'); }
    });
    return;
  }
  if (first === 'scene_exam') {
    const nm = (demand && getScene(demand.scene_code) && getScene(demand.scene_code).name) || '该场景';
    wx.showModal({
      title: '需通过场景考试',
      content: `接「${nm}」需求需先通过对应场景考试，可在考试认证页查看并参加。`,
      confirmText: '去考试', cancelText: '稍后',
      success: (r) => { if (r.confirm) go('/pages-v2/pkg-low/exam-status/exam-status', '/pages-v2/profile/profile'); }
    });
    return;
  }
  if (first === 'ec') {
    // 批3b(2026-10-23): 接单链紧急联系人前置; 申请不拦(C-3.26)
    wx.showModal({
      title: '需完善紧急联系人',
      content: '接单前需先填写紧急联系人信息，用于平台风控与 SOS 求助场景。',
      confirmText: '去填写', cancelText: '稍后',
      success: (r) => { if (r.confirm) go('/pages-v2/pkg-low/contacts/contacts', '/pages-v2/profile/profile'); }
    });
    return;
  }
  if (first === 'switch_off') {
    wx.showModal({
      title: '接单开关已关闭',
      content: '你当前处于暂停接单状态，开启后可继续接单。',
      confirmText: '去开启', cancelText: '稍后',
      success: (r) => { if (r.confirm) go('/pages-v2/pkg-low/accept-config/accept-config', '/pages-v2/profile/profile'); }
    });
    return;
  }
  if (first === 'credit_low') {
    wx.showModal({
      title: '信用分不足',
      content: `当前耍伴信用分 ${rd.credit_score || 0}，低于接单门槛 ${rd.min_credit || 600}，暂时无法接单。`,
      showCancel: false, confirmText: '我知道了'
    });
    return;
  }
  wx.showModal({ title: '暂时无法接单', content: '请稍后重试，或前往「我的」查看入驻进度。', showCancel: false });
}

// 服务端拒绝码 → 引导; 手续类(code)重新探针后按 missing 分流, 配置类直达接单配置页
function _guideByServerCode(r2, demand) {
  const bs = require('./bootstrap.js');
  const code = (r2 && r2.code) || '';
  if (code === 'order_realname_required') { bs.showRealnameGuide(r2.msg); return; }
  if (code === 'order_not_partner') {
    _guideTakeMissing({ missing: ['apply'] }, demand);
    return;
  }
  if (code === 'order_ec_required') {
    // 批3b': 服务端 EC 硬门禁(3b 仅探针, 该码预留; 命中即按缺项分流)
    _guideTakeMissing({ missing: ['ec'] }, demand);
    return;
  }
  if (code === 'order_not_approved' || code === 'order_base_exam_required' || code === 'order_scene_exam_required') {
    // 缓存可能陈旧(刚审核通过/刚考完): 强制刷新探针, 按真实缺项分流
    fetchTakeReadiness(demand && demand.scene_code, true).then((rd) => {
      if (rd && rd.can_take === false) { _guideTakeMissing(rd, demand); return; }
      wx.showModal({ title: '无法接单', content: (r2 && r2.msg) || '接单失败,请稍后重试', showCancel: false });
    }).catch(() => {
      wx.showModal({ title: '无法接单', content: (r2 && r2.msg) || '接单失败,请稍后重试', showCancel: false });
    });
    return;
  }
  if (code === 'order_switch_off') {
    _guideTakeMissing({ missing: ['switch_off'] }, demand);
    return;
  }
  if (code === 'order_credit_low') {
    _guideTakeMissing({ missing: ['credit_low'], credit_score: 0, min_credit: 600 }, demand);
    return;
  }
  if (code === 'order_scene_not_accepted' || code === 'order_slot_not_covered' ||
      code === 'order_rate_out_of_range' || code === 'order_total_out_of_range') {
    wx.showModal({
      title: '不符合你的接单偏好',
      content: (r2.msg || '') + '\n可在接单配置中调整场景/时段/价格区间。',
      confirmText: '去调整', cancelText: '知道了',
      success: (r) => {
        if (r.confirm) wx.navigateTo({ url: '/pages-v2/pkg-low/accept-config/accept-config', fail: () => wx.switchTab({ url: '/pages-v2/profile/profile', fail: () => {} }) });
      }
    });
    return;
  }
  wx.showModal({ title: '无法接单', content: (r2 && r2.msg) || '接单失败,请稍后重试', showCancel: false });
}

function takeOrder(demand, opts) {
  if (_grabInFlight) return;
  if (!demand || !demand._id) {
    wx.showToast({ title: '需求数据异常', icon: 'none' });
    return;
  }
  // 统一守卫(四态): 访客→登录引导; 未实名→实名引导; 再校验平台总开关
  try {
    const { gateOnboard, guardSwitch } = require('./bootstrap.js');
    if (!gateOnboard('take', '接单', { demand_id: demand._id, scene: demand.scene_code || '' })) return;
    if (!guardSwitch('access')) return;
  } catch (e) {}
  // 接单资格探针(服务端权威): 待审核/驳回/未考试/开关关闭 在这里一次拦下并给出出路;
  // 探针失败或超时 → fail-open 继续走原链路, 最终以 order-create 拒绝码兜底
  _grabInFlight = true;
  fetchTakeReadiness(demand.scene_code).then((rd) => {
    if (rd && rd.can_take === false) {
      _release();
      _guideTakeMissing(rd, demand);
      return;
    }
    _afterGate(demand, opts);
  }).catch(() => { _afterGate(demand, opts); });
}

// 通过资格探针后的原接单链路(选单模式 → 免责 → 定位 → 建单)
function _afterGate(demand, opts) {
  // 选单模式接单走报名→确认流程(P1-12), P0 仅支持抢单 broadcast
  if (demand.match_mode === 'select') {
    _release();
    wx.showToast({ title: '选单需求请通过报名流程接单(即将上线)', icon: 'none' });
    return;
  }
  const scene = getScene(demand.scene_code);
  const d = scene && scene.disclaimer;
  if (d) {
    // ④⑤ 分流: 单次只读拿到 signed(同场景免责已签) + certified(已开通该场景权限)
    // - certified && signed → 一键接单: 一次确认(免免责 modal) → 定位 → 建单
    // - !signed            → 弹免责 modal(首次需签署; 网络异常也走此兜底)
    // - signed && !certified → 维持 ④ 直走定位(后端 order_scene_not_accepted 清晰拒绝)
    _grabInFlight = true;
    callCloud('order-create', { action: 'check_signed', scene: demand.scene_code }).then((r) => {
      const d0 = (r && r.data) || {};
      if (d0.signed && d0.certified) {
        // 一键接单: 免责已签 + 权限已开 → 单次确认后进入定位+建单
        wx.showModal({
          title: scene.name || '一键接单',
          content: `${scene.name || ''}场景免责声明已签署,接单权限已开通。确认接单后将获取定位并创建订单。`,
          confirmText: '一键接单', // 上限 4 字符
          cancelText: '再想想',
          success: (mr) => { if (mr.confirm) _locate(demand, opts); else _release(); },
          fail: () => { _release(); _showDisclaimer(d, demand, opts); } // 弹窗失败兜底回免责(不阻断)
        });
      } else if (d0.signed) {
        _locate(demand, opts);
      } else {
        _showDisclaimer(d, demand, opts);
      }
    }).catch(() => {
      _showDisclaimer(d, demand, opts);
    });
  } else {
    _grabInFlight = true;
    _locate(demand, opts);
  }
}

// 免责声明用 wx.showModal(真机稳定, 与发布侧弹法统一, 禁用 bottom-sheet)
// 注意: confirmText 上限 4 字符, 超限真机上弹窗不渲染且无反应(教训已入 skill)
function _showDisclaimer(d, demand, opts) {
  wx.showModal({
    title: d.title,
    content: d.content,
    confirmText: '同意接单',
    cancelText: '不同意',
    success: (r) => {
      if (r.confirm) _locate(demand, opts); else _release();
    },
    fail: (err) => {
      // 静默失败兜底: 弹窗渲染失败时给出可见反馈, 不允许无反应
      console.error('[takeOrder] showModal fail:', err);
      wx.showToast({ title: '弹窗加载失败,请重试', icon: 'none' });
      _release();
    }
  });
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
          if (!r.confirm) { _release(); return; }
          wx.chooseLocation({
            success: (loc) => {
              _signThenCreate(demand, { latitude: loc.latitude, longitude: loc.longitude }, opts);
            },
            fail: () => {
              wx.showToast({ title: '未选择位置,无法接单', icon: 'none' });
              _release();
            }
          });
        }
      });
    }
  });
}

// 审计留痕: 统一注入设备摘要(仅接单关键动作, 走本文件 callFunction 的调用携带)
function _deviceInfo() {
  try {
    const s = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    return `${s.brand || ''} ${s.model || ''}|${s.system || ''}|${s.platform || ''}`.trim().slice(0, 200);
  } catch (e) { return ''; }
}

function _signThenCreate(demand, loc, opts) {
  wx.showLoading({ title: '接单中...', mask: true });
  callCloud('order-create', Object.assign({ action: 'sign_disclaimer', scene: demand.scene_code }, { device: _deviceInfo() })).then((r) => {
    if (!r.ok) {
      wx.hideLoading();
      wx.showToast({ title: r.msg || '签署失败,请重试', icon: 'none' });
      _release();
      return;
    }
    return callCloud('order-create', Object.assign({
      action: 'create_from_take',
      demand_id: demand._id,
      partner_location: loc
    }, { device: _deviceInfo() })).then((r2) => {
      wx.hideLoading();
      if (r2.ok && r2.data) {
        _release(); // 成功路径在跳转前释放, 防止返回广场后无法再次抢单
        try { require('./report.js').report('order_take', { demand_id: demand && demand._id }); } catch (e) {}
        if (opts && opts.onSuccess) opts.onSuccess(r2.data);
      } else if (_isNetUncertain(r2)) {
        // 写操作不重试, 超时/断链由 cloudCall resolve 成错误码 → 与旧直调 reject 同义, 走捞回
        _recoverTakeResult(demand, opts);
      } else {
        // 服务端拒绝码兜底(前端探针缓存陈旧/被绕过时): 手续类给按钮, 其余只说明
        _guideByServerCode(r2, demand);
        _release();
        if (opts && opts.onError) opts.onError(r2);
      }
    });
  }).catch(() => {
    wx.hideLoading();
    _recoverTakeResult(demand, opts);
  });
}

// 网络异常兜底: 可能是"订单已建但响应未达"(云函数超时/网关断链), 查询捞回而不是直接失败
function _recoverTakeResult(demand, opts) {
  callCloud('order-create', { action: 'check_take_result', demand_id: demand._id }).then((r) => {
    const crr = (r && r.data) || {};
    if (crr.state === 'taken' && crr.order_id) {
      // 已建单: 捞回跳转, 提示网络慢但订单已生效
      _release();
      if (opts && opts.onSuccess) opts.onSuccess({ order_id: crr.order_id, order_no: crr.order_no, status: crr.status, recovered: true });
      return;
    }
    if (crr.state === 'released') {
      wx.showToast({ title: '接单中断,需求已释放,请重试', icon: 'none' });
      _release();
      return;
    }
    wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    _release();
  }).catch(() => {
    wx.showToast({ title: '网络异常,请重试', icon: 'none' });
    _release();
  });
}

module.exports = { takeOrder, fetchTakeReadiness, invalidateTakeReadiness };
