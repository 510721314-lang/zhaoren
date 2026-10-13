// action_profile.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

async function reviewAction(ctx) {
  const { event, openid, clientIp, device, db, col, log, writeAudit, getConfig, getProfile } = ctx;
      const config = await getConfig();
      const adminList = config.admin_openids || [];
      if (adminList.indexOf(openid) < 0) {
        return { ok: false, code: 'pa_not_admin', msg: '无管理员权限' };
      }

      const { target_openid, pass } = event;
      if (!target_openid) return { ok: false, code: 'pa_no_target', msg: '缺少待审核用户' };

      const profile = await getProfile(target_openid);
      if (!profile) return { ok: false, code: 'pa_target_no_profile', msg: '目标用户不是耍伴' };
      if (profile.status !== 'pending_review') {
        return { ok: false, code: 'pa_already_reviewed', msg: '该耍伴已审核过' };
      }

      const newStatus = pass ? 'approved' : 'rejected';
      await col('partner_profile').doc(profile._id).update({ data: {
        status: newStatus, updated_at: Date.now()
      }});
      // 审核通过: 同步授予 user_account 的 partner role(申请时 pending_review 不授)
      if (pass) {
        try {
          const uaR = await col('user_account').where({ openid: target_openid }).limit(1).get();
          if (uaR.data && uaR.data.length) {
            const roles = uaR.data[0].roles || [];
            if (roles.indexOf('partner') < 0) {
              await col('user_account').doc(uaR.data[0]._id).update({
                data: { roles: [...roles, 'partner'], updated_at: Date.now() }
              });
            }
          }
        } catch (e) { log.d(`review grant role fail: ${e.message}`); }
      }
      log.d(`partner reviewed: ${target_openid} -> ${newStatus}`);
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_review',
        target_type: 'partner_profile', target_id: profile._id,
        detail: { target_openid, status: newStatus, pass: !!pass },
        result: 'ok', client_ip: clientIp, device
      });
      return { ok: true, data: { target_openid, status: newStatus } };
}

    // 4.5 耍伴资料维护(bio/skills/highlights; 内容安全+审核快照, fail-closed)
    //     硬拦截 URL/联系方式 → msgSecCheck → 本地词库; 写入待审区, profile_audit_status=pending
    //     展示端只读 profile_audited_snapshot, 未过审不上线
async function updatePartnerProfileAction(ctx) {
  const { event, openid, clientIp, device, cloud, db, col, log, writeAudit, writeNotice, getPartnerLimits, getConfig, getProfile } = ctx;
      const me = await getProfile(openid);
      // 入驻审核未通过(非 rejected/pending_review)之外, 允许维护资料:
      // 已入驻(approved)/入驻审核中(pending_review)可提前备资料; 资料展示仍只读 status==='approved' 的快照(fail-closed)
      if (!me || me.status === 'rejected') {
        return { ok: false, code: 'pa_not_partner', msg: '仅认证耍伴可维护资料' };
      }
      // 并发幂等: 审核中禁止重复提交(防双击/连点产多条 audit)
      if (me.profile_audit_status === 'pending') {
        return { ok: false, code: 'pa_audit_pending', msg: '资料正在审核中,请耐心等待' };
      }
      // 限频: 距上次提交 30 分钟内拒绝
      if (me.profile_submit_at && Date.now() - me.profile_submit_at < 30 * 60 * 1000) {
        return { ok: false, code: 'pa_submit_frequent', msg: '提交太频繁,请30分钟后再试' };
      }

      // 入参清洗与上限(数量/字数限制从 admin_config 动态读取, 后台可配; 读不到走默认不放大)
      const pLimits = await getPartnerLimits();
      const bio = String(event.bio || '').trim().slice(0, pLimits.bio_len);
      const skills = (Array.isArray(event.skills) ? event.skills : [])
        .map((s) => String(s || '').trim()).filter(Boolean).slice(0, pLimits.skills_max)
        .map((s) => s.slice(0, pLimits.skills_len));
      const highlights = (Array.isArray(event.service_highlights) ? event.service_highlights : [])
        .map((s) => String(s || '').trim()).filter(Boolean).slice(0, pLimits.highlights_max)
        .map((s) => s.slice(0, pLimits.highlight_len));
      // 资质证书 / 荣誉 其他: 每条仅标题(条数/字数后台可配), 图片为栏目级多图(张数后台可配, 存云存储 fileID)
      const sanitizeMedia = (titles, photos) => ({
        titles: (Array.isArray(titles) ? titles : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, pLimits.media_title_max).map((s) => s.slice(0, pLimits.media_len)),
        photos: (Array.isArray(photos) ? photos : []).map((f) => String(f || '')).filter(Boolean).slice(0, pLimits.media_photo_max)
      });
      const qualifications = sanitizeMedia(event.qual_titles, event.qual_photos);
      const honors = sanitizeMedia(event.hon_titles, event.hon_photos);
      const hasMedia = (m) => m.titles.length > 0 || m.photos.length > 0;
      if (!bio && !skills.length && !highlights.length && !hasMedia(qualifications) && !hasMedia(honors)) {
        return { ok: false, code: 'pa_profile_empty', msg: '请至少填写一项资料内容' };
      }

      // 硬拦截(零延迟, 先于 msgSecCheck): URL/微信号/联系方式/转账引流
      const CONTACT_RE = /(https?:\/\/|www\.|wxid|微信号|加微信|加V|转账|支付宝|QQ号|手机号1[3-9]\d{9})/i;
      const allText = [bio, ...skills, ...highlights, ...qualifications.titles, ...honors.titles].join(' ');
      if (CONTACT_RE.test(allText)) {
        return { ok: false, code: 'pa_profile_contact', msg: '资料不能包含联系方式/链接,请修改后重试' };
      }

      // 内容安全(复用项目模式: msgSecCheck + 本地词库降级)
      try {
        const r = await cloud.openapi.security.msgSecCheck({ content: allText });
        if (r.errCode !== 0) {
          return { ok: false, code: 'pa_profile_unsafe', msg: '资料包含违规内容,请修改后重试' };
        }
      } catch (e) {
        log.w('msgSecCheck fail(降级本地词库):', (e && (e.errCode || e.errMsg || e.message)) || '');
        const cfg = await getConfig();
        const hit = (cfg.block_words || []).find((w) => allText.indexOf(w) >= 0);
        if (hit) {
          return { ok: false, code: 'pa_profile_unsafe', msg: '资料包含敏感词,请修改后重试' };
        }
      }

      // 写入待审区(不动快照, 展示端仍读旧快照)
      await col('partner_profile').doc(me._id).update({ data: {
        bio_pending: bio, skills_pending: skills, highlights_pending: highlights,
        qualifications_pending: qualifications, honors_pending: honors,
        profile_audit_status: 'pending', profile_submit_at: Date.now(), updated_at: Date.now()
      }});
      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_profile_update',
        target_type: 'partner_profile', target_id: me._id,
        detail: { bio_len: bio.length, skills_count: skills.length, highlights_count: highlights.length,
          qual_titles: qualifications.titles.length, qual_photos: qualifications.photos.length,
          hon_titles: honors.titles.length, hon_photos: honors.photos.length },
        result: 'ok', client_ip: clientIp, device
      });
      // 推送审核中提醒给耍伴
      await writeNotice({
        to_openid: openid,
        type: 'partner_profile_submitted',
        title: '资料审核中',
        body: '你的耍伴资料已提交审核，审核通过后将自动展示。',
        action_key: 'partner_profile_edit'
      });
      return { ok: true, data: { msg: '资料已提交,审核通过后自动展示', profile_audit_status: 'pending' } };
}

    // 4.6 耍伴资料审核(管理员专用; 支持按栏目独立通过/驳回: items=[{field,pass,reason}])
    //     通过某栏目 → 该栏目 pending 并入快照(覆盖), 清其 pending
    //     驳回某栏目 → 清该栏目 pending(可重提), 留 reason
    //     全部栏目处理完后若仍有 pending 未清 → 保持 pending 锁; 否则解除锁
    //
    // ⚠️ DEPRECATED(兼容入口): 耍伴资料审核统一走 admin-action.partner_profile_review(admin-web 后台)。
    //    本分支仅保留供云端「云端测试」面板人工触发; 逻辑与 admin-action 保持一致(items 白名单/判空/锁判定)。
async function auditPartnerProfileAction(ctx) {
  const { event, openid, clientIp, device, db, _, col, log, writeAudit, buildAuditPatch, writeNotice, getConfig, getProfile } = ctx;
      const config = await getConfig();
      const adminList = config.admin_openids || [];
      if (adminList.indexOf(openid) < 0) {
        return { ok: false, code: 'pa_not_admin', msg: '无管理员权限' };
      }
      const { target_openid, items } = event;
      if (!target_openid) return { ok: false, code: 'pa_no_target', msg: '缺少待审核耍伴' };
      const profile = await getProfile(target_openid);
      if (!profile) return { ok: false, code: 'pa_target_no_profile', msg: '目标用户不是耍伴' };
      if (profile.profile_audit_status !== 'pending') {
        return { ok: false, code: 'pa_no_pending', msg: '该耍伴资料不在审核队列' };
      }
      if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, code: 'pa_no_items', msg: '缺少审核项' };
      }

      const now = Date.now();
      // 收敛: 审核增量由 _shared/partner_audit 唯一实现(与 admin-action 同源, 防漂移)
      const { patch, hist, hasRemainingPending, anyPatched } = buildAuditPatch(profile, items, now, openid);
      if (!anyPatched || Object.keys(patch).length === 0) {
        return { ok: false, code: 'pa_no_pending', msg: '所选审核项均无待审内容' };
      }
      patch.profile_audit_history = _.push(...hist);
      await col('partner_profile').doc(profile._id).update({ data: patch });

      await writeAudit(db, log, {
        openid, role: 'partner', category: 'business', action: 'partner_profile_audit',
        target_type: 'partner_profile', target_id: profile._id,
        detail: { target_openid, items: items.map((i) => ({ field: i.field, pass: !!i.pass })) },
        result: 'ok', client_ip: clientIp, device
      });
      // 推送审核结果给耍伴
      await writeNotice({
        to_openid: profile.openid || target_openid,
        type: hasRemainingPending ? 'partner_profile_rejected' : 'partner_profile_approved',
        title: hasRemainingPending ? '部分资料未通过' : '资料审核通过',
        body: hasRemainingPending
          ? '你的部分耍伴资料未通过审核，请修改未通过的栏目后重新提交；已通过的栏目已展示。'
          : '你的耍伴资料已通过审核，已在耍伴卡片与详情页展示。',
        action_key: 'partner_profile_edit'
      });
      return { ok: true, data: { target_openid, profile_audit_status: hasRemainingPending ? 'pending' : 'approved' } };
}

module.exports = {
  review: reviewAction,
  update_partner_profile: updatePartnerProfileAction,
  audit_partner_profile: auditPartnerProfileAction,
};
