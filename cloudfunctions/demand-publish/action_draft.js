// action_draft.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 6. 保存需求草稿(有 draft_id 则更新,无则新增;上限 20 条/有效期 30 天)
async function save_draft_action(ctx) {
  const { event, openid, clientIp, device, action, wxCtx, _, col, isValidDocId, addWithColl } = ctx;
      const { draft_id, demand_data } = event;
      const data = (demand_data && typeof demand_data === 'object' && !Array.isArray(demand_data)) ? demand_data : null;
      if (!data) return { ok: false, code: 'draft_no_data', msg: '草稿内容为空' };
      if (JSON.stringify(data).length > 10000) {
        return { ok: false, code: 'draft_too_large', msg: '草稿内容过大' };
      }
      const now = Date.now();
      const expire_at = now + 30 * 24 * 3600 * 1000;  // DRAFT.expireDays=30

      // 更新已有草稿
      if (draft_id) {
        if (!isValidDocId(draft_id)) return { ok: false, code: 'draft_bad_id', msg: '草稿 ID 格式不正确' };
        try {
          const r = await col('demand_draft').doc(draft_id).get();
          const d = r.data;
          if (!d || d.is_deleted) return { ok: false, code: 'draft_not_found', msg: '草稿不存在' };
          if (d.openid !== openid) return { ok: false, code: 'draft_not_owner', msg: '只能编辑自己的草稿' };
          await col('demand_draft').doc(draft_id).update({
            data: { demand_data: data, expire_at, updated_at: now }
          });
          return { ok: true, data: { draft_id, updated: true } };
        } catch (e) {
          return { ok: false, code: 'draft_fail', msg: '草稿保存失败' };
        }
      }

      // 新增草稿: 数量上限 20 条(DRAFT.maxCount=20)
      try {
        // 新增草稿: 数量上限 20 条(DRAFT.maxCount=20); 计数只算未过期未删除,
        // 否则过期草稿在列表不可见/不可删却占名额, 会永久无法保存新草稿
        const c = await col('demand_draft').where({
          openid, is_deleted: false, expire_at: _.gt(now)
        }).count()
          .catch(() => ({ total: 0 }));  // 集合尚未创建时按 0 处理
        if ((c.total || 0) >= 20) {
          return { ok: false, code: 'draft_limit', msg: '草稿最多保存 20 条,请先清理草稿箱' };
        }
        const addR = await addWithColl('demand_draft', {
          openid, demand_data: data, expire_at,
          created_at: now, updated_at: now, is_deleted: false
        });
        return { ok: true, data: { draft_id: addR._id, created: true } };
      } catch (e) {
        return { ok: false, code: 'draft_fail', msg: '草稿保存失败' };
      }
}

    // 7. 草稿列表(过滤已过期,最近更新在前; 集合尚未创建时返回空列表)
async function list_drafts_action(ctx) {
  const { event, openid, clientIp, device, action, wxCtx, _, col } = ctx;
      try {
        const r = await col('demand_draft').where({
          openid, is_deleted: false, expire_at: _.gt(Date.now())
        }).orderBy('updated_at', 'desc').limit(20).get().catch(() => ({ data: [] }));
        const list = (r.data || []).map((d) => ({
          _id: d._id,
          demand_data: d.demand_data || {},
          created_at: d.created_at,
          updated_at: d.updated_at,
          expire_at: d.expire_at
        }));
        return { ok: true, data: { list } };
      } catch (e) {
        return { ok: false, code: 'draft_list_fail', msg: '草稿查询失败' };
      }
}

    // 8. 删除草稿(软删,仅创建者)
async function delete_draft_action(ctx) {
  const { event, openid, clientIp, device, action, wxCtx, col, isValidDocId } = ctx;
      const { draft_id } = event;
      if (!draft_id) return { ok: false, code: 'draft_no_id', msg: '缺少草稿 ID' };
      if (!isValidDocId(draft_id)) return { ok: false, code: 'draft_bad_id', msg: '草稿 ID 格式不正确' };
      try {
        const r = await col('demand_draft').doc(draft_id).get();
        const d = r.data;
        if (!d || d.is_deleted) return { ok: false, code: 'draft_not_found', msg: '草稿不存在' };
        if (d.openid !== openid) return { ok: false, code: 'draft_not_owner', msg: '只能删除自己的草稿' };
        await col('demand_draft').doc(draft_id).update({
          data: { is_deleted: true, updated_at: Date.now() }
        });
        return { ok: true, data: { draft_id, deleted: true } };
      } catch (e) {
        return { ok: false, code: 'draft_fail', msg: '草稿删除失败' };
      }
}

module.exports = {
  save_draft: save_draft_action,
  list_drafts: list_drafts_action,
  delete_draft: delete_draft_action,
};
