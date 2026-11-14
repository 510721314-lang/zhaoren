// T-7.26(2026-11-07): 自 init-db/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。
const { writeAudit } = require('./audit'); // #4 全修(2026-11-14): 同级规范源副本, 经 sync-audit.ps1 同步

// ── 一次性: 生成 admin-web HTTP 鉴权密钥(长随机字符串, 加 reason 审计) ──
// admin_openids 为空时自动 bootstrap seed 当前 openid + 放行 (打破鸡生蛋)
// 安全: 身份经 resolveAdminIdentity 收口; bootstrap 走事务 CAS(并发下仅首个调用者成功);
//       key 仅此一次明文返回, 不落日志不落库外存储 —— 调用方须立即妥善保存
async function generate_admin_web_key(ctx) {
  const { event, db, openid, resolveAdminIdentity, resolveAdminBootstrap } = ctx;
  const { reason } = event;
  if (!reason) return { ok: false, msg: '必须填 reason 审计' };
  try {
    const curOpenid = await resolveAdminIdentity(db, event, openid);
    if (!curOpenid) return { ok: false, msg: '需要管理员身份(真机 OPENID 或有效网关代理密钥)' };
    const now = Date.now();
    const crypto = require('crypto');
    const key = 'AWK-' + crypto.randomBytes(32).toString('hex');
    // 事务 CAS: 重读白名单, bootstrap 仅在仍为空时成立(防并发双击各自 seed 自己)
    // 决策逻辑抽到 _shared/security_policy.js 统一实现并单测
    let bootstrapped = false;
    await db.runTransaction(async (t) => {
      const acr = await t.collection('admin_config').doc('global').get();
      const decision = resolveAdminBootstrap((acr.data && acr.data.admin_openids) || [], curOpenid);
      bootstrapped = decision.bootstrapped;
      if (!decision.permitted) {
        const err = new Error('仅白名单管理员可执行');
        err.bizCode = 'forbidden';
        throw err;
      }
      await t.collection('admin_config').doc('global').update({
        data: { admin_web_key: key, admin_web_key_at: now, admin_web_key_by: curOpenid,
                admin_web_key_reason: reason, updated_at: now,
                admin_openids: decision.allowed // bootstrap 后覆盖回完整列表
              }
      });
    });
    // 审计留痕(#4 全修 2026-11-14): 必须在事务回调外调用(writeAudit 用 db.collection 而非事务句柄);
    // 审计尽力而为——writeAudit 内部自吞异常, 失败不阻断 key 生成、返回体不变(沿 admin-web 先例);
    // key 明文严禁入 audit; category='business' 与 admin-action 管理员写操作惯例一致
    await writeAudit(db, { d: function () {} }, {
      openid: curOpenid, role: 'admin', category: 'business',
      action: 'generate_admin_web_key', target_type: 'admin_config', target_id: 'global',
      detail: { reason: String(reason).slice(0, 200), bootstrapped },
      result: 'ok', device: 'init-db'
    });
    return { ok: true, key, key_once: true, bootstrapped, hint: '此 key 仅本次明文返回且不落任何日志, 请立即复制妥善保存; admin-web 前端 HTTP 请求头 X-Admin-Key 需携带' };
  } catch (e) {
    if (e && e.bizCode === 'forbidden') return { ok: false, code: 'forbidden', msg: '仅白名单管理员可执行' };
    // fail 留痕(#4 全修): 仅非 forbidden 异常(与 admin-web fn_migrate A2 先例同构; forbidden/缺 reason 不留)
    await writeAudit(db, { d: function () {} }, {
      openid: openid || 'unknown', role: 'admin', category: 'business',
      action: 'generate_admin_web_key', target_type: 'admin_config', target_id: 'global',
      detail: { reason: String(reason || '').slice(0, 200), err: String((e && e.message) || e).slice(0, 200) },
      result: 'fail', device: 'init-db'
    });
    return { ok: false, msg: e.message };
  }
}

module.exports = { generate_admin_web_key };
