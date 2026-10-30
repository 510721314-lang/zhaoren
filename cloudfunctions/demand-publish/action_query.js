// action_query.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 3. 我的需求列表(含候选耍伴摘要)
async function my_demands_action(ctx) {
  const { event, openid, clientIp, device, action, wxCtx, col, SCENE_NAME, lazyExpire } = ctx;
      // 先懒过期
      await lazyExpire();
      try {
        const r = await col('demand').where({
          creator_openid: openid, is_deleted: false
        }).orderBy('created_at', 'desc').limit(50).get();

        const list = (r.data || []).map(d => {
          // 需求标题/详细描述(2026-10-17 新增展示): 复用详情页口径 —— demand.remark = `标题｜详细描述`(全角｜, 发布时写入)
          // 无｜则仅标题; 标题兜底 content_options[0]; 两值空则前端 wx:if 自然隐藏(注意: demand 文档自身即含 remark, 无需反查)
          const dp = String(d.remark || '').split('｜');
          return {
          _id: d._id, demand_no: d.demand_no, scene: d.scene,
          scene_name: SCENE_NAME[d.scene] || d.scene,
          location: (d.location && { name: d.location.name, address: d.location.address }) || null,
          start_time: d.start_time, duration_h: d.duration_h,
          total_fen: d.total_fen, status: d.status,
          match_candidates: (d.match_candidates || []).slice(0, 5),
          invited: d.invited || [],
          broadcast: !!d.broadcast,
          created_at: d.created_at,
          demand_title: dp[0] ? dp[0].trim() : ((d.content_options && d.content_options[0]) || ''),
          demand_desc: dp[1] ? dp[1].trim() : ''
          };
        });
        return { ok: true, data: { list } };
      } catch (e) {
        return { ok: false, code: 'my_demands_fail', msg: '查询失败' };
      }
}

    // 5. 需求详情(公开, 含发布者姓氏)
async function detail_action(ctx) {
  const { event, openid, clientIp, device, action, wxCtx, _, col, log, maskContact, haversineKm, validLngLat, buildRecommendPartners, isValidDocId } = ctx;
      const { demand_id, viewer_lat, viewer_lng } = event;
      if (!demand_id) return { ok: false, code: 'detail_no_id', msg: '缺少需求 ID' };
      if (!isValidDocId(demand_id)) return { ok: false, code: 'detail_bad_id', msg: '需求 ID 格式不正确' };

      try {
        const r = await col('demand').doc(demand_id).get();
        const d = r.data;
        if (!d || d.is_deleted) return { ok: false, code: 'detail_not_found', msg: '需求不存在或已删除' };

        // 展现次数自增(浏览详情一次 +1; 不改动底层数据结果)
        try {
          await col('demand').doc(demand_id).update({ data: { view_count: _.inc(1) } });
        } catch (e) { log.d(`view count inc fail: ${e.message}`); }

        // 发布者姓氏 + 信用分(取 surname / real_name / nickname 首字; u 仅在此作用域内, 勿外泄引用)
        let surname = '匿';
        let creditScore = 800;
        try {
          const uR = await col('user_account').where({ openid: d.creator_openid }).limit(1).get();
          const u = (uR.data && uR.data[0]) || {};
          const name = u.surname || u.real_name || u.nickname || '';
          surname = name ? String(name).charAt(0) : '匿';
          creditScore = u.user_credit_score || 800;
        } catch (e) {}

        // 备注拆分: 标题｜描述(full-width ｜)
        const remarkParts = String(d.remark || '').split('｜');
        const title = remarkParts[0] ? remarkParts[0].trim() : (d.content_options && d.content_options[0]) || '需求';
        const description = remarkParts[1] ? remarkParts[1].trim() : '';

        // 时间格式化(固定按东八区输出: 云函数运行时区为 UTC, 直接 getHours 会少 8 小时)
        const CN_OFF = 8 * 3600 * 1000;
        const dt = new Date(d.start_time + CN_OFF);
        const pad = (n) => n < 10 ? '0' + n : '' + n;
        const service_date = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
        const service_time = `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;

        // 发布于 X 分钟前
        const minutes_ago = Math.max(1, Math.floor((Date.now() - (d.created_at || Date.now())) / 60000));

        // 被接单后反查进行中订单: 用于发布者端"接单后自动跳转确认页"(demand 表不落 order_id)
        let order_id = null;
        if (d.status && d.status !== 'matching') {
          try {
            const oR = await col('order_main').where({ demand_id, is_deleted: false }).orderBy('created_at', 'desc').limit(1).get();
            const o = (oR.data && oR.data[0]) || null;
            if (o && typeof o.status === 'string' && !/^(cancelled|failed|closed|completed|refunded)$/.test(o.status)) {
              order_id = o._id || o.order_no || null;
            }
          } catch (e) { log.d(`detail order reverse lookup fail: ${e.message}`); }
        }

        // 耍伴实时定位到履约地的直线距离(仅非发布者传 viewer_lat/viewer_lng): 需求有履约经纬度时计算
        let distanceKm = null;
        const demandLoc = d.location || {};
        const vLat = Number(viewer_lat);
        const vLng = Number(viewer_lng);
        const hasViewer = validLngLat(vLat, vLng);
        const hasDemandLoc = validLngLat(Number(demandLoc.latitude), Number(demandLoc.longitude));
        if (hasViewer && hasDemandLoc) {
          distanceKm = Math.round(haversineKm(
            vLat, vLng, Number(demandLoc.latitude), Number(demandLoc.longitude)
          ) * 10) / 10;
        }
        // 履约地址文本: demand.location.name(发布/更新均写入 name 作地址串, 兼容 update 落 location.address)
        const addressText = String(demandLoc.name || demandLoc.address || '').trim();

        // 推荐耍伴(需求详情横滑区; 失败/无候选 → [])
        const recommend_partners = await buildRecommendPartners(d);

        const data = {
          _id: d._id,
          order_id,
          demand_no: d.demand_no,
          scene_code: d.scene,
          project_attr: d.project_attr || 'commercial',
          title,
          description,
          content_options: Array.isArray(d.content_options) ? d.content_options : (d.content_option ? [d.content_option] : []),
          service_date,
          service_time,
          duration_hours: d.duration_h,
          location: d.location || { name: '', address: '' },
          district: (d.location && d.location.city) || '',
          address_text: addressText,
          distance_km: distanceKm,
          headcount: d.headcount || 1,
          // 计价分支: hourly=时薪(元); fixed=一口价(元, 取 total_fen); 存量无 pricing_type 按 hourly
          pricing_type: d.pricing_type || 'hourly',
          fixed_price_fen: d.fixed_price_fen || null,
          budget: (d.pricing_type === 'fixed')
            ? Math.round((d.total_fen || 0) / 100)
            : Math.round((d.rate_fen || 0) / 100),
          aa_estimate: d.aa_tier || '0-50',
          match_mode: d.match_mode || 'broadcast',
          gender_pref: d.gender_pref || '不限',
          // W9 宠物照料授权电子确认状态(编辑回填 + 详情展示)
          pet_auth_signed: !!d.pet_auth_signed,
          // 代他人发布(需求②): 性质对所有人可见(需求详情标识用); 被代发人详情仅本人回传(隐私; 编辑回填用)
          publish_type: d.publish_type || 'self',
          proxy_info: (d.publish_type === 'proxy') ? {
            is_proxy: true,
            relation: (d.service_target && d.service_target.relation) || ''
          } : { is_proxy: false, relation: '' },
          service_target: (d.creator_openid === openid) ? (d.service_target ? {
            name: d.service_target.name || '',
            relation: d.service_target.relation || '',
            relation_note: d.service_target.relation_note || '',
            phone: maskContact(d.service_target.phone || d.service_target.phone_mask || '')
          } : null) : undefined,
          // 发布者联系手机号: 仅本人回传(编辑回填展示用, 脱敏); 真号一律不回传
          contact_phone_masked: (d.creator_openid === openid) ? maskContact(d.contact_phone || '') : undefined,
          // 原始发布地址(只读留痕, 编辑模式回填用; 安全: 精确坐标仅发布者本人可见, 他人不回传)
          publish_location: (d.creator_openid === openid) ? (d.publish_location || null) : null,
          // 是否入公共大厅(定向需求不在大厅/首页出现)
          broadcast: !!d.broadcast,
          status: d.status,
          is_owner: d.creator_openid === openid,
          // 非发布者是否可接单: 选单走报名流程放行; 抢单需 broadcast; 定向需在受邀名单
          can_take: d.creator_openid === openid
            ? false
            : ((d.match_mode || 'broadcast') === 'select'
              || !!d.broadcast
              || ((d.invited || []).indexOf(openid) >= 0)),
          publisher: {
            surname,
            real_name_verified: true,
            credit_score: creditScore,
            minutes_ago
          },
          created_at: d.created_at,
          view_count: typeof d.view_count === 'number' ? d.view_count : 0,
          recommend_partners
        };
        return { ok: true, data };
      } catch (e) {
        log.d(`demand detail fail: ${e.message}`);
        return { ok: false, code: 'detail_fail', msg: '查询需求详情失败' };
      }
}

    // detail_light: 轻量状态查询(轮询用, 不自增 view_count, 只给状态+order_id)
    // 用于发布者端"接单后自动跳转确认页", 避免轮询污染浏览计数
async function detail_light_action(ctx) {
  const { event, openid, clientIp, device, action, wxCtx, col, log, isValidDocId } = ctx;
      const { demand_id } = event;
      if (!demand_id) return { ok: false, code: 'detail_no_id', msg: '缺少需求 ID' };
      if (!isValidDocId(demand_id)) return { ok: false, code: 'detail_bad_id', msg: '需求 ID 格式不正确' };
      try {
        const r = await col('demand').doc(demand_id).get();
        const d = r.data;
        if (!d || d.is_deleted) return { ok: false, code: 'detail_not_found', msg: '需求不存在或已删除' };
        let order_id = null;
        // 2026-10-30: 一并下发订单阶段 —— 前端「已有人接单」弹窗只应在 S2(已支付待履约)出现,
        // 此前只回 order_id, 订单推进到 S3/S3.6 后重进需求详情仍会弹「去确认」(阶段判据缺失)
        let order_status = '';
        if (d.status && d.status !== 'matching') {
          try {
            const oR = await col('order_main').where({ demand_id, is_deleted: false }).orderBy('created_at', 'desc').limit(1).get();
            const o = (oR.data && oR.data[0]) || null;
            if (o && typeof o.status === 'string' && !/^(cancelled|failed|closed|completed|refunded)$/.test(o.status)) {
              order_id = o._id || o.order_no || null;
              order_status = o.status;
            }
          } catch (e) { log.d(`detail_light order lookup fail: ${e.message}`); }
        }
        return { ok: true, data: { status: d.status, order_id, order_status, is_owner: d.creator_openid === openid } };
      } catch (e) {
        log.d(`detail_light fail: ${e.message}`);
        return { ok: false, code: 'detail_fail', msg: '查询需求状态失败' };
      }
}

module.exports = {
  my_demands: my_demands_action,
  detail: detail_action,
  detail_light: detail_light_action,
};
