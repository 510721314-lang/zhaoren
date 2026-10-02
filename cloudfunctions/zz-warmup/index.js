// zz-warmup 首屏云函数保温探针(S9 性能优化)
// 目的: 定时唤醒首屏关键云函数(home-action / user-login), 规避实例休眠冷启动
//       实测冷启动 ~1.6-1.9s → 保温后热态 ~0.3s, 首页冷启可交互 1.9s → 0.6-0.9s
// 触发: ① 定时触发器每 5 分钟(仅白天时段, cron 见 config.json)
//       ② 云端测试面板手动 {"action":"run"} 验证(手动调用不受时段限制)
// 安全原则:
//   - 只调用「只读 / 无 openid 也安全 / 零写入副作用」的轻量 action
//   - 各目标独立 try/catch + 超时竞速, 单目标失败不影响其他
//   - 幂等: 重复执行无副作用, 可安全高频触发
// 调用量预算: 白天 16h × 12 次/h = 192 次/天; 每次唤醒 2 个目标 = 576 次/天
//   ≈ 1.7 万次/月, 在云开发基础版调用次数额度(40 万次/月)内, 占比 ~4%
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 保温目标(action 必须经审核确认只读无副作用):
// - home-action scene_groups: 场景分组, 实例内存缓存命中时近零 DB; 匿名可访问
// - user-login peek_login: 云函数间调用 OPENID 为空 → 查空号返回 found:false, 不建号/不写库
const TARGETS = [
  { name: 'home-action', data: { action: 'scene_groups' } },
  { name: 'user-login', data: { action: 'peek_login' } }
];

const ACTIVE_START = 7;    // 北京时间 07:00 起(含)
const ACTIVE_END = 23;     // 23:00 后不再唤醒(省调用次数)
const CALL_TIMEOUT_MS = 8000;

// 显式按 UTC+8 取小时, 不依赖运行实例本地时区配置
function bjHour() {
  return new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
}

// 超时竞速: 定时器 resolve(不 reject), 避免未处理的 Promise 拒绝
function withTimeout(promise, ms) {
  let timer;
  const timeoutP = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), ms);
  });
  return Promise.race([promise, timeoutP]).then((v) => {
    clearTimeout(timer);
    return v;
  });
}

async function warmOne(target) {
  const t0 = Date.now();
  try {
    const r = await withTimeout(cloud.callFunction({ name: target.name, data: target.data }), CALL_TIMEOUT_MS);
    if (r && r.__timeout) return { target: target.name, ok: false, code: 'warm_timeout', ms: Date.now() - t0 };
    return { target: target.name, ok: !!(r && r.result && r.result.ok), ms: Date.now() - t0 };
  } catch (e) {
    return { target: target.name, ok: false, ms: Date.now() - t0, err: String((e && e.message) || e).slice(0, 120) };
  }
}

exports.main = async (event) => {
  const manual = !!(event && event.action === 'run');
  const hour = bjHour();
  const inWindow = hour >= ACTIVE_START && hour < ACTIVE_END;

  // 定时触发且处于非活跃时段: 直接跳过, 不唤起目标函数(手动 run 不受限, 便于随时验证)
  if (!manual && !inWindow) {
    return { ok: true, skipped: true, reason: 'out_of_active_window', hour };
  }

  const results = await Promise.all(TARGETS.map(warmOne));
  return {
    ok: true,
    manual,
    hour,
    results,
    ts: Date.now()
  };
};
