// @VERIFIED 2026-10-13 已真机验证：隐私协议页 __usePrivacyCheck__ 配置（依据：project_memory L167）
// pages-v2/privacy/privacy.js
Page({
  data: { title: '隐私政策' },
  onShareAppMessage() {
    return {
      title: '找个人帮忙',
      path: '/pages-v2/index/index'
    };
  }
});
