// action_pay.js — 从 index.js 物理抽出, 行为逐字不变; 共享符号经 ctx 注入, 禁 require('./index')

    // 1. 收银台摘要(仅订单 user 可看)
async function cashierInfoAction(ctx) {
  const { event, openid, clientIp, device, action, SCENE_NAMES, getConfig, getOrder } = ctx;
      const { order_id } = event;
      if (!order_id) return { ok: false, code: 'cashier_no_order', msg: '缺少订单 ID' };
      // getOrder + getConfig 并行
      const [order, config] = await Promise.all([
        getOrder(order_id),
        getConfig()
      ]);
      if (!order) return { ok: false, code: 'cashier_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'cashier_not_owner', msg: '只能查看自己的订单' };
      }
      const sceneList = config.scene_list || [];
      const sceneConf = sceneList.find(s => s.code === order.scene) || {};
      // 0-50 元档免 AA 承诺书(兼容新旧档位取值:'0-50' / '0-50元')
      const needAaPromise = !!order.aa_tier && ['0-50', '0-50元'].indexOf(order.aa_tier) < 0;

      return {
        ok: true,
        data: {
          order_id: order._id,
          order_no: order.order_no,
          scene_code: order.scene,
          scene_name: sceneConf.name || SCENE_NAMES[order.scene] || order.scene,
          content_options: order.content_options || [],
          start_time: order.start_time,
          duration_h: order.duration_h,
          location: order.location,
          total_fen: order.total_fen,
          fee_fen: order.fee_fen,
          aa_tier: order.aa_tier || '',
          pricing_type: order.pricing_type || 'hourly',
          need_aa_promise: needAaPromise,
          status: order.status,
          pay_expire_at: order.pay_expire_at,
          is_mock: true
        }
      };
}

    // 2. 模拟支付
async function mockPayAction(ctx) {
  const { event, openid, clientIp, device, action, db, $, col, log, writeAudit, genPayNo, getOrder } = ctx;
      const { order_id, aa_promise_checked } = event;
      if (!order_id) return { ok: false, code: 'pay_no_order', msg: '缺少订单 ID' };

      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'pay_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'pay_not_owner', msg: '只能支付自己的订单' };
      }

      // 幂等:已有 success 支付流水直接返回成功(不重复执行)
      try {
        const exist = await col('pay_transaction').where({
          order_id, type: 'pay', status: 'success', is_deleted: false
        }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          log.d(`mock_pay idempotent hit: ${order.order_no}`);
          await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_pay', target_type: 'order', target_id: order_id, detail: { order_id, order_no: order.order_no, total_fen: order.total_fen, idempotent: true }, result: 'ok', client_ip: clientIp, device });
          return { ok: true, data: { order_id, order_no: order.order_no, status: order.status, idempotent: true } };
        }
      } catch (e) {}

      if (order.status !== 'S0') {
        return { ok: false, code: 'pay_status', msg: `订单当前状态(${order.status})不可支付` };
      }
      if (order.pay_expire_at && order.pay_expire_at < Date.now()) {
        return { ok: false, code: 'pay_expired', msg: '支付超时,请重新下单' };
      }
      // AA 承诺书:非 0-50 元档位必须勾选(兼容新旧档位取值)
      if (order.aa_tier && ['0-50', '0-50元'].indexOf(order.aa_tier) < 0 && !aa_promise_checked) {
        return { ok: false, code: 'pay_aa_promise', msg: '请先阅读并同意《线下费用自理承诺书》' };
      }

      const now = Date.now();
      const payNo = genPayNo('PAY');

      // ① CAS 抢占: S0→S2, 并发双发/超时取消只有一方成功(资金红线)
      let casRes;
      try {
        casRes = await col('order_main').where({ _id: order_id, status: 'S0' }).update({
          data: { status: 'S2', updated_at: now,
            // Wave1 正交位 dual-write(§3.2): 资金位在支付时落 paid_fen(支付为第一笔资金动作, 无历史退款)
            fund: { paid_fen: Number(order.total_fen) || 0, refunded_fen: 0, settle_state: 'pending', settled_at: 0 } }
        });
      } catch (e) {
        log.d(`mock_pay cas fail: ${e.message}`);
        return { ok: false, code: 'pay_db_fail', msg: '支付失败,请稍后重试' };
      }
      if (!casRes.stats || casRes.stats.updated !== 1) {
        // 未抢到: 查成功流水判幂等, 否则按最新状态给原因
        const dup = await col('pay_transaction').where({
          order_id, type: 'pay', status: 'success', is_deleted: false
        }).limit(1).get().catch(() => ({ data: [] }));
        if (dup.data && dup.data[0]) {
          const latest = await getOrder(order_id);
          log.d(`mock_pay idempotent after cas miss: ${order.order_no}`);
          await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_pay', target_type: 'order', target_id: order_id, detail: { order_id, order_no: order.order_no, total_fen: order.total_fen, idempotent: true }, result: 'ok', client_ip: clientIp, device });
          return { ok: true, data: { order_id, order_no: order.order_no, status: latest ? latest.status : 'S2', idempotent: true } };
        }
        const latest = await getOrder(order_id);
        if (latest && latest.status === 'S6') {
          return { ok: false, code: 'pay_closed', msg: '订单已取消,无法支付' };
        }
        return { ok: false, code: 'pay_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      }

      // ② 事务: 支付流水 + 状态流水同成同败; 失败补偿订单回 S0
      try {
        await db.runTransaction(async (t) => {
          await t.collection('pay_transaction').add({ data: {
            pay_no: payNo,
            order_id,
            order_no: order.order_no,
            type: 'pay',
            amount_fen: order.total_fen,
            fee_fen: order.fee_fen,
            channel: 'mock',
            is_mock: true,
            status: 'success',
            paid_at: now,
            created_at: now, updated_at: now, is_deleted: false
          }});
          await t.collection('order_status_log').add({ data: {
            order_id, from_status: 'S0', to_status: 'S2',
            action: 'mock_pay', operator: openid,
            created_at: now, updated_at: now, is_deleted: false
          }});
        });
      } catch (e) {
        log.d(`mock_pay txn fail: ${e.message}; compensating order ${order_id} → S0`);
        // 补偿须同时回滚 CAS 已写的资金正交位(paid_fen), 否则订单回到未支付(S0)却留有已付金额 → 结算/对账口径不一致
        await col('order_main').where({ _id: order_id, status: 'S2' }).update({
          data: { status: 'S0', fund: { paid_fen: 0, refunded_fen: 0, settle_state: 'pending', settled_at: 0 }, updated_at: Date.now() }
        }).catch(() => {});
        return { ok: false, code: 'pay_db_fail', msg: '支付失败,请稍后重试' };
      }

      log.d(`mock_pay success: ${order.order_no} pay_no=${payNo}`);
      // 支付成功通知耍伴(await 落库, 防函数 return 后异步写被回收; 失败不阻断资金链路)
      await Promise.allSettled([
        col('system_notice').add({ data: {
          to_openid: order.partner_openid, order_id, type: 'paid',
          title: '订单已支付', body: '请按时履约',
          action_key: 'jump_order', action_payload: { order_id },
          created_at: now, read: false
        }})
      ]);
      await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_pay', target_type: 'order', target_id: order_id, detail: { order_id, order_no: order.order_no, pay_no: payNo, total_fen: order.total_fen }, result: 'ok', client_ip: clientIp, device });
      return {
        ok: true,
        data: { order_id, order_no: order.order_no, pay_no: payNo, status: 'S2', is_mock: true }
      };
}

    // 3. 模拟全额退款(本期自动全额退款;demand 保持 matched)
async function mockRefundAction(ctx) {
  const { event, openid, clientIp, device, action, db, _, $, col, log, writeAudit, genPayNo, getOrder } = ctx;
      const { order_id } = event;
      if (!order_id) return { ok: false, code: 'refund_no_order', msg: '缺少订单 ID' };

      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'refund_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'refund_not_owner', msg: '只能对自己的订单申请退款' };
      }
      if (['S2', 'S3'].indexOf(order.status) < 0) {
        return { ok: false, code: 'refund_status', msg: `订单当前状态(${order.status})不可退款` };
      }

      // 幂等:已有退款流水直接返回(返回订单真实状态, 不硬编码)
      try {
        const exist = await col('pay_transaction').where({
          order_id, type: 'refund', status: 'success', is_deleted: false
        }).limit(1).get();
        if (exist.data && exist.data.length > 0) {
          const latest = await getOrder(order_id);
          log.d(`mock_refund idempotent hit: ${order.order_no}`);
          await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_refund', target_type: 'order', target_id: order_id, detail: { order_id, order_no: order.order_no, amount_fen: order.total_fen, idempotent: true }, result: 'ok', client_ip: clientIp, device });
          return { ok: true, data: { order_id, order_no: order.order_no, status: latest ? latest.status : 'S7', idempotent: true } };
        }
      } catch (e) {}

      const now = Date.now();
      const refundNo = genPayNo('REF');
      const fromStatus = order.status;   // S2 或 S3(已通过上面的状态校验)

      // ① CAS 抢占: S2/S3→S7, 并发双退只有一方成功
      let casRes;
      try {
        casRes = await col('order_main').where({
          _id: order_id, status: _.in(['S2', 'S3'])
        }).update({ data: { status: 'S7', refunded_at: now, updated_at: now,
          // Wave1 正交位 dual-write(§3.2): 全额自助退 → paid/refunded 同步(幂等检查已保证无历史退款)
          fund: { paid_fen: Number(order.total_fen) || 0, refunded_fen: Number(order.total_fen) || 0, settle_state: 'pending', settled_at: 0 } } });
      } catch (e) {
        log.d(`mock_refund cas fail: ${e.message}`);
        return { ok: false, code: 'refund_db_fail', msg: '退款失败,请联系管理员' };
      }
      if (!casRes.stats || casRes.stats.updated !== 1) {
        const dup = await col('pay_transaction').where({
          order_id, type: 'refund', status: 'success', is_deleted: false
        }).limit(1).get().catch(() => ({ data: [] }));
        if (dup.data && dup.data[0]) {
          const latest = await getOrder(order_id);
          await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_refund', target_type: 'order', target_id: order_id, detail: { order_id, order_no: order.order_no, amount_fen: order.total_fen, idempotent: true }, result: 'ok', client_ip: clientIp, device });
          return { ok: true, data: { order_id, order_no: order.order_no, status: latest ? latest.status : 'S7', idempotent: true } };
        }
        return { ok: false, code: 'refund_status_conflict', msg: '订单状态已变化,请刷新后重试' };
      }

      // ② 事务: 退款流水 + 状态流水; 失败补偿订单回原状态
      try {
        await db.runTransaction(async (t) => {
          await t.collection('pay_transaction').add({ data: {
            pay_no: refundNo,
            order_id,
            order_no: order.order_no,
            type: 'refund',
            amount_fen: order.total_fen,
            channel: 'mock',
            is_mock: true,
            status: 'success',
            paid_at: now,
            created_at: now, updated_at: now, is_deleted: false
          }});
          await t.collection('order_status_log').add({ data: {
            order_id, from_status: fromStatus, to_status: 'S7',
            action: 'mock_refund', operator: openid,
            created_at: now, updated_at: now, is_deleted: false
          }});
        });
      } catch (e) {
        log.d(`mock_refund txn fail: ${e.message}; compensating order ${order_id} → ${fromStatus}`);
        // 补偿须同时把 CAS 已写的已退金额清零(fund.refunded_fen), 否则订单回原态却显示"已退"
        await col('order_main').where({ _id: order_id, status: 'S7' }).update({
          data: { status: fromStatus, refunded_at: 0, 'fund.refunded_fen': 0, updated_at: Date.now() }
        }).catch(() => {});
        return { ok: false, code: 'refund_db_fail', msg: '退款失败,请联系管理员' };
      }

      log.d(`mock_refund success: ${order.order_no} refund_no=${refundNo}`);
      // 退款成功通知双方(await 落库, 防函数 return 后异步写被回收; 失败不阻断资金链路)
      await Promise.allSettled([
        col('system_notice').add({ data: {
          to_openid: order.user_openid, order_id, type: 'refund',
          title: '退款成功', body: '金额将原路返回',
          action_key: 'jump_order', action_payload: { order_id },
          created_at: now, read: false
        }}),
        col('system_notice').add({ data: {
          to_openid: order.partner_openid, order_id, type: 'refund',
          title: '订单已退款', body: '该订单已取消并退款',
          action_key: 'jump_order', action_payload: { order_id },
          created_at: now, read: false
        }})
      ]);
      await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_refund', target_type: 'order', target_id: order_id, detail: { order_id, order_no: order.order_no, refund_no: refundNo, amount_fen: order.total_fen }, result: 'ok', client_ip: clientIp, device });
      return {
        ok: true,
        data: { order_id, order_no: order.order_no, refund_no: refundNo, status: 'S7', is_mock: true }
      };
}

    // 4. 模拟打赏(已履约完成订单; 发单人主动给耍伴, 可多次; is_mock=true, 不改变订单状态)
async function mockTipAction(ctx) {
  const { event, openid, clientIp, device, action, db, _, $, col, log, writeAudit, isValidTipAmount, genPayNo, getOrder } = ctx;
      const { order_id, amount_fen } = event;
      if (!order_id) return { ok: false, code: 'tip_no_order', msg: '缺少订单 ID' };

      const order = await getOrder(order_id);
      if (!order) return { ok: false, code: 'tip_not_found', msg: '订单不存在' };
      if (order.user_openid !== openid) {
        return { ok: false, code: 'tip_not_owner', msg: '只能给自己的订单打赏' };
      }
      // 已履约完成: S5已完成 / S8已评价 / S9评价超时 / S10已关闭
      if (['S5', 'S8', 'S9', 'S10'].indexOf(order.status) < 0) {
        return { ok: false, code: 'tip_status', msg: `订单当前状态(${order.status})暂不能打赏,服务完成后可打赏` };
      }
      const amount = Number(amount_fen);
      if (!isValidTipAmount(amount)) {
        return { ok: false, code: 'tip_amount', msg: '打赏金额需为 1-500 元之间的整数' };
      }

      const now = Date.now();
      const tipNo = genPayNo('TIP');
      let tipTotal = amount;
      try {
        // 事务: 打赏流水 + 累计总额 同成同败; 事务内读旧总额计算新值(事务锁+快照隔离防并发丢失)
        await db.runTransaction(async (t) => {
          const cur = await t.collection('order_main').doc(order_id).get();
          tipTotal = ((cur.data && cur.data.tip_total_fen) || 0) + amount;
          // 打赏流水(is_mock=true; 逐笔记录: 金额+备注+时间)
          await t.collection('pay_transaction').add({ data: {
            pay_no: tipNo,
            order_id,
            order_no: order.order_no,
            partner_openid: order.partner_openid || '',  // 快照: 供耍伴钱包"打赏专栏"按人查询
            scene: order.scene || '',
            type: 'tip',
            amount_fen: amount,
            note: String(event.note || '').slice(0, 60),
            channel: 'mock',
            is_mock: true,
            status: 'success',
            paid_at: now,
            created_at: now, updated_at: now, is_deleted: false
          }});
          // 累计打赏总额: 原子 inc, 避免并发打赏读改写丢更新
          await t.collection('order_main').doc(order_id).update({ data: {
            tip_total_fen: _.inc(amount), updated_at: now
          }});
        });

        log.d(`mock_tip success: ${order.order_no} tip_no=${tipNo} amount=${amount}`);
        // 订单沟通同步: 通知耍伴收到打赏
        col('system_notice').add({ data: {
          to_openid: order.partner_openid, order_id, type: 'tip',
          title: '收到打赏',
          body: `发单人打赏了你 ¥${(amount / 100).toFixed(2)}`,
          action_key: 'jump_order', action_payload: { order_id },
          created_at: now, read: false
        }}).catch(e => log.d('[notice] tip fail:', e.message));
        await writeAudit(db, log, { openid, role: 'user', category: 'business', action: 'mock_tip', target_type: 'order', target_id: order_id, detail: { order_id, order_no: order.order_no, tip_no: tipNo, amount_fen: amount }, result: 'ok', client_ip: clientIp, device });
        return {
          ok: true,
          data: { order_id, order_no: order.order_no, tip_no: tipNo, amount_fen: amount, tip_total_fen: tipTotal, is_mock: true }
        };
      } catch (e) {
        log.d(`mock_tip fail: ${e.message}`);
        return { ok: false, code: 'tip_db_fail', msg: '打赏失败,请稍后重试' };
      }
}

module.exports = {
  cashier_info: cashierInfoAction,
  mock_pay: mockPayAction,
  mock_refund: mockRefundAction,
  mock_tip: mockTipAction,
};
