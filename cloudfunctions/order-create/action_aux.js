// action_aux.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

// 接单资格只读查询(无留证/建单): signed=同场景免责已签; certified=已开通该场景接单权限
async function checkSignedAction(ctx) {
  const { event, openid, col, getUser, getPartnerProfile } = ctx;
    const { scene } = event;
    if (!scene) return { ok: false, code: 'check_no_scene', msg: '缺少场景' };
    const [hit, prof] = await Promise.all([
      col('disclaimer_signature').where({
        openid, role: 'partner', scene, is_deleted: false
      }).limit(1).get().catch(() => ({ data: [] })),
      getUser(openid).then((u) => {
        if (!u) return { accept_scenes: undefined, is_partner: false };
        // 直接读 partner_profile.accept_scenes(与 create_from_take 同源, 一处判定)
        return getPartnerProfile(openid).catch(() => ({ accept_scenes: [] }));
      }).catch(() => ({ accept_scenes: [] }))
    ]);
    const certified = Array.isArray(prof.accept_scenes) && prof.accept_scenes.indexOf(scene) >= 0;
    return { ok: true, data: { scene, signed: !!(hit.data && hit.data[0]), certified } };
}

// 耍伴签署场景免责声明(code.html 第一道防线·接单前置)
async function signDisclaimerAction(ctx) {
  const { event, openid, db, col, log, getConfig, buildCheckboxEvidence, writeAudit, clientIp, device } = ctx;
    const { scene } = event;
    if (!scene) return { ok: false, code: 'sign_no_scene', msg: '缺少场景' };
    // 免责声明类型: 优先从 admin_config.scene_list 动态读(SSOT), 兜底硬编码映射
    const cfg = await getConfig();
    const sceneCfg = (cfg.scene_list || []).find((s) => s && s.code === scene);
    const disclaimerType = (sceneCfg && sceneCfg.disclaimer_type) || {
      W1: 'medical_disclaimer', W2: 'general_disclaimer', W8: 'general_disclaimer',
      W10: 'general_disclaimer', W11: 'online_disclaimer'
    }[scene] || 'general_disclaimer';

    // 已签同场景则幂等返回; 遗留占位哈希(sig_ 开头)= 早期无文档哈希版本, 顺带自愈为真实 SHA-256
    const evData = buildCheckboxEvidence({
      openid, role: 'partner', scene, disclaimerType, config: cfg, signedAt: Date.now()
    });
    const exist = await col('disclaimer_signature').where({
      openid, role: 'partner', scene, is_deleted: false
    }).limit(1).get().catch(() => ({ data: [] }));
    if (exist.data && exist.data[0]) {
      const rec = exist.data[0];
      if (/^sig_/.test(String(rec.signature_hash || '')) && evData.docs.length) {
        await col('disclaimer_signature').doc(rec._id).update({ data: {
          kind: 'scene_disclaimer', agree_type: 'checkbox',
          docs: evData.docs, signature_hash: evData.signature_hash,
          updated_at: evData.updated_at
        }}).catch((he) => log.d(`evidence heal fail: ${(he && he.message) || he}`));
        log.d(`partner disclaimer evidence healed: ${rec._id}`);
      }
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'consent', action: 'sign_disclaimer',
        target_type: 'disclaimer_signature', target_id: rec._id || '',
        detail: { scene, disclaimer_type: disclaimerType, idempotent: true },
        evidence_id: rec._id || '', doc_hash: evData.signature_hash || '',
        result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { scene, signed: true, idempotent: true } };
    }

    let signEvidenceId = '';
    try {
      const signRes = await col('disclaimer_signature').add({ data: evData });
      signEvidenceId = (signRes && signRes._id) || '';
    } catch (se) {
      log.d(`partner disclaimer add fail: ${(se && se.message) || se}`);
      return { ok: false, code: 'sign_db_fail', msg: '签署失败,请稍后重试' };
    }
    log.d(`partner signed disclaimer: openid=${openid} scene=${scene}`);
    await writeAudit(db, log, {
      openid, role: 'partner', category: 'consent', action: 'sign_disclaimer',
      target_type: 'disclaimer_signature', target_id: signEvidenceId,
      detail: { scene, disclaimer_type: disclaimerType, idempotent: false },
      evidence_id: signEvidenceId, doc_hash: evData.signature_hash || '',
      result: 'ok', client_ip: clientIp, device
    });
    return { ok: true, data: { scene, signed: true } };
}

// 接单结果兜底查询: 前端接单请求网络异常(超时)后调用, 判断需求是否已被本耍伴接下
// state: gone(需求不存在) / not_mine(未接下或被他人抢) / taken(已建单, 附 order_id) / released(半成品已释放可重试)
async function checkTakeResultAction(ctx) {
  const { event, openid, col, _, log, isValidDocId } = ctx;
    const { demand_id } = event;
    if (!demand_id || !isValidDocId(demand_id)) {
      return { ok: false, code: 'order_bad_demand_id', msg: '需求 ID 格式不正确' };
    }
    try {
      const d = await col('demand').doc(demand_id).get();
      if (!d.data || d.data.is_deleted) return { ok: true, data: { state: 'gone' } };
      if (d.data.matched_openid !== openid) return { ok: true, data: { state: 'not_mine' } };
      const ex = await col('order_main').where({ demand_id, is_deleted: _.neq(true) }).limit(1).get();
      if (ex.data && ex.data.length) {
        const o = ex.data[0];
        return { ok: true, data: { state: 'taken', order_id: o._id, order_no: o.order_no, status: o.status } };
      }
      // 卡死半成品(事务被杀且补偿未执行): 自愈释放回 matching
      await col('demand').where({ _id: demand_id, status: 'matched' }).update({
        data: { status: 'matching', matched_openid: null, matched_at: null, updated_at: Date.now() }
      }).catch(() => {});
      return { ok: true, data: { state: 'released' } };
    } catch (e) {
      log.d(`check_take_result fail: ${e.message}`);
      return { ok: false, code: 'order_check_fail', msg: '查询失败,请重试' };
    }
}

module.exports = {
  check_signed: checkSignedAction,
  sign_disclaimer: signDisclaimerAction,
  check_take_result: checkTakeResultAction
};
