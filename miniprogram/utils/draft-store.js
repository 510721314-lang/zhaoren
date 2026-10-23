// miniprogram/utils/draft-store.js · 发布页「草稿箱/自动保存」服务模块
// 拆分阶段3 B(2026-10-16): 原 publish.js 方法逐字迁出(用户书面批准, 方案 §3 阶段3·先 B); 接收 page
// 设计: 只搬不改逻辑; 禁 getApp()/globalData(方案 §5.8); 页面 publish.js 留同名薄代理, 全部调用点零改
// 迁出源: publish.js fmtTime(现 L352) / _saveDraftCloud→saveDraftCloud(现 L362) / openDraftBox(现 L383)
//   / closeDraftBox(现 L398) / restoreDraft(现 L401) / startAutoSave(现 L852) / saveDraft(现 L859)
// 注: 页面 _buildDraftData 薄代理(L358)按方案保持不动; saveDraftCloud 体内直接调 buildDraftData(page.data.form)
//   (与该薄代理体逐字同式); bottom-sheet 弹层 wxml/wxss 按方案留页面不迁

const { callCloud } = require('./cloud.js');
const { buildDraftData } = require('./publish-validate.js');
const CONFIG = require('../config/index.js');

// 迁自 publish.js fmtTime(纯函数, 不依赖 page)
function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 迁自 publish.js _saveDraftCloud(云端保存草稿; 手动存草稿与自动保存共用, draft_id 存在则更新)
function saveDraftCloud(page, silent) {
  return callCloud('demand-publish', {
    action: 'save_draft',
    draft_id: page.__draftId || '',
    demand_data: buildDraftData(page.data.form)
  }).then((r) => {
    if (!r.ok) {
      if (!silent) wx.showToast({ title: r.msg || '草稿保存失败', icon: 'none' });
      return null;
    }
    if (r.data && r.data.draft_id) page.__draftId = r.data.draft_id;
    page.setData({
      autoSaveText: silent ? `${CONFIG.DRAFT.autoSaveSec}秒前` : '刚刚',
      draftCount: Math.max(page.data.draftCount, 1)
    });
    return r.data;
  }).catch(() => {
    if (!silent) wx.showToast({ title: '网络异常，保存失败', icon: 'none' });
    return null;
  });
}

// 迁自 publish.js openDraftBox
function openDraftBox(page) {
  page.setData({ draftBoxVisible: true });
  callCloud('demand-publish', { action: 'list_drafts' }).then((r) => {
    if (!r.ok) {
      wx.showToast({ title: r.msg || '草稿拉取失败', icon: 'none' });
      return;
    }
    const list = (r.data.list || []).map((d) => ({
      _id: d._id,
      demand_data: d.demand_data || {},
      saved_at: d.updated_at ? fmtTime(d.updated_at) : ''
    }));
    page.setData({ draftList: list, draftCount: list.length });
  }).catch(() => wx.showToast({ title: '网络异常', icon: 'none' }));
}

// 迁自 publish.js closeDraftBox
function closeDraftBox(page) {
  page.setData({ draftBoxVisible: false });
}

// 迁自 publish.js restoreDraft
function restoreDraft(page, e) {
  const idx = e.currentTarget.dataset.index;
  const draft = page.data.draftList[idx];
  if (!draft) return;
  const d = draft.demand_data;
  page.__draftId = draft._id;  // 后续保存/自动保存更新同一条草稿
  // 拆分前置2(2026-10-16): form 整对象替换 → 20 条叶子路径(行为等价; 为阶段3组件 properties 切片保证变更可达)
  // 同源维护: 与 pages-v2/publish/publish.js#_restorePublishSnapshot(P2-7 快照回填) 的 20 条路径保持一致——改一处必须改两处
  page.setData({
    'form.project_attr': d.project_attr || 'commercial',
    'form.pricing_type': d.pricing_type === 'fixed' ? 'fixed' : 'hourly',  // 老草稿无该字段 → 兜底 hourly
    'form.fixed_price': d.fixed_price != null ? String(d.fixed_price) : '',
    'form.scene_code': d.scene_code || '',
    'form.content_options': Array.isArray(d.content_options) ? d.content_options : [],
    'form.title': d.title || '',
    'form.description': d.description || '',
    'form.service_date': d.service_date || '',
    'form.service_time': d.service_time || '',
    'form.duration_hours': d.duration_hours || 3,
    'form.duration_custom': '',
    'form.location_name': d.location ? d.location.name : '',
    'form.latitude': (d.location && d.location.latitude) || 0,
    'form.longitude': (d.location && d.location.longitude) || 0,
    'form.headcount': d.headcount || 1,
    'form.budget': String(d.budget || ''),
    'form.aa_estimate': d.aa_estimate || '',
    'form.aa_custom': '',
    'form.gender_pref': d.gender_pref || '不限',
    'form.match_mode': d.match_mode || 'broadcast',
    titleCount: (d.title || '').length,
    descCount: (d.description || '').length,
    draftBoxVisible: false
  });
  wx.showToast({ title: '草稿已恢复', icon: 'none' });
}

// 迁自 publish.js startAutoSave(B10 自动保存: 云端 upsert 草稿; 静默失败不打扰用户)
function startAutoSave(page) {
  page._saveTimer = setInterval(() => {
    const f = page.data.form;
    if (!f.title && !f.description) return;
    saveDraftCloud(page, true);
  }, CONFIG.DRAFT.autoSaveSec * 1000);
}

// 迁自 publish.js saveDraft
function saveDraft(page) {
  const f = page.data.form;
  if (!f.title && !f.description) {
    wx.showToast({ title: '请先填写内容', icon: 'none' });
    return;
  }
  saveDraftCloud(page, false).then((d) => {
    if (d) wx.showToast({ title: `草稿已保存（有效期${CONFIG.DRAFT.expireDays}天）`, icon: 'success' });
  });
}

module.exports = { fmtTime, saveDraftCloud, openDraftBox, closeDraftBox, restoreDraft, startAutoSave, saveDraft };
