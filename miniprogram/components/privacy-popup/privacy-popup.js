// components/privacy-popup - 微信官方隐私保护指引授权弹窗
// 用法: 页面 json 注册 privacy-popup; wxml 放 <privacy-popup id="privacyPopup" />;
//       调用隐私接口(getLocation/chooseLocation/chooseMedia 等)前:
//       const ok = await this.selectComponent('#privacyPopup').ensure(); if (!ok) return;
// 机制: __usePrivacyCheck__=true 时, 隐私接口必须用户先同意《用户隐私保护指引》;
//       同意只能由 <button open-type="agreePrivacyAuthorization"> 触发(基础库 2.32.3+)。
Component({
  data: {
    show: false,
    contractName: '用户隐私保护指引'
  },

  lifetimes: {
    attached() {
      this._waiters = [];
    }
  },

  methods: {
    // 返回 Promise<boolean>: true=已授权(或无需授权/老基础库)  false=用户拒绝
    ensure() {
      return new Promise((resolve) => {
        if (typeof wx.getPrivacySetting !== 'function') {
          resolve(true);
          return;
        }
        wx.getPrivacySetting({
          success: (res) => {
            if (!res.needAuthorization) {
              resolve(true);
              return;
            }
            this._waiters.push(resolve);
            this.setData({
              show: true,
              contractName: res.privacyContractName || '用户隐私保护指引'
            });
          },
          fail: () => resolve(true) // 查询异常不阻断业务
        });
      });
    },

    // 查看指引全文
    openContract() {
      if (wx.openPrivacyContract) {
        wx.openPrivacyContract({ fail: () => {} });
      }
    },

    // 点击「同意」按钮(open-type=agreePrivacyAuthorization, 微信已记录同意)
    onAgree() {
      this.setData({ show: false });
      const waiters = this._waiters || [];
      this._waiters = [];
      waiters.forEach((fn) => fn(true));
    },

    // 拒绝
    onDisagree() {
      this.setData({ show: false });
      const waiters = this._waiters || [];
      this._waiters = [];
      waiters.forEach((fn) => fn(false));
    },

    // 阻止遮罩触摸穿透
    noop() {}
  }
});
