// utils/testmode.js - 自测模式开关
// 2026-09-15 P2 清理: 隐私指引已生效, 默认定位链路恢复正常。保留文件仅作降级兜底,
// 上线后如需临时绕过定位, 可把下面 return false 改 return true 快速恢复。
const KEY = 'dev_test_mode';

function isTestMode() {
  return false;
}

function setTestMode(on) {
  // 空操作: 上线后无入口可调此函数, 保留签名仅为兼容潜在调用方
  return false;
}

module.exports = { isTestMode, setTestMode, KEY };
