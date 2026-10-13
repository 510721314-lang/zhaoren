// action_misc.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 5. 设置紧急联系人(1~2 名)
async function set_emergency_contact_action(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, evalEmergencyCooldown, maskPhone } = ctx;
      const { contacts } = event;
      if (!Array.isArray(contacts) || contacts.length === 0 || contacts.length > 2) {
        return { ok: false, code: 'emergency_count', msg: '紧急联系人需 1-2 名' };
      }
      for (const c of contacts) {
        if (!c.name || !c.phone || !c.relation) {
          return { ok: false, code: 'emergency_field', msg: '姓名/手机号/关系均必填' };
        }
        if (!/^1\d{10}$/.test(c.phone)) {
          return { ok: false, code: 'emergency_phone', msg: `${c.name} 的手机号格式有误` };
        }
      }
      // 合规硬约束: 紧急联系人每 30 天最多变更 1 次(首次设置豁免)
      const EMERGENCY_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
      try {
        const meR = await col('user_account').where({ openid }).limit(1).get();
        const me = (meR.data && meR.data[0]) || null;
        const lastChanged = me && me.emergency_changed_at;
        const cd = evalEmergencyCooldown(lastChanged, Date.now(), EMERGENCY_COOLDOWN_MS);
        if (cd.blocked) {
          const nextAt = new Date(cd.nextAtMs);
          const nextStr = `${nextAt.getFullYear()}-${String(nextAt.getMonth() + 1).padStart(2, '0')}-${String(nextAt.getDate()).padStart(2, '0')}`;
          return { ok: false, code: 'emergency_too_frequent', msg: `紧急联系人每30天仅可变更1次, ${nextStr} 后可再次修改` };
        }
      } catch (e) {
        return { ok: false, code: 'emergency_save_fail', msg: '紧急联系人保存失败' };
      }
      try {
        const now = Date.now();
        // 槽位复用: 取现有未删联系人(按创建顺序, 最多2), 逐槽覆盖更新; 不足才新增, 多余软删。
        // 不采用"先全删再逐条插", 避免中途插入失败导致联系人被清空。
        const existR = await col('emergency_contact')
          .where({ openid, is_deleted: false }).orderBy('created_at', 'asc').limit(2).get();
        const existDocs = existR.data || [];
        await Promise.all(contacts.map((c, i) => {
          if (existDocs[i]) {
            return col('emergency_contact').doc(existDocs[i]._id).update({ data: {
              name: c.name, phone: c.phone, relation: c.relation, updated_at: now
            }});
          }
          return col('emergency_contact').add({ data: {
            openid, name: c.name, phone: c.phone, relation: c.relation,
            created_at: now, updated_at: now, is_deleted: false
          }});
        }));
        // 新数据少于旧数据(如 2 名减为 1 名): 多余旧槽位软删
        for (let i = contacts.length; i < existDocs.length; i++) {
          await col('emergency_contact').doc(existDocs[i]._id).update({ data: {
            is_deleted: true, updated_at: now
          }});
        }
        // 记录变更时间(30 天频控窗口起点)
        await col('user_account').where({ openid }).update({ data: { emergency_changed_at: now } });
        // 变更通知留痕: 原联系人收到通知的合规要求, 真实短信通道随企业资质最后一步接入;
        // 现阶段落审计 + system_notice 证据链, 提审演示可说明
        const oldMasked = existDocs.map((d) => ({ name: d.name || '', phone: maskPhone(d.phone || '') }));
        await writeAudit(db, log, {
          openid, role: 'user', category: 'account', action: 'emergency_contact_change',
          target_type: 'user_account', target_id: (me && me._id) || '',
          detail: { old_contacts: oldMasked, new_count: contacts.length },
          result: 'ok', client_ip: clientIp, device
        });
        try {
          await col('system_notice').add({ data: {
            to_openid: openid, type: 'emergency_contact_changed',
            title: '紧急联系人已变更',
            content: `您的紧急联系人已变更为 ${contacts.map((c) => c.name).join('、')}。`,
            read: false, created_at: now, updated_at: now, is_deleted: false
          }});
        } catch (e) { log.d(`emergency notice fail: ${e.message}`); }
        const safe = contacts.map(c => ({ name: c.name, phone: maskPhone(c.phone), relation: c.relation }));
        return { ok: true, data: { contacts: safe } };
      } catch (e) {
        return { ok: false, code: 'emergency_save_fail', msg: '紧急联系人保存失败' };
      }
}

    // 5b. 查询我的紧急联系人(本人管理页回显, 返回完整手机号; 最多 2 名)
async function get_emergency_contact_action(ctx) {
  const { event, openid, clientIp, device, col } = ctx;
      try {
        const r = await col('emergency_contact').where({ openid, is_deleted: false }).limit(2).get();
        const contacts = (r.data || []).map(c => ({
          name: c.name || '', phone: c.phone || '', relation: c.relation || ''
        }));
        return { ok: true, data: { contacts } };
      } catch (e) {
        return { ok: false, code: 'emergency_query_fail', msg: '紧急联系人查询失败' };
      }
}

    // 6. 查询双信用分与最近 20 条流水
async function get_my_credit_action(ctx) {
  const { event, openid, clientIp, device, col } = ctx;
      try {
        const ur = await col('user_account').where({ openid }).limit(1).get();
        if (!ur.data || !ur.data.length) return { ok: false, code: 'credit_no_user', msg: '用户不存在' };
        const u = ur.data[0];
        const lr = await col('credit_score_log').where({ openid }).orderBy('created_at', 'desc').limit(20).get();
        return {
          ok: true,
          data: {
            user_credit_score: u.user_credit_score,
            partner_credit_score: u.partner_credit_score,
            logs: (lr.data || []).map(l => ({
              type: l.type, delta: l.delta, score: l.score, reason: l.reason,
              created_at: l.created_at
            }))
          }
        };
      } catch (e) {
        return { ok: false, code: 'credit_query_fail', msg: '信用分查询失败' };
      }
}

    // 公开配置读取(无身份校验, 返回 payment_visible 等审核/运营开关)
async function global_config_action(ctx) {
  const { event, openid, clientIp, device, getConfig } = ctx;
      const cfg = await getConfig();
      return { ok: true, data: {
        payment_visible: cfg.payment_visible !== false,
        block_words: cfg.block_words || [],
        scene_list: cfg.scene_list || []
      }};
}

module.exports = {
  set_emergency_contact: set_emergency_contact_action,
  get_emergency_contact: get_emergency_contact_action,
  get_my_credit: get_my_credit_action,
  global_config: global_config_action,
};
