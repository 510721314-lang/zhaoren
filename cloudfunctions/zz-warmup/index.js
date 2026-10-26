// @VERIFIED 2026-10-13 已真机验证：zz-warmup cron 全天候每5分钟预热(约1.7万次/月,占基础版4%)+触发器更新走 tcb fn trigger 绕白名单（依据：project_memory L108, L266）
// zz-warmup 首屏云函数保温探针(S9 性能优化)
// 2026-10-26 用量治理：**定时触发器已全部下线（0 次/天）**，首屏冷启动回到 ~1.6-1.9s（功能无损）
//   原因：标准触发器(全天 288/天) + 微信云开发触发器(7-22 192/天) 并存 → 480 次/天 × 3 调用 = 1,440 次/天
//   恢复时（正式上线后）：只建一个触发器，cron `0 */15 7-22 * * * *`（64 次/天 × 3 = 192 次/天）
//   config.json 的 triggers 已清空，防止下次部署自动重建高频触发器
// 目的: 定时唤醒首屏关键云函数(home-action / user-login), 规避实例休眠冷启动
//       实测冷启动 ~1.6-1.9s → 保温后热态 ~0.3s, 首页冷启可交互 1.9s → 0.6-0.9s
// 触发: ① 定时触发器（2026-10-26 起已全部下线，仅保留手动/云端测试）
//       ② 云端测试面板手动 {"action":"run"} 验证(手动调用不受时段限制)
// 安全原则:
//   - 只调用「只读 / 无 openid 也安全 / 零写入副作用」的轻量 action
//   - 各目标独立 try/catch + 超时竞速, 单目标失败不影响其他
//   - 幂等: 重复执行无副作用, 可安全高频触发
// 调用量预算: 当前 0 次/天(触发器已下线); 恢复后 64 触发/天 × 3 调用 = 192 次/天
//   恢复前(5 分钟/全天)为 288 次/天 × 3 = 864 次/天, 叠加重复触发器曾达 1,440 次/天
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 保温目标(action 必须经审核确认只读无副作用):
// - home-action scene_groups: 场景分组, 实例内存缓存命中时近零 DB; 匿名可访问, 返回 ok:true
// - user-login peek_login: 云函数间调用 OPENID 为空, 在 user-login 入口统一鉴权处即返回
//   {ok:false, code:'login_no_openid'}, 不会建号/写库; 调用到达即唤醒实例, 保温判据见 warmOne
const TARGETS = [
  { name: 'home-action', data: { action: 'scene_groups' } },
  { name: 'user-login', data: { action: 'peek_login' } }
];

const ACTIVE_START = 0;    // 全天候保温: 北京时间 00:00 起(含)
const ACTIVE_END = 24;     // 上界 24:00, 覆盖 23:xx 全时段
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
    // 保温成功判据: 调用成功到达目标实例并在超时内返回, 即已达成「唤起容器、规避冷启动」的目的。
    // 不要求业务 result.ok===true —— 云函数互调没有 OPENID, user-login 入口会预期内统一返回
    // {ok:false, code:'login_no_openid'}, 但调用本身已把实例唤醒(实测热态 0.1s 返回), 保温有效。
    if (r && r.result) {
      const bizCode = r.result.code || (r.result.ok ? '' : 'biz_not_ok');
      return { target: target.name, ok: true, warmed: true, bizCode: bizCode || undefined, ms: Date.now() - t0 };
    }
    return { target: target.name, ok: false, code: 'no_result', ms: Date.now() - t0 };
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
