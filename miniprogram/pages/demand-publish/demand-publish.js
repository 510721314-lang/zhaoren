// pages/demand-publish/demand-publish.js - 需求发布
// 场景单选(首页带入自动预选) / 内容单选 / 时间date+time(距发布≤30天) / 时长滑条 /
// 双地址: 发布地址=发布时实际GPS(只读留痕) + 履约地址=用户地图自选(接单距离/通勤依据) /
// 时薪滑条 / 费用自动计算 / AA档位+《线下费用自理承诺书》 / 备注预检 / 提交→top5→匹配页
const app = getApp();
const { SCENE_LIST, AA_TIERS } = require('../../utils/constants.js');

// 从地址文本剥掉省/自治区前缀后取段首「XX市」, 结果不带「市」后缀(如「四川省成都市…」→「成都」)
function parseCity(addr) {
  if (!addr) return '';
  const stripped = addr.replace(/^(.+?省|.+?自治区|内蒙古|广西|西藏|宁夏|新疆)/, '');
  const m = stripped.match(/^([^市]+市)/);
  return m ? m[1].replace(/市$/, '') : '';
}

const REMARK_MAX_LEN = 200;
const MAX_ADVANCE_DAYS = 30;          // 服务时间距发布最长 30 天
// 备注前端预检违禁词(服务端 msgSecCheck 复检兜底)
const BLOCK_WORDS = ['加微信', '加V', '转账', '私聊我'];
// AA 承诺书全文(rules.md 三.6)
const AA_PROMISE_TEXT = 'AA 费用为线下共同消费，本人自行承担本人份额，平台不代收、不担保、不仲裁 AA 费用争议。';

Page({
  data: {
    scenes: SCENE_LIST,
    selectedScene: '',
    currentOptions: [],        // [{name, checked}] 当前场景内容项(JS 预处理,WXML 不调方法)
    // 时间(默认明天 10:00; 最晚今天+30天)
    dateStr: '',
    timeStr: '10:00',
    minDate: '',
    maxDate: '',
    // 时长(滑条 1-12 小时)
    durationH: 2,
    // 发布地址: 发布时实际GPS定位(只读, 留痕; 不可手动修改)
    locating: false,
    pubLocationName: '',
    pubLatitude: 0,
    pubLongitude: 0,
    pubCity: '成都',
    // 履约地址: 用户在地图上自主选择(接单距离/通勤依据)
    siteName: '',
    siteLatitude: 0,
    siteLongitude: 0,
    siteCity: '',
    // 时薪(滑条 30-100 元)
    rateYuan: 50,
    rateMin: 30,
    rateMax: 100,
    totalYuan: 100,            // 时薪×时长(整数元展示;金额以分为准)
    // AA
    aaTiers: AA_TIERS,
    selectedAaTier: '0-50',    // 默认 0-50 元档
    aaPromiseChecked: false,
    aaPromiseText: AA_PROMISE_TEXT,
    // 备注
    remark: '',
    remarkMax: REMARK_MAX_LEN,
    submitting: false
  },

  onLoad(options) {
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
    const maxDay = new Date(today.getTime() + MAX_ADVANCE_DAYS * 24 * 3600 * 1000);
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const patch = {
      minDate: fmt(today), maxDate: fmt(maxDay),
      dateStr: fmt(tomorrow), timeStr: '10:00'
    };

    // 首页五宫格带场景进入 → 预选(不恢复草稿, 每次进入都是全新表单)
    if (options && options.scene && SCENE_LIST.some((s) => s.code === options.scene)) {
      patch.selectedScene = options.scene;
      // 搜索结果带具体服务项 → 一并预选(rebuildOptions 优先消费 _restoredOptions)
      if (options.opt) {
        const sc = SCENE_LIST.find((s) => s.code === options.scene);
        const optName = decodeURIComponent(options.opt);
        if (sc && sc.options.indexOf(optName) >= 0) this._restoredOptions = [optName];
      }
    }
    // 清理历史版本遗留草稿(旧版有自动存草稿, 新版不再使用)
    try { wx.removeStorageSync('demand_publish_draft_v1'); } catch (e) {}

    this.setData(patch, () => this.rebuildOptions());
    // 进入页面即定位, 记录发布者实际位置(发布地址, 只读)
    this.locate();
  },

  // ───────── 发布地址(发布时实际GPS定位, 只读留痕, 不可手动修改) ─────────
  // 逆地址解析: 配置腾讯地图 key 后取真实地址; 未配置兜底「当前位置/成都」
  reverseLocation(lat, lng, cb) {
    const MAP_KEY = '';
    if (!MAP_KEY) {
      cb({ name: '当前位置', city: '成都' });
      return;
    }
    wx.request({
      url: `https://apis.map.qq.com/ws/geocoder/v1/?location=${lat},${lng}&key=${MAP_KEY}`,
      success: (r) => {
        const res = r.data && r.data.result;
        const city = res && res.address_component && res.address_component.city;
        const name = (res && res.formatted_addresses && res.formatted_addresses.recommend)
          || (res && res.address) || '当前位置';
        cb({ name, city: (city || '成都').replace(/市$/, '') });
      },
      fail: () => cb({ name: '当前位置', city: '成都' })
    });
  },

  // 获取当前GPS位置(发布者实际位置; 点击发布地址卡可重新定位)
  async locate() {
    if (this.data.locating) return;
    const ok = await getApp().requirePrivacyAuth();
    if (!ok) return;
    this.setData({ locating: true });
    wx.getLocation({
      type: 'gcj02',
      success: (loc) => {
        this.reverseLocation(loc.latitude, loc.longitude, (info) => {
          this.setData({
            locating: false,
            pubLatitude: loc.latitude,
            pubLongitude: loc.longitude,
            pubLocationName: info.name,
            pubCity: info.city || '成都'
          });
        });
      },
      fail: () => {
        this.setData({ locating: false });
        wx.showModal({
          title: '需要位置权限',
          content: '发布地址需记录您发布时的实际位置，请在设置中允许使用位置信息',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) {
              wx.openSetting({
                success: (s) => {
                  if (s.authSetting && s.authSetting['scope.userLocation']) this.locate();
                }
              });
            }
          }
        });
      }
    });
  },

  // 点击发布地址卡: 重新获取当前位置(仍是实际GPS, 不允许手选)
  onPubLocationTap() {
    this.locate();
  },

  // ───────── 履约地址(用户在地图上自主选择) ─────────
  async chooseSite() {
    const ok = await getApp().requirePrivacyAuth();
    if (!ok) return;
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          siteName: res.name || res.address,
          siteLatitude: res.latitude,
          siteLongitude: res.longitude,
          siteCity: parseCity(res.address) || '成都'
        });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
          wx.showModal({
            title: '需要位置权限',
            content: '请在设置中允许使用位置信息，才能在地图上选择履约地点',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) {
                wx.openSetting({
                  success: (s) => {
                    if (s.authSetting && s.authSetting['scope.userLocation']) this.chooseSite();
                  }
                });
              }
            }
          });
        }
      }
    });
  },

  // ───────── 场景与内容 ─────────
  onSceneTap(e) {
    this.setData({ selectedScene: e.currentTarget.dataset.code }, () => this.rebuildOptions());
  },

  // 依据当前场景 + 已选内容,生成 WXML 直接消费的选项数组
  rebuildOptions() {
    const scene = SCENE_LIST.find((s) => s.code === this.data.selectedScene);
    let selected;
    if (this._restoredOptions) {
      selected = this._restoredOptions;
      this._restoredOptions = null;
    } else {
      selected = (this.data.currentOptions || []).filter((o) => o.checked).map((o) => o.name);
    }
    const currentOptions = scene
      ? scene.options.map((name) => ({ name, checked: selected.indexOf(name) >= 0 }))
      : [];
    this.setData({ currentOptions });
  },

  // 服务内容单选切换(同项再点取消, 异项互斥)
  onOptionToggle(e) {
    const name = e.currentTarget.dataset.option;
    const currentOptions = this.data.currentOptions.map((o) =>
      o.name === name ? { name: o.name, checked: !o.checked } : { name: o.name, checked: false }
    );
    this.setData({ currentOptions });
  },

  // ───────── 时间 / 时长 / 时薪 ─────────
  onDateChange(e) { this.setData({ dateStr: e.detail.value }); },
  onTimeChange(e) { this.setData({ timeStr: e.detail.value }); },
  onDurationChange(e) {
    const durationH = Number(e.detail.value);
    this.setData({ durationH, totalYuan: this.data.rateYuan * durationH });
  },
  onRateChange(e) {
    const rateYuan = Number(e.detail.value);
    this.setData({ rateYuan, totalYuan: rateYuan * this.data.durationH });
  },

  // ───────── AA ─────────
  onAaTierTap(e) {
    this.setData({ selectedAaTier: e.currentTarget.dataset.tier });
  },
  // 点击承诺书链接:弹窗展示全文,确认后视为已读并勾选
  onPromiseTap() {
    wx.showModal({
      title: '线下费用自理承诺书',
      content: AA_PROMISE_TEXT,
      showCancel: false,
      confirmText: '我已阅读',
      success: () => this.setData({ aaPromiseChecked: true })
    });
  },
  // 点击勾选框:未勾选时先弹承诺书全文,已勾选则取消
  onPromiseCheckTap() {
    if (this.data.aaPromiseChecked) {
      this.setData({ aaPromiseChecked: false });
    } else {
      this.onPromiseTap();
    }
  },

  // ───────── 备注 ─────────
  onRemarkInput(e) { this.setData({ remark: e.detail.value }); },
  // 前端预检(服务端 msgSecCheck 复检)
  preCheckRemark(text) {
    const lower = text.toLowerCase();
    return !BLOCK_WORDS.some((w) => lower.indexOf(w.toLowerCase()) >= 0);
  },

  // ───────── 提交 ─────────
  async onSubmit() {
    if (this.data.submitting) return;
    const d = this.data;

    if (!d.selectedScene) return wx.showToast({ title: '请选择服务场景', icon: 'none' });
    const selectedOptions = d.currentOptions.filter((o) => o.checked).map((o) => o.name);
    if (selectedOptions.length === 0) return wx.showToast({ title: '请选择服务内容', icon: 'none' });

    const ts = new Date(`${d.dateStr}T${d.timeStr}:00`).getTime();
    if (!ts || ts <= Date.now()) return wx.showToast({ title: '开始时间必须是未来', icon: 'none' });
    if (ts > Date.now() + MAX_ADVANCE_DAYS * 24 * 3600 * 1000) {
      return wx.showToast({ title: `服务时间距发布不能超过${MAX_ADVANCE_DAYS}天`, icon: 'none' });
    }
    if (!d.pubLocationName || !d.pubLatitude || !d.pubLongitude) {
      return wx.showToast({ title: '发布地址定位中，请稍候', icon: 'none' });
    }
    if (!d.siteName || !d.siteLatitude || !d.siteLongitude) {
      return wx.showToast({ title: '请选择履约地点', icon: 'none' });
    }

    // AA 承诺书必勾(rules.md 三.6)
    if (!d.aaPromiseChecked) {
      wx.showModal({
        title: '请先确认 AA 费用承诺书',
        content: AA_PROMISE_TEXT,
        confirmText: '我已阅读并同意',
        success: (r) => { if (r.confirm) this.setData({ aaPromiseChecked: true }); }
      });
      return;
    }

    const remark = (d.remark || '').trim();
    if (remark && !this.preCheckRemark(remark)) {
      return wx.showToast({ title: '备注含联系方式/转账等违规内容', icon: 'none' });
    }

    // 青少年保护前端预检(服务端兜底 · rules.md 三.10)
    const totalYuan = d.rateYuan * d.durationH;
    const u = app.globalData.userInfo;
    if (u && u.age >= 18 && u.age <= 22 && totalYuan > 200) {
      wx.showModal({
        title: '超出单笔金额上限',
        content: '18-22 岁用户单笔订单金额上限 200 元，请调低时薪或缩短时长',
        showCancel: false
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '定位中', mask: true });

    const locOk = await getApp().requirePrivacyAuth();
    if (!locOk) { wx.hideLoading(); this.setData({ submitting: false }); return; }

    // 提交瞬间重新取一次实际GPS作为发布地址(留痕, 不用页面缓存坐标); 履约地址用用户所选
    wx.getLocation({
      type: 'gcj02',
      success: (loc) => {
        this.reverseLocation(loc.latitude, loc.longitude, (info) => {
          const publishLocation = {
            name: info.name,
            latitude: loc.latitude,
            longitude: loc.longitude,
            city: info.city || '成都'
          };
          this.setData({
            pubLatitude: loc.latitude, pubLongitude: loc.longitude,
            pubLocationName: info.name, pubCity: publishLocation.city
          });
          const site = {
            name: this.data.siteName,
            latitude: this.data.siteLatitude,
            longitude: this.data.siteLongitude,
            city: this.data.siteCity || '成都'
          };
          this.doPublish(ts, selectedOptions, remark, site, publishLocation);
        });
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showModal({
          title: '需要位置权限',
          content: '发布地址需记录您发布时的实际位置，请在设置中允许使用位置信息后再发布',
          confirmText: '去设置',
          success: (r) => {
            if (r.confirm) wx.openSetting();
          }
        });
      }
    });
  },

  // 实际发布: location=履约地址(用户自选), publish_location=发布地址(fresh GPS)
  doPublish(ts, selectedOptions, remark, location, publishLocation) {
    const d = this.data;
    wx.showLoading({ title: '发布中', mask: true });
    wx.cloud.callFunction({
      name: 'demand-publish',
      data: {
        action: 'publish',
        scene: d.selectedScene,
        content_options: selectedOptions,
        start_time: ts,
        duration_h: d.durationH,
        location,
        publish_location: publishLocation,
        remark,
        rate_fen: d.rateYuan * 100,
        aa_tier: d.selectedAaTier,
        aa_promise_checked: true
      },
      success: (res) => {
        if (res.result && res.result.ok) {
          const demandId = res.result.data._id;
          // 发布成功 → 调 demand-match top5 预热候选 → 跳匹配页
          wx.cloud.callFunction({
            name: 'demand-match',
            data: { action: 'top5', demand_id: demandId },
            complete: () => {
              wx.hideLoading();
              this.setData({ submitting: false });
              wx.redirectTo({ url: `/pages/match/match?demand_id=${demandId}` });
            }
          });
        } else {
          wx.hideLoading();
          this.setData({ submitting: false });
          wx.showToast({ title: (res.result && res.result.msg) || '发布失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  }
});
