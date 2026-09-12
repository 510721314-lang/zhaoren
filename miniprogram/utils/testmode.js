// utils/testmode.js - 自测模式开关(仅开发/真机自测用, 上线前必须删除入口并确认默认关闭)
// 作用: 真机隐私接口(位置)未在后台声明/未生效期间, 开启后定位相关流程降级为成都默认坐标,
//       使发布→接单→履约全流程可在真机继续测试。
// 默认: 关闭。普通用户无入口(我的页长按版本号), 存储键不落业务数据。
const KEY = 'dev_test_mode';

function isTestMode() {
  try {
    return wx.getStorageSync(KEY) === true;
  } catch (e) {
    return false;
  }
}

function setTestMode(on) {
  try {
    wx.setStorageSync(KEY, on === true);
  } catch (e) {}
  return on === true;
}

module.exports = { isTestMode, setTestMode, KEY };
