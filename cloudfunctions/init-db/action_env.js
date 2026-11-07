// T-7.26(2026-11-07): 自 init-db/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。

// ── 强制迁移 scene_list / system_templates ──
async function force_migrate_scenes(ctx) {
  const { event, db, SEED_CONFIG } = ctx;
  const patch = { scene_list: SEED_CONFIG.scene_list, updated_at: Date.now() };
  try {
    await db.collection('admin_config').doc('global').update({ data: patch });
    return { ok: true, mode: 'force_migrate_scenes', scene_count: SEED_CONFIG.scene_list.length, codes: SEED_CONFIG.scene_list.map(s => s.code) };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

// ── 临时: 切换 admin_config.env(仅 dev/prod, 用于云端测试面板 mock_openid 放行) ──
// prod 环境 fail-closed 禁止切 dev(防云端测试面板被人滥用身份门控); 需管理员白名单身份
async function set_env(ctx) {
  const { event, db, adminIdentity } = ctx;
  const { env } = event;
  if (env !== 'dev' && env !== 'prod') return { ok: false, msg: 'env 只能是 dev 或 prod' };
  try {
    const cur = await db.collection('admin_config').doc('global').get();
    const curEnv = (cur.data && cur.data.env) || 'prod';
    if (curEnv === 'prod' && env === 'dev') {
      return { ok: false, msg: 'prod 环境禁止切 dev, 请用 force_set_env 并填 reason' };
    }
    const allowed = (cur.data && cur.data.admin_openids) || [];
    if (!adminIdentity || allowed.indexOf(adminIdentity) < 0) {
      return { ok: false, code: 'forbidden', msg: '仅白名单管理员可调用 set_env' };
    }
    await db.collection('admin_config').doc('global').update({ data: { env, updated_at: Date.now() } });
    return { ok: true, mode: 'set_env', env };
  } catch (e) { return { ok: false, msg: e.message }; }
}

// ── 应急: 强制切 env(任何方向, 需 reason + confirm:true 二次确认 + 管理员身份白名单) ──
// 身份经 resolveAdminIdentity 收口(代理密钥 或 prod 真实 OPENID), 绝不直接读 event.mock_openid
async function force_set_env(ctx) {
  const { event, db, openid, resolveAdminIdentity, invalidateEnvCache } = ctx;
  const { env, reason } = event;
  if (env !== 'dev' && env !== 'prod') return { ok: false, msg: 'env 只能是 dev 或 prod' };
  if (!reason) return { ok: false, msg: 'force_set_env 必须填 reason 留审计' };
  if (event.confirm !== true) return { ok: false, code: 'need_confirm', msg: 'force_set_env 为高危开关, 需 confirm:true 二次确认' };
  try {
    const curOpenid = await resolveAdminIdentity(db, event, openid);
    if (!curOpenid) return { ok: false, code: 'no_identity', msg: '未获取到管理员身份(真机 OPENID 或有效网关代理密钥)' };
    const acr = await db.collection('admin_config').doc('global').get();
    const allowed = (acr.data && acr.data.admin_openids) || [];
    if (allowed.indexOf(curOpenid) < 0) {
      return { ok: false, code: 'forbidden', msg: '仅白名单管理员可调用 force_set_env' };
    }
    const before = (acr.data.env) || 'prod';
    const now = Date.now();
    const EXPIRE_MS = 4 * 60 * 60 * 1000; // 4 小时自毁
    await db.collection('admin_config').doc('global').update({
      data: {
        env,
        updated_at: now,
        // 2026-10-13 收敛: openid.js 规范源以 dev_until 判定 dev 生效(fail-closed, 批4.1 加固),
        // force_set_env 是应急通道, 必须与 force_expire_at 同刻写 dev_until, 否则各函数按 prod 兜底、mock 身份被判拒
        dev_until: env === 'dev' ? now + EXPIRE_MS : 0,
        force_expire_at: env === 'dev' ? now + EXPIRE_MS : null,
        force_operator: env === 'dev' ? curOpenid : null,
        force_reason: env === 'dev' ? reason : null,
        force_used_at: env === 'dev' ? now : null,
        updated_by: { action: 'force_set_env', operator: curOpenid, from: before, to: env, reason, at: now, auto_revert_at: env === 'dev' ? now + EXPIRE_MS : null }
      }
    });
    invalidateEnvCache(); // 强制清缓存, 后续 init-db 操作立即感知新 env
    // 审批留痕: 高危开关写 platform_event(安全审计要求)
    try {
      await db.collection('platform_event').add({ data: {
        level: 'P1', event: 'force_set_env', openid: curOpenid,
        detail: { from: before, to: env, reason, auto_revert_at: env === 'dev' ? now + EXPIRE_MS : null },
        created_at: now, updated_at: now, is_deleted: false
      } });
    } catch (e) { console.warn('force_set_env platform_event 留痕失败:', e.message); }
    return { ok: true, mode: 'force_set_env', from: before, to: env, operator: curOpenid, auto_revert_in_hours: env === 'dev' ? 4 : null };
  } catch (e) { return { ok: false, msg: e.message }; }
}

module.exports = { force_migrate_scenes, set_env, force_set_env };
