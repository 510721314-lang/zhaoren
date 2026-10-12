// admin-action · 杂项独立 handler（upload_image / realname_reset_simulated / evidence_query，从 index.js 物理抽出，行为逐字不变）
// 共享符号通过 ctx 注入，禁止反向 require('./index')。

// 批 6.3: 服务端图片尺寸校验 · 从文件头解析宽高(纯函数, 可单测), 不依赖图像库。
// 返回 {format,width,height} 或 null(无法解析); cover 须 1:1, 不合规返 up_not_square。
function readImageDims(buf) {
  if (!buf || buf.length < 4) return null;
  // PNG: IHDR 在偏移 16 起, 宽高各 4 字节大端
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf.length > 24) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: 遍历段, SOF0/SOF1/SOF2 段取高(大端 i+5)/宽(i+7)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 1) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }   // 评审修复(R3): marker 前的连续 0xFF 是填充字节, 逐字节跳过, 不当 marker 解析
      if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (i + 4 > buf.length) break;
      const segLen = buf.readUInt16BE(i + 2);
      if (m === 0xc0 || m === 0xc1 || m === 0xc2 || m === 0xc3) {
        if (i + 9 > buf.length) break;
        return { format: 'jpg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (!segLen || segLen < 2) break;
      i += 2 + segLen;
    }
    return null;
  }
  // WebP: VP8X(24bit) / VP8 有损(14bit)
  if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const fourcc = buf.slice(12, 16).toString('ascii');
    if (fourcc === 'VP8X' && buf.length >= 30) {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { format: 'webp', width, height };
    }
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }
  return null;
}

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
  // 批 6.3: 服务端尺寸校验 —— 封面须 1:1; 无法解析尺寸时不阻断(仅体积/格式已保证)
  const dims = readImageDims(buf);
  if (use === 'cover' && dims && Math.abs(dims.width - dims.height) > 1) {
    return fail('up_not_square', `封面图需为 1:1 正方形(当前 ${dims.width}×${dims.height})`);
  }
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

module.exports = { upload_image, realname_reset_simulated, evidence_query, readImageDims };
