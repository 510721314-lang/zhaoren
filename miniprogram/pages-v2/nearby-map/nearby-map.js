// 附近地图: 实时定位共享(双向对称) — 打开上报本人位置, 展示已开启共享且在线(15min)的 TA
// 点 marker 卡片 → 耍伴看用户(去承接) / 用户看耍伴(定向邀请帮忙)
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {}).catch((e) => { console.error('[cloud]', name, e && e.message); return { ok: false, msg: '网络异常' }; });
}
function fmtDist(m) {
  if (!Number.isFinite(m) || m < 0) return '';
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}
const ICON_MARKER = '/images/marker.png';

Page({
  data: {
    my: { lat: 0, lng: 0 },
    markers: [],
    people: [],
    selected: null,       // 当前点开的 TA
    shareOn: false,
    locDenied: false,
    loading: true
  },

  onLoad() {
    this.init();
  },

  async init() {
    // 先读开关状态
    const peek = await callCloud('user-login', { action: 'peek_login' });
    if (peek.ok && peek.data && peek.data.found) {
      const mine = peek.data.user;
      const shareOn = mine.allow_map_share === true;
      this.setData({ shareOn });
      if (!shareOn) {
        this.setData({ loading: false });
      }
    }
    // 定位授权(无论开关, 先取自身坐标便于地图落点+算距离)
    const loc = await this.getMyLocation();
    if (loc) {
      this.setData({ my: { lat: loc.latitude, lng: loc.longitude } });
      // 已开共享才上报
      if (this.data.shareOn) {
        await callCloud('user-login', { action: 'report_map_gps', latitude: loc.latitude, longitude: loc.longitude });
      }
      this.setData({ locDenied: false });
    } else {
      this.setData({ locDenied: true });
    }
    await this.loadNearby();
    this.setData({ loading: false });
  },

  getMyLocation() {
    return new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        success: (r) => resolve({ latitude: r.latitude, longitude: r.longitude }),
        fail: () => resolve(null)
      });
    });
  },

  async loadNearby() {
    const r = await callCloud('user-login', { action: 'nearby_map_list' });
    const list = (r.ok && r.data && r.data.list) || [];
    const people = list.map((p) => ({
      openid: p.openid, nickname: p.nickname || 'TA', avatar: p.avatar || '',
      is_partner: p.is_partner, distanceText: fmtDist(p.distance_m)
    }));
    const markers = (list || []).filter((p) => p.lat && p.lng).map((p) => ({
      id: Number(p.openid.replace(/\D/g, '').slice(-8)) || Math.floor(Math.random() * 1e8),
      latitude: p.lat, longitude: p.lng,
      iconPath: ICON_MARKER, width: 36, height: 36,
      callout: { content: p.nickname || 'TA', color: '#1F2329', bgColor: '#FFFFFF', borderRadius: 8, padding: 6, display: 'BYCLICK' },
      openid: p.openid, is_partner: p.is_partner, distanceText: fmtDist(p.distance_m), nickname: p.nickname || 'TA', avatar: p.avatar || ''
    }));
    this.setData({ people, markers });
  },

  onMarkerTap(e) {
    const id = e.detail.markerId;
    const mk = (this.data.markers || []).find((m) => m.id === id);
    if (!mk) return;
    this.setData({
      selected: {
        openid: mk.openid, nickname: mk.nickname, avatar: mk.avatar,
        is_partner: mk.is_partner, distanceText: mk.distanceText
      }
    });
  },

  closeCard() { this.setData({ selected: null }); },

  // 推荐名: 定位授权引导
  onEnableLoc() {
    wx.getLocation({
      type: 'gcj02',
      success: (r) => { this.setData({ my: { lat: r.latitude, lng: r.longitude } }); this.init(); },
      fail: () => wx.showToast({ title: '定位授权失败', icon: 'none' })
    });
  },

  // 点 TA: 若 TA 是耍伴 → 看详情/可定向邀请帮忙; 若 TA 是用户 → 自己作为耍伴可去承接(进入其发布)
  onOpenTA() {
    const s = this.data.selected;
    if (!s) return;
    // TA 是耍伴
    if (s.is_partner) {
      wx.navigateTo({ url: `/pages-v2/partner-detail/partner-detail?partnerOpenid=${s.openid}`, fail: () => wx.showToast({ title: '详情页暂不可用', icon: 'none' }) });
    } else {
      // TA 是用户(需求发布者): 发起定向邀请帮忙
      const name = encodeURIComponent(s.nickname || '');
      wx.navigateTo({ url: `/pages-v2/publish/publish?invitePartnerOpenid=${s.openid}&invitePartnerName=${name}`, fail: () => wx.showToast({ title: '发布页暂不可用', icon: 'none' }) });
    }
  },

  // 顶部快捷开关
  onMapShareChange() {
    const shareOn = !this.data.shareOn;
    callCloud('user-login', { action: 'set_map_share', allow: shareOn }).then((r) => {
      if (r.ok) {
        this.setData({ shareOn });
        wx.showToast({ title: shareOn ? '已开启地图共享' : '已关闭地图共享', icon: 'none', duration: 1500 });
        this.init();
      } else {
        wx.showToast({ title: r.msg || '操作失败', icon: 'none' });
      }
    });
  },

  onRefresh() { this.init(); }
});