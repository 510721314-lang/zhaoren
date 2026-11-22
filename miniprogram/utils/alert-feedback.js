// miniprogram/utils/alert-feedback.js · 订单提示统一反馈模块(震动 + 提示音)
// 2026-11-22 用户批准方案: 收到订单相关提示信息后统一震动+提示音(开关可在「我的」页控制)
// 设计要点:
//   1) 单例 InnerAudioContext 复用, 播前 stop+seek(0), 避免多实例泄漏与叠加播放
//   2) 同类提示 2s 内节流, 防多条通知连响(轮询一次可能带回多条)
//   3) 开关落 Storage(settings:alert), 缺省均开启; 关掉后对应通道静默
//   4) 尊重系统静音(obeyMuteSwitch=true): iOS 静音时只震动不发声
// 边界: 小程序切后台/锁屏后定时器停止, 本模块无法触达; 仅真机生效, 模拟器无效果

const STORAGE_KEY = 'settings:alert';
const THROTTLE_MS = 2000;          // 同类提示最小间隔
const SOUND_SRC = '/assets/audio/notify.wav'; // 双音「叮咚」, 约 7.7KB

let audioCtx = null;
const lastAt = {};                 // kind -> 上次触发时间戳

// 读取开关配置(缺省全开; 存储损坏时回落缺省)
function getSettings() {
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    if (v && typeof v === 'object') {
      return { sound: v.sound !== false, vibrate: v.vibrate !== false };
    }
  } catch (e) {
    console.warn('[alert-feedback] 读取开关配置失败, 回落默认全开', e);
  }
  return { sound: true, vibrate: true };
}

// 合并写入开关配置, 返回最新值
function setSettings(patch) {
  const next = Object.assign(getSettings(), patch || {});
  try {
    wx.setStorageSync(STORAGE_KEY, next);
  } catch (e) {
    console.warn('[alert-feedback] 保存开关配置失败', e);
  }
  return next;
}

function ensureAudio() {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = wx.createInnerAudioContext();
    audioCtx.src = SOUND_SRC;
    audioCtx.obeyMuteSwitch = true; // 尊重系统静音开关
    audioCtx.onError(() => {});     // 播放失败静默, 不阻塞业务
  } catch (e) {
    console.warn('[alert-feedback] 初始化音频失败, 本次仅震动', e);
    audioCtx = null;
  }
  return audioCtx;
}

function playSound() {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    ctx.stop();
    ctx.seek(0);
    ctx.play();
  } catch (e) {
    console.warn('[alert-feedback] 播放提示音失败', e);
  }
}

// 震动强度按类型分级: urgent(改期/沟通待处理) 用 heavy, 其余 medium
const VIBRATE_OF = { urgent: 'heavy', order: 'medium', nearby: 'medium' };

function vibrate(kind) {
  if (typeof wx.vibrateShort !== 'function') return;
  try {
    wx.vibrateShort({ type: VIBRATE_OF[kind] || 'medium', fail: () => {} });
  } catch (e) {
    console.warn('[alert-feedback] 震动失败', e);
  }
}

// 统一入口: kind = 'order'(一般订单动态) | 'urgent'(待处理操作) | 'nearby'(附近新单)
// 返回是否真正触发(未触发=被节流或双通道均关闭)
function notify(kind) {
  const k = kind || 'order';
  const now = Date.now();
  if (lastAt[k] && now - lastAt[k] < THROTTLE_MS) return false;
  lastAt[k] = now;
  const s = getSettings();
  let did = false;
  if (s.vibrate) { vibrate(k); did = true; }
  if (s.sound) { playSound(); did = true; }
  return did;
}

module.exports = { notify, getSettings, setSettings };
