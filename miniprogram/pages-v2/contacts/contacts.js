// pages-v2/contacts/contacts.js · 紧急联系人管理(1~2 名)
// 数据源: user-login get_emergency_contact(回显) / set_emergency_contact(保存)
// 用途: 发布需求前置校验 + 安全求助时展示
function callCloud(name, data) {
  return wx.cloud.callFunction({ name, data }).then((r) => r.result || {});
}

Page({
  data: {
    c1: { name: '', phone: '', relation: '' },
    c2: { name: '', phone: '', relation: '' },
    hasSecond: false,
    saving: false,
    loading: true
  },

  onLoad() {
    callCloud('user-login', { action: 'get_emergency_contact' }).then((r) => {
      const contacts = (r.ok && r.data && r.data.contacts) || [];
      const patch = { loading: false };
      if (contacts[0]) patch.c1 = contacts[0];
      if (contacts[1]) {
        patch.c2 = contacts[1];
        patch.hasSecond = true;
      }
      this.setData(patch);
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  // 统一输入处理: data-path="c1.name"
  onInput(e) {
    const path = e.currentTarget.dataset.path;
    this.setData({ [path]: e.detail.value });
  },

  toggleSecond() {
    const next = !this.data.hasSecond;
    const patch = { hasSecond: next };
    if (!next) patch.c2 = { name: '', phone: '', relation: '' };
    this.setData(patch);
  },

  save() {
    if (this.data.saving) return;
    const c1 = {
      name: (this.data.c1.name || '').trim(),
      phone: (this.data.c1.phone || '').trim(),
      relation: (this.data.c1.relation || '').trim()
    };
    if (!c1.name || !c1.phone || !c1.relation) {
      wx.showToast({ title: '请完整填写第一联系人', icon: 'none' });
      return;
    }
    if (!/^1\d{10}$/.test(c1.phone)) {
      wx.showToast({ title: '第一联系人手机号有误', icon: 'none' });
      return;
    }
    const contacts = [c1];
    if (this.data.hasSecond) {
      const c2 = {
        name: (this.data.c2.name || '').trim(),
        phone: (this.data.c2.phone || '').trim(),
        relation: (this.data.c2.relation || '').trim()
      };
      if (!c2.name || !c2.phone || !c2.relation) {
        wx.showToast({ title: '请完整填写第二联系人', icon: 'none' });
        return;
      }
      if (!/^1\d{10}$/.test(c2.phone)) {
        wx.showToast({ title: '第二联系人手机号有误', icon: 'none' });
        return;
      }
      contacts.push(c2);
    }

    this.setData({ saving: true });
    callCloud('user-login', { action: 'set_emergency_contact', contacts }).then((r) => {
      this.setData({ saving: false });
      if (r.ok) {
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => wx.navigateBack({ fail: () => {} }), 700);
      } else {
        wx.showToast({ title: r.msg || '保存失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ saving: false });
      wx.showToast({ title: '网络异常', icon: 'none' });
    });
  }
});
