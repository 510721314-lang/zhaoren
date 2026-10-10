// admin-action · 杂项独立 handler（upload_image / realname_reset_simulated / evidence_query，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

async function upload_image(ctx) {
  const { event, cloud, log, logEvent, openid, ok, fail } = ctx;
  const use = event.use === 'cover' ? 'cover' : 'banner';
  const b64 = String(event.fileData || '').replace(/^data:image\/\w+;base64,/, '').trim();
  if (!b64) return fail('up_bad_data', '图片数据为空');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) return fail('up_bad_data', '图片数据为空');
  if (buf.length > 2 * 1024 * 1024) return fail('up_too_big', '图片大小不能超过 2MB');
  let ext = '';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
  else if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ext = 'png';
  else if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') ext = 'webp';
  if (!ext) return fail('up_bad_ext', '仅支持 jpg/png/webp 格式');
  const day = (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })();
  const cloudPath = `admin_web/activity/${day}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  let up;
  try {
    up = await cloud.uploadFile({ cloudPath, fileContent: buf });
  } catch (e) {
    log.d('upload_image fail:', e && e.message);
    return { ok: false, code: 'up_fail', msg: '图片上传失败,请重试' };
  }
  await logEvent('P2', 'upload_image', openid, { use, size: buf.length, cloudPath });
  return ok({ fileID: up.fileID });
}

async function realname_reset_simulated(ctx) {
  const { event, isOpenid, col, now, openid, logEvent, ok, fail } = ctx;
  const target = event.openid ? String(event.openid).trim() : '';
  if (target && !isOpenid(target)) return fail('rrs_bad_openid', 'openid 格式不正确');
  const q = { is_realname_simulated: true };
  if (target) q.openid = target;
  const r = await col('user_account').where(q).update({ data: {
    is_realname_done: false, is_realname_simulated: false,
    realname_reset_at: now, updated_at: now
  }}).catch(() => ({ stats: { updated: 0 } }));
  const updated = (r.stats && r.stats.updated) || 0;
  await logEvent('P2', 'realname_reset_simulated', openid, { target: target || 'ALL', updated });
  return ok({ updated, target: target || 'ALL' });
}

async function evidence_query(ctx) {
  const { event, isOpenid, isDocId, col, pager, ok, fail } = ctx;
  if (event.evidence_id) {
    if (!isDocId(String(event.evidence_id))) return fail('eq_bad_id', 'evidence_id 需为 32 位文档 _id');
    const dr = await col('disclaimer_signature').doc(String(event.evidence_id)).get().catch(() => ({ data: null }));
    if (!dr.data) return fail('eq_not_found', '留证记录不存在');
    return ok({ record: dr.data });
  }
  const pg = pager(event);
  const q = { is_deleted: false };
  if (event.openid) {
    if (!isOpenid(String(event.openid))) return fail('eq_bad_openid', 'openid 格式不正确');
    q.openid = String(event.openid);
  }
  if (event.kind) q.kind = String(event.kind);
  if (event.scene) q.scene = String(event.scene);
  const cnt = await col('disclaimer_signature').where(q).count();
  const r = await col('disclaimer_signature').where(q)
    .orderBy('signed_at', 'desc').skip(pg.skip).limit(pg.size).get();
  return ok({
    total: cnt.total, page: pg.page, size: pg.size,
    list: r.data.map((x) => ({
      _id: x._id,
      kind: x.kind || 'scene_disclaimer',
      openid: String(x.openid || ''),
      role: x.role || '', scene: x.scene || '',
      disclaimer_type: x.disclaimer_type || '',
      agree_type: x.agree_type || (x.verify_method ? 'handwritten' : ''),
      verify_method: x.verify_method || '',
      signature_file_id: x.signature_file_id || '',
      signature_hash: x.signature_hash || '',
      docs: Array.isArray(x.docs) ? x.docs.map((d) => ({ key: d.key, title: d.title, hash: d.hash })) : [],
      signed_at: x.signed_at || x.created_at
    }))
  });
}

module.exports = { upload_image, realname_reset_simulated, evidence_query };
