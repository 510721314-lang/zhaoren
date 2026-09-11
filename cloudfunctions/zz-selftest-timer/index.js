// 【临时自测函数】order-timer 超时流转端到端验证 · 验证后可删除本函数
// 分阶段状态机: 定时器每分钟触发 / 手动 {"action":"run"} 触发,
// 每次调用在 ~10 秒时间片内推进若干步, 进度持久化到 admin_config.zz_selftest_state,
// 超时/失败后下次触发从断点续跑(每步幂等)。
// 动作:
//   run(或缺省)  推进一步时间片
//   report       只读当前进度与断言结果
//   reset        清空自测状态(重新开始)
// 服务端用 mock_openid 串跨身份链路(云端函数间调用无 OPENID):
//   发单人 = test_partner_001, 耍伴 = 模拟器真实账号
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const col = (n) => db.collection(n);

const USER = 'test_partner_001';
const PARTNER = 'oLDJ73Yz_Yy_6yN5MrxhVlFDTw9c';
const STATE_ID = 'zz_selftest_state';
const REPORT_ID = 'zz_selftest_report';
const MARKER_ID = 'zz_selftest_marker';
const TIME_BUDGET_MS = 45000;   // 单次调用时间片预算(函数超时 60s, 留余量; 跨函数冷启动较慢)
const BUSY_STATUS = ['S0', 'S1', 'S2', 'S3', 'S3.5'];

async function call(name, data) {
  try {
    const r = await cloud.callFunction({ name, data });
    return r.result;
  } catch (e) {
    return { ok: false, _error: e.message };
  }
}

// 自驱动链: 每次运行一开始就"发射后不管"地预约下一次 run(不等子函数返回, 只留 500ms 让调用请求发出)。
// 子调用是独立函数实例, 各自拥有完整 3s 预算; 父实例即使 3s 超时被杀, 已发出的调用仍会执行。
// 每个实例最多预约 1 个子调用(1:1 链, 不会指数膨胀; 撞锁 skipped 的实例也照常预约, 链不断);
// phase=done 或重试耗尽则不再预约, 链自然终止; chain_gen 上限 40 兜底防失控。
const CHAIN_GEN_MAX = 40;
async function scheduleNext(gen) {
  try {
    const p = cloud.callFunction({
      name: 'zz-selftest-timer',
      data: { action: 'run', chain_gen: gen + 1 }
    });
    await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
  } catch (e) {}
}

async function getDoc(coll, id) {
  try { return (await col(coll).doc(id).get()).data; } catch (e) { return null; }
}

// 明天(北京时区)20:00 的时间戳 = UTC 次日 12:00
function tomorrowEightPm() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 12, 0, 0);
}

async function loadState() {
  const s = await getDoc('admin_config', STATE_ID);
  if (s) return s;
  return {
    _id: STATE_ID,
    phase: 'cleanup',
    demand_id: '', demand_no: '',
    order_a: { id: '', no: '' },
    order_b: { id: '', no: '' },
    a_pass: false, b_pass: false, idem_pass: false,
    steps: [],
    error: null,
    started_at: Date.now(),
    updated_at: Date.now()
  };
}

async function saveState(s) {
  s.updated_at = Date.now();
  try { await col('admin_config').doc(STATE_ID).set({ data: s }); }
  catch (e) { try { await col('admin_config').add({ data: s }); } catch (e2) {} }
}

function log(s, step, ok, info) {
  s.steps.push({ step, ok, info, at: Date.now() });
  console.log(`[SELFTEST] ${step} ok=${ok}`, JSON.stringify(info || {}));
}

// ───────────── 各阶段(每步幂等, 产物先落库再推进) ─────────────

// 0. 清理历史自测数据:
//    旧需求(matching/matched)一律置 cancelled(避开时间冲突/复用误捞);
//    旧订单除已终态 S6(取消)/S9(完成)外, 一律置 S6(避开耍伴忙碌校验, 也防止 S5/S0 等残留被当成本轮订单复用)。
//    同时记录本运行 epoch, 后续"超时复用"只认 epoch 之后新建的需求/订单, 彻底区分本轮产物与历史残留。
async function stepCleanup(s) {
  try {
    // 两条查询并行; 更新全部并行(3s 硬超时下串行逐条 update 会被杀在 cleanup)
    const [demands, orders] = await Promise.all([
      col('demand').where({
        creator_openid: USER, is_deleted: _.neq(true),
        status: _.in(['matching', 'matched'])
      }).limit(50).get(),
      col('order_main').where({
        user_openid: USER, is_deleted: _.neq(true),
        status: _.neq('S9')   // S6 重复置 S6 无害; 只放过已完成 S9
      }).limit(50).get()
    ]);
    const demandList = demands.data || [];
    const orderList = (orders.data || []).filter((o) => o.status !== 'S6');
    await Promise.all([
      ...demandList.map((d) =>
        col('demand').doc(d._id).update({ data: { status: 'cancelled', updated_at: Date.now() } }).catch(() => {})),
      ...orderList.map((o) =>
        col('order_main').doc(o._id).update({ data: { status: 'S6', updated_at: Date.now() } }).catch(() => {}))
    ]);
    s.epoch = Date.now();
    await saveState(s);
    log(s, '0-cleanup', true, { demands_cancelled: demandList.length, orders_closed: orderList.length });
  } catch (e) {
    log(s, '0-cleanup', false, { error: e.message });
    throw e;
  }
  s.phase = 'publish_a';
}

// 查该需求下耍伴的最新订单(超时复用时用); minCreatedAt 限定只认本轮新建订单, 排除历史残留
async function findOrder(demandId, partner, excludeStatus, minCreatedAt) {
  try {
    const q = { demand_id: demandId, partner_openid: partner };
    if (excludeStatus) q.status = _.neq(excludeStatus);
    if (minCreatedAt) q.created_at = _.gte(minCreatedAt);
    const r = await col('order_main').where(q).orderBy('created_at', 'desc').limit(1).get();
    return (r.data && r.data[0]) || null;
  } catch (e) { return null; }
}

// A1. 发布需求(注意: 成功返回 data._id; 必传 aa_promise_checked)
async function stepPublishA(s) {
  if (!s.demand_id) {
    // 超时复用: 只认本轮 cleanup(epoch)之后新建的需求, 排除历史残留的 matched 旧需求
    const exist = await col('demand').where({
      creator_openid: USER, scene: 'W1', is_deleted: _.neq(true),
      status: _.in(['matching', 'matched']),
      created_at: _.gte(s.epoch || 0)
    }).orderBy('created_at', 'desc').limit(1).get();
    if (exist.data && exist.data[0]) {
      s.demand_id = exist.data[0]._id;
      s.demand_no = exist.data[0].demand_no || '';
      await saveState(s);
      log(s, 'A1-publish-reuse', true, { demand_id: s.demand_id });
    } else {
      let pub;
      try {
        pub = await call('demand-publish', {
          action: 'publish', scene: 'W1',
          content_options: ['陪诊解压'],
          start_time: tomorrowEightPm(), duration_h: 2, rate_fen: 5000,
          aa_tier: '0-50元', aa_promise_checked: true,
          location: { name: '成都市宽窄巷子(自测)', city: '成都', latitude: 30.6686, longitude: 104.0597 },
          publish_location: { name: '成都市宽窄巷子(自测发布点)', city: '成都', latitude: 30.6686, longitude: 104.0597 },
          mock_openid: USER
        });
      } catch (e) {
        log(s, 'A1-publish-raw', false, { threw: String(e && e.message || e) });
        await saveState(s);
        throw new Error(`publish_a call threw: ${e && e.message || e}`);
      }
      // 原始返回即时落库(无论成功失败), 便于定位
      log(s, 'A1-publish-raw', !!(pub && pub.ok), {
        ok: pub && pub.ok, code: pub && pub.code, msg: pub && pub.msg,
        err: pub && pub._error, has_id: !!(pub && pub.data && pub.data._id)
      });
      await saveState(s);
      const id = pub && pub.data && pub.data._id;
      if (!pub || !pub.ok || !id) throw new Error(`publish_a failed: ${(pub && (pub.msg || pub.code || pub._error)) || 'no _id'}`);
      s.demand_id = id;
      s.demand_no = pub.data.demand_no || '';
      await saveState(s);
    }
  }
  log(s, 'A1-publish', true, { demand_id: s.demand_id, demand_no: s.demand_no });
  s.phase = 'take_a';
}

// A2. 耍伴接单
async function stepTakeA(s) {
  if (!s.order_a.id) {
    // 超时复用: 上次接单可能已落库(订单已建、需求已 matched)但响应被 3s 超时截断,
    // 此时重新 create_from_take 会被「该需求已不可接单」拒绝, 直接复用已建订单。
    const exist = await findOrder(s.demand_id, PARTNER, null, s.epoch || 0);
    if (exist) {
      s.order_a = { id: exist._id, no: exist.order_no || '' };
      await saveState(s);
      log(s, 'A2-take-reuse', true, { order_id: exist._id, status: exist.status });
    } else {
      // 新需求默认仅定向邀约, 接单前先由发单人广播(否则 order-create 拒绝非邀约接单)
      await call('demand-match', { action: 'broadcast', demand_id: s.demand_id, mock_openid: USER });
      const r = await call('order-create', {
        action: 'create_from_take', demand_id: s.demand_id, mock_openid: PARTNER,
        partner_location: { latitude: 30.67, longitude: 104.06 }   // 距履约点(宽窄巷子)<1km, 过 50km 校验
      });
      const id = r && r.data && r.data.order_id;
      if (!r || !r.ok || !id) throw new Error(`take_a failed: ${(r && (r.msg || r.code || r._error)) || 'no order_id'}`);
      s.order_a = { id, no: r.data.order_no || '' };
      await saveState(s);
    }
  }
  log(s, 'A2-take', true, s.order_a);
  s.phase = 'timer_a';
}

// A3. order-timer s1 超时(阈值 0 分钟) → 订单 S6 + 需求释放回 matching
async function stepTimerA(s) {
  const timer = await call('order-timer', { action: 'run', s1_timeout_min: 0 });
  const o = await getDoc('order_main', s.order_a.id);
  const d = await getDoc('demand', s.demand_id);
  const pass = !!(o && o.status === 'S6' && d && d.status === 'matching');
  s.a_pass = pass;
  log(s, 'A3-assert-s1-cancel', pass, {
    timer_ok: !!(timer && timer.ok),
    order_status: o && o.status, demand_status: d && d.status,
    counts: timer && timer.data && timer.data.counts
  });
  if (!pass) throw new Error('A3 assert failed: order not S6 or demand not matching');
  s.phase = 'take_b';
}

// B1. 同一需求再次接单
async function stepTakeB(s) {
  if (!s.order_b.id) {
    const r = await call('order-create', {
      action: 'create_from_take', demand_id: s.demand_id, mock_openid: PARTNER,
      partner_location: { latitude: 30.67, longitude: 104.06 }   // 距履约点(宽窄巷子)<1km, 过 50km 校验
    });
    let id = r && r.data && r.data.order_id;
    let no = (r && r.data && r.data.order_no) || '';
    if (!r || !r.ok || !id) {
      // 超时复用: B 单不会是 S6(A 单才是), 排除 S6 找最新单; 且只认本轮 epoch 后新建
      const o = await findOrder(s.demand_id, PARTNER, 'S6', s.epoch || 0);
      if (o) {
        id = o._id; no = o.order_no || '';
        log(s, 'B1-retake-reuse', true, { order_id: id, status: o.status });
      } else {
        throw new Error(`take_b failed: ${(r && (r.msg || r.code)) || 'no order_id'}`);
      }
    }
    s.order_b = { id, no };
    await saveState(s);
  }
  log(s, 'B1-retake', true, s.order_b);
  s.phase = 'confirm_user';
}

// B2. 发单人四确认(已确认则跳过, 保证重入幂等)
async function stepConfirmUser(s) {
  const o = await getDoc('order_main', s.order_b.id);
  if (o && ['S0', 'S2', 'S3', 'S5', 'S8', 'S9'].indexOf(o.status) >= 0) {
    log(s, 'B2-confirm-user', true, { skipped: true, status: o.status });
  } else {
    const r = await call('order-action', { action: 'confirm_all', order_id: s.order_b.id, mock_openid: USER });
    if (!r || !r.ok) throw new Error(`confirm_user failed: ${(r && (r.msg || r.code)) || 'error'}`);
    log(s, 'B2-confirm-user', true, { confirmed_count: r.data && r.data.confirmed_count });
  }
  s.phase = 'confirm_partner';
}

// B3. 耍伴四确认 → 全部确认后订单 S0
async function stepConfirmPartner(s) {
  const o = await getDoc('order_main', s.order_b.id);
  if (o && ['S0', 'S2', 'S3', 'S5', 'S8', 'S9'].indexOf(o.status) >= 0) {
    log(s, 'B3-confirm-partner', true, { skipped: true, status: o.status });
    s.phase = 'pay_b';
    return;
  }
  const r = await call('order-action', { action: 'confirm_all', order_id: s.order_b.id, mock_openid: PARTNER });
  const status = r && r.data && r.data.status;
  if (!r || !r.ok || status !== 'S0') throw new Error(`confirm_partner failed: status=${status} msg=${(r && r.msg) || 'error'}`);
  log(s, 'B3-confirm-partner', true, { status, all_confirmed: r.data.all_confirmed });
  s.phase = 'pay_b';
}

// B4. 模拟支付 → S2(mock_pay 自身幂等)
async function stepPay(s) {
  const o = await getDoc('order_main', s.order_b.id);
  if (o && ['S2', 'S3', 'S5', 'S8', 'S9'].indexOf(o.status) >= 0) {
    log(s, 'B4-pay', true, { skipped: true, status: o.status });
  } else {
    const r = await call('payment-mock', { action: 'mock_pay', order_id: s.order_b.id, aa_promise_checked: true, mock_openid: USER });
    const status = r && r.data && r.data.status;
    if (!r || !r.ok || (status !== 'S2' && !r.data.idempotent)) {
      throw new Error(`pay failed: status=${status} msg=${(r && r.msg) || 'error'}`);
    }
    log(s, 'B4-pay', true, { status, idempotent: !!(r.data && r.data.idempotent) });
  }
  s.phase = 'start_b';
}

// B5. 耍伴开始履约 S2 → S3
async function stepStart(s) {
  const o = await getDoc('order_main', s.order_b.id);
  if (o && ['S3', 'S5', 'S8', 'S9'].indexOf(o.status) >= 0) {
    log(s, 'B5-start', true, { skipped: true, status: o.status });
  } else {
    const r = await call('order-action', { action: 'start_service', order_id: s.order_b.id, mock_openid: PARTNER });
    const status = r && r.data && r.data.status;
    if (!r || !r.ok || status !== 'S3') throw new Error(`start failed: status=${status} msg=${(r && r.msg) || 'error'}`);
    log(s, 'B5-start', true, { status });
  }
  s.phase = 'complete_b';
}

// B6. 耍伴完成履约 S3 → S5
async function stepComplete(s) {
  const o = await getDoc('order_main', s.order_b.id);
  if (o && ['S5', 'S8', 'S9'].indexOf(o.status) >= 0) {
    log(s, 'B6-complete', true, { skipped: true, status: o.status });
  } else {
    const r = await call('order-action', { action: 'complete_service', order_id: s.order_b.id, mock_openid: PARTNER });
    const status = r && r.data && r.data.status;
    if (!r || !r.ok || status !== 'S5') throw new Error(`complete failed: status=${status} msg=${(r && r.msg) || 'error'}`);
    log(s, 'B6-complete', true, { status });
  }
  s.phase = 'timer_b';
}

// B7. order-timer 评价窗口超时(阈值 0 小时) → S9 + 系统默认 4 星评价 + 耍伴信用分 +1
async function stepTimerB(s) {
  const timer = await call('order-timer', { action: 'run', eval_window_h: 0 });
  const o = await getDoc('order_main', s.order_b.id);
  let ev = null, clog = null;
  try {
    const evR = await col('evaluation').where({ order_id: s.order_b.id }).limit(1).get();
    ev = evR.data && evR.data[0];
  } catch (e) {}
  try {
    const logR = await col('credit_score_log').where({ order_id: s.order_b.id, is_system: true }).limit(1).get();
    clog = logR.data && logR.data[0];
  } catch (e) {}
  const pass = !!(o && o.status === 'S9' && ev && ev.star === 4 && ev.content === '系统默认评价' && clog && clog.delta === 1);
  s.b_pass = pass;
  log(s, 'B7-assert-auto-eval', pass, {
    order_status: o && o.status,
    star: ev && ev.star, content: ev && ev.content, is_system: ev && ev.is_system,
    credit_delta: clog && clog.delta,
    counts: timer && timer.data && timer.data.counts
  });
  if (!pass) throw new Error('B7 assert failed: not S9 or system evaluation missing');
  s.phase = 'idempotent';
}

// C. 幂等: 再跑一次, 不应有任何流转
async function stepIdempotent(s) {
  const timer = await call('order-timer', { action: 'run', s1_timeout_min: 0, eval_window_h: 0 });
  const c = timer && timer.data && timer.data.counts;
  const pass = !!c && c.s1_cancel === 0 && c.s0_close === 0 &&
    c.interrupt_partial === 0 && c.auto_eval === 0;
  s.idem_pass = pass;
  log(s, 'C-idempotent', pass, { counts: c });
  if (!pass) throw new Error('C assert failed: timer processed orders on second run');
  s.phase = 'done';
}

// 收尾: 写汇总报告
async function stepDone(s) {
  const report = {
    _id: REPORT_ID,
    ran_at: Date.now(),
    demand_id: s.demand_id, demand_no: s.demand_no,
    order_a: s.order_a, order_b: s.order_b,
    a_pass: s.a_pass, b_pass: s.b_pass, idempotent_pass: s.idem_pass,
    all_pass: !!(s.a_pass && s.b_pass && s.idem_pass),
    steps: s.steps
  };
  try { await col('admin_config').doc(REPORT_ID).set({ data: report }); }
  catch (e) { try { await col('admin_config').add({ data: report }); } catch (e2) {} }
  log(s, 'DONE', report.all_pass, { a_pass: s.a_pass, b_pass: s.b_pass, idem_pass: s.idem_pass });
}

const STEPS = {
  cleanup: stepCleanup,
  publish_a: stepPublishA,
  take_a: stepTakeA,
  timer_a: stepTimerA,
  take_b: stepTakeB,
  confirm_user: stepConfirmUser,
  confirm_partner: stepConfirmPartner,
  pay_b: stepPay,
  start_b: stepStart,
  complete_b: stepComplete,
  timer_b: stepTimerB,
  idempotent: stepIdempotent,
  done: stepDone
};

// ───────────── 手动播种: 测试账号发一笔需求并广播(供真机验证接单流程) ─────────────
// 触发: 云端测试面板 {"action":"seed"}; 链式自驱 seed_step 推完 publish→broadcast,
// 完成后该需求出现在接单大厅(hall_list 只看 broadcast:true), 真机耍伴账号可直接接单。
const SEED_STATE_ID = 'zz_seed_state';
const SEED_MARKER_ID = 'zz_seed_marker';

async function seedScheduleNext(gen) {
  try {
    const p = cloud.callFunction({
      name: 'zz-selftest-timer',
      data: { action: 'seed_step', chain_gen: gen + 1 }
    });
    await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
  } catch (e) {}
}

async function seedGetDoc(id) {
  try { return (await col('admin_config').doc(id).get()).data; } catch (e) { return null; }
}
async function seedSave(s) {
  s.updated_at = Date.now();
  try { await col('admin_config').doc(SEED_STATE_ID).set({ data: s }); }
  catch (e) { try { await col('admin_config').add({ data: s }); } catch (e2) {} }
}
function seedLog(s, step, ok, info) {
  s.steps.push({ step, ok, info, at: Date.now() });
  console.log(`[SEED] ${step} ok=${ok}`, JSON.stringify(info || {}));
}

// 阶段1: 以测试发单账号 USER 发布一笔新需求(每次 seed 都发新单)
async function seedPhasePublish(s) {
  // 超时复用: 30 分钟内已存在的同场景播种单(remark=接单验证)直接复用,
  // 排除 zz 全流程自测留下的同场景残留单
  const recent = await col('demand').where({
    creator_openid: USER, scene: 'W1', remark: '接单验证', is_deleted: _.neq(true),
    status: _.in(['matching', 'matched']),
    created_at: _.gte(Date.now() - 30 * 60 * 1000)
  }).orderBy('created_at', 'desc').limit(1).get();
  if (recent.data && recent.data[0]) {
    s.demand_id = recent.data[0]._id;
    s.demand_no = recent.data[0].demand_no || '';
    await seedSave(s);
    seedLog(s, 'publish-reuse', true, { demand_id: s.demand_id });
    s.phase = 'broadcast';
    return;
  }
  const pub = await call('demand-publish', {
    action: 'publish', scene: 'W1',
    content_options: ['陪诊解压'],   // 必须是该场景 options 白名单内的精确值
    remark: '接单验证',
    start_time: tomorrowEightPm(), duration_h: 2, rate_fen: 5000,
    aa_tier: '0-50元', aa_promise_checked: true,
    location: { name: '成都市宽窄巷子(接单验证)', city: '成都', latitude: 30.6686, longitude: 104.0597 },
    publish_location: { name: '成都市宽窄巷子(验证发布点)', city: '成都', latitude: 30.6686, longitude: 104.0597 },
    mock_openid: USER
  });
  seedLog(s, 'publish-raw', !!(pub && pub.ok), {
    ok: pub && pub.ok, code: pub && pub.code, msg: pub && pub.msg,
    err: pub && pub._error, has_id: !!(pub && pub.data && pub.data._id)
  });
  const id = pub && pub.data && pub.data._id;
  if (!pub || !pub.ok || !id) throw new Error(`seed publish failed: ${(pub && (pub.msg || pub.code || pub._error)) || 'no _id'}`);
  s.demand_id = id;
  s.demand_no = pub.data.demand_no || '';
  await seedSave(s);
  s.phase = 'broadcast';
}

// 阶段2: 发单人广播到接单大厅并校验
async function seedPhaseBroadcast(s) {
  const r = await call('demand-match', {
    action: 'broadcast', demand_id: s.demand_id, mock_openid: USER
  });
  if (!r || !r.ok) throw new Error(`seed broadcast failed: ${(r && (r.msg || r.code || r._error)) || 'error'}`);
  const d = await getDoc('demand', s.demand_id);
  if (!d || d.broadcast !== true || d.status !== 'matching') {
    throw new Error(`seed broadcast verify failed: broadcast=${d && d.broadcast} status=${d && d.status}`);
  }
  seedLog(s, 'broadcast', true, { demand_id: s.demand_id, demand_no: s.demand_no });
  s.phase = 'done';
}

const SEED_PHASES = { publish: seedPhasePublish, broadcast: seedPhaseBroadcast };

// ───────────── 主入口 ─────────────
exports.main = async (event) => {
  const action = (event && event.action) || 'run';

  // ── 播种: 单实例内直接写库完成「发单+广播」, 一次调用必然完成(不跨调子函数, 规避 3s 超时) ──
  if (action === 'seed') {
    const now = Date.now();
    // 1) 上一笔仍无人接单的播种单(remark=接单验证)先取消, 避免大厅堆积
    try {
      const oldR = await col('demand').where({
        creator_openid: USER, remark: '接单验证',
        status: 'matching', is_deleted: _.neq(true)
      }).limit(10).get();
      for (const d of (oldR.data || [])) {
        await col('demand').doc(d._id).update({ data: { status: 'cancelled', updated_at: now } }).catch(() => {});
      }
    } catch (e) {}

    // 1.5) 确保发单测试账号存在且正常(直接写库绕过登录; order-create 接单会校验 creator 状态/信用分)
    try {
      const cu = await col('user_account').where({ openid: USER }).limit(1).get();
      if (!cu.data || cu.data.length === 0) {
        await col('user_account').add({
          data: {
            openid: USER, nickname: '发单测试号', avatar: '',
            roles: ['user'],
            user_credit_score: 800, partner_credit_score: 800,
            is_realname_done: false, is_realname_simulated: true,
            age: null, status: 'normal', register_source: 'selftest_seed',
            created_at: now, updated_at: now, is_deleted: false
          }
        });
      }
    } catch (e) {}

    // 2) 直接插入与 demand-publish 完全同构的需求文档, 并一次性置广播态
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    const dd = new Date();
    const demandNo = `DR${dd.getFullYear()}${pad(dd.getMonth() + 1)}${pad(dd.getDate())}${Math.floor(100000 + Math.random() * 900000)}`;
    const rateFen = 5000, durationH = 2;
    const doc = {
      demand_no: demandNo,
      creator_openid: USER,
      scene: 'W1',
      start_time: tomorrowEightPm(),
      duration_h: durationH,
      location: { name: '成都市宽窄巷子(接单验证)', latitude: 30.6686, longitude: 104.0597, city: '成都' },
      publish_location: { name: '成都市宽窄巷子(验证发布点)', latitude: 30.6686, longitude: 104.0597, city: '成都' },
      content_option: '陪诊解压',
      content_options: ['陪诊解压'],
      remark: '接单验证',
      rate_fen: rateFen,
      total_fen: rateFen * durationH,
      aa_tier: '0-50元',
      aa_promise_signed: true,
      match_mode: 'broadcast',   // 直接广播, 上接单大厅
      status: 'matching',
      match_candidates: [],
      invited: [],
      broadcast: true,
      expire_at: now + 24 * 3600 * 1000,
      created_at: now, updated_at: now, is_deleted: false
    };

    try {
      const addRes = await col('demand').add({ data: doc });
      const s = {
        _id: SEED_STATE_ID, phase: 'done',
        demand_id: addRes._id, demand_no: demandNo,
        steps: [{ step: 'seed-direct', ok: true, at: now }],
        error: null, started_at: now, updated_at: now
      };
      await seedSave(s);
      return {
        ok: true, seed: 'done',
        demand_id: addRes._id, demand_no: demandNo,
        msg: '已发布并广播, 接单大厅下拉刷新可见'
      };
    } catch (e) {
      return { ok: false, code: 'seed_db_fail', msg: `播种写库失败: ${e.message}` };
    }
  }

  // ── 播种订单推进: 发单方四确认 → 必要时代耍伴确认到 S0 → 模拟支付到 S2 ──
  // 幂等可重复调用; 时间片 2.5s 内尽量多推进, 被杀后再次调用从当前态续跑
  if (action === 'seed_advance') {
    const st = await seedGetDoc(SEED_STATE_ID);
    const demandId = st && st.demand_id;
    if (!demandId) return { ok: false, code: 'no_seed', msg: '尚未播种, 请先运行 {"action":"seed"}' };

    // 定位该播种需求最新一笔订单(真机耍伴接单后生成)
    const oq = await col('order_main').where({
      demand_id: demandId, is_deleted: _.neq(true)
    }).orderBy('created_at', 'desc').limit(1).get();
    let order = oq.data && oq.data[0];
    if (!order) {
      return { ok: false, code: 'no_order', msg: '尚未检测到接单订单, 请先在手机端「立即接单」并提示成功' };
    }

    const trace = [];
    const t0 = Date.now();
    const timeLeft = () => Date.now() - t0 < 2500;
    const refresh = async () => { order = await getDoc('order_main', order._id); };

    // 终态/异常态直接回报
    if (['S6', 'S7', 'S10', 'S10.5'].indexOf(order.status) >= 0) {
      return { ok: false, code: 'order_terminal', status: order.status, order_no: order.order_no, msg: `订单已是终态 ${order.status}, 无法推进` };
    }

    const errMsg = (r) => (r && (r.msg || r.code || r._error)) || null;
    // 1) S1 → 发单方四确认
    if (order.status === 'S1') {
      const r1 = await call('order-action', { action: 'confirm_all', order_id: order._id, mock_openid: USER });
      trace.push({ step: 'confirm_user', ok: !!(r1 && r1.ok), status: r1 && r1.data && r1.data.status, msg: errMsg(r1) });
      await refresh();
    }

    // 2) 仍 S1(真机耍伴未做四确认) → 代耍伴确认, 凑齐 8 项到 S0
    if (order && order.status === 'S1' && timeLeft()) {
      const r2 = await call('order-action', { action: 'confirm_all', order_id: order._id, mock_openid: order.partner_openid });
      trace.push({ step: 'confirm_partner', ok: !!(r2 && r2.ok), status: r2 && r2.data && r2.data.status, msg: errMsg(r2) });
      await refresh();
    }

    // 3) S0 → 模拟支付 → S2
    if (order && order.status === 'S0' && timeLeft()) {
      const r3 = await call('payment-mock', { action: 'mock_pay', order_id: order._id, aa_promise_checked: true, mock_openid: USER });
      trace.push({ step: 'pay', ok: !!(r3 && r3.ok), status: r3 && r3.data && r3.data.status, idempotent: !!(r3 && r3.data && r3.data.idempotent), msg: errMsg(r3) });
      await refresh();
    }

    const done = order.status === 'S2' || ['S3', 'S3.5', 'S5', 'S8', 'S9'].indexOf(order.status) >= 0;
    return {
      ok: true,
      order_no: order.order_no, order_id: order._id, status: order.status,
      paid: done, trace,
      msg: done
        ? `已推进到 ${order.status}(发单确认+支付完成), 手机端订单详情下拉刷新可见`
        : `当前 ${order.status}, 若调用超时请再运行一次 {"action":"seed_advance"}(幂等续跑)`
    };
  }

  // ── 播种状态查询(只读) ──
  if (action === 'seed_report') {
    const s = await seedGetDoc(SEED_STATE_ID);
    if (!s) return { ok: true, ran: false, msg: '尚未播种' };
    return {
      ok: true, ran: true, phase: s.phase, error: s.error,
      demand_id: s.demand_id, demand_no: s.demand_no, steps: s.steps
    };
  }

  // ── 播种链式推进(每实例只跑一个阶段, 3s 预算内安全) ──
  if (action === 'seed_step') {
    const s = await seedGetDoc(SEED_STATE_ID);
    if (!s) return { ok: false, msg: 'seed state missing; run {"action":"seed"} first' };
    if (s.phase === 'done') return { ok: true, phase: 'done', demand_id: s.demand_id, demand_no: s.demand_no };

    const chainGen = (event && typeof event.chain_gen === 'number') ? event.chain_gen : 0;
    // 链式自驱在部分触发方式下可能不生效, 仅作辅助; 主要靠手动重复调用本动作推进
    if (chainGen > 0 && chainGen < CHAIN_GEN_MAX) await seedScheduleNext(chainGen);

    // 并发锁(TTL 5s, 手动连续调用时稍等即可)
    const lock = await seedGetDoc(SEED_MARKER_ID);
    if (lock && lock.at && Date.now() - lock.at < 5000) {
      return { ok: true, skipped: true, phase: s.phase };
    }
    try { await col('admin_config').doc(SEED_MARKER_ID).set({ data: { _id: SEED_MARKER_ID, at: Date.now() } }); }
    catch (e) { try { await col('admin_config').add({ data: { _id: SEED_MARKER_ID, at: Date.now() } }); } catch (e2) {} }

    // error 态: 重试失败阶段(最多 10 次)
    if (s.phase === 'error') {
      const retryPhase = s.error && s.error.step;
      s._retries = (s._retries || 0) + 1;
      if (retryPhase && SEED_PHASES[retryPhase] && s._retries <= 10) {
        s.phase = retryPhase; s.error = null;
      } else {
        await seedSave(s);
        return { ok: false, phase: 'error', error: s.error, msg: '播种失败超过重试上限' };
      }
    }

    // 在时间片预算内尽量多推进几个阶段(每步落库, 被杀可断点续跑)
    const start = Date.now();
    try {
      while (s.phase !== 'done' && s.phase !== 'error' && Date.now() - start < 2500) {
        const phase = s.phase;
        const fn = SEED_PHASES[phase];
        if (!fn) throw new Error(`unknown seed phase: ${phase}`);
        await fn(s);
        await seedSave(s);
      }
    } catch (e) {
      s.error = { step: s.phase, message: e.message };
      s.phase = 'error';
      await seedSave(s);
      console.log(`[SEED] fatal: ${e.message}`);
    }
    await col('admin_config').doc(SEED_MARKER_ID).remove().catch(() => {});
    return {
      ok: s.phase !== 'error', phase: s.phase, error: s.error,
      demand_id: s.demand_id, demand_no: s.demand_no
    };
  }

  // 只读报告
  if (action === 'report') {
    const s = await getDoc('admin_config', STATE_ID);
    if (!s) return { ok: true, ran: false, msg: 'selftest never ran' };
    return {
      ok: true, ran: true, phase: s.phase, error: s.error,
      a_pass: s.a_pass, b_pass: s.b_pass, idempotent_pass: s.idem_pass,
      all_pass: !!(s.a_pass && s.b_pass && s.idem_pass && s.phase === 'done'),
      demand_id: s.demand_id, order_a: s.order_a, order_b: s.order_b,
      steps: s.steps
    };
  }

  // 重置
  if (action === 'reset') {
    for (const id of [STATE_ID, REPORT_ID, MARKER_ID]) {
      try { await col('admin_config').doc(id).remove(); } catch (e) {}
    }
    // 重置后自动点火: 预约第一次 run, 之后链式自驱动直到 done, 无需手动连点
    await scheduleNext(-1); // 首个 run 的 chain_gen = 0
    return { ok: true, reset: true, auto_started: true, msg: '链式自测已自动开始, 约2-4分钟后用 report 查看结果' };
  }

  // 推进时间片
  const s = await loadState();
  if (s.phase === 'done') {
    return { ok: true, phase: 'done', all_pass: !!(s.a_pass && s.b_pass && s.idem_pass), a_pass: s.a_pass, b_pass: s.b_pass, idempotent_pass: s.idem_pass, msg: 'already done; use reset to rerun' };
  }
  if (s.phase === 'error') {
    // 每步幂等(产物先落库+跳过检查),失败阶段下次触发自动重试;
    // 同一阶段连续失败 3 次则放弃, 等人工 reset
    const retryPhase = s.error && s.error.step;
    s._retries = (s._retries || 0) + 1;
    // 重试上限放宽到 30 次(约 30 分钟): 依赖函数被修复后, 定时器可自动续跑, 无需手动 reset
    if (retryPhase && STEPS[retryPhase] && s._retries <= 30) {
      console.log(`[SELFTEST] retry phase ${retryPhase} (attempt ${s._retries})`);
      s.phase = retryPhase;
      s.error = null;
    } else {
      await saveState(s);
      return { ok: false, phase: 'error', error: s.error, retries: s._retries, steps: s.steps, msg: 'phase failed 30 times; use reset to rerun' };
    }
  }

  // ── 链式自驱动: 尽早预约下一次调用(在加锁之前, 这样撞锁 skipped 的实例也能把链续上) ──
  // done 与重试耗尽已在上面 return; 能走到这里说明本次应当推进, 预约后继者。
  const chainGen = (event && typeof event.chain_gen === 'number') ? event.chain_gen : 0;
  if (chainGen < CHAIN_GEN_MAX) {
    await scheduleNext(chainGen);
  }

  // ── 并发锁: 防止重复触发互相用旧快照 set() 覆盖进度 ──
  // 当前环境硬超时 3s, 单次运行最多 ~3s 且被杀时来不及主动删锁,
  // 故 TTL 取 8s: 够挡住同秒重复点击, 又不必长时间等待(实测定时触发器 CLI 不生效, 只能手动连点)。
  const LOCK_TTL = 8000;
  let lock = null;
  try { lock = await getDoc('admin_config', MARKER_ID); } catch (e) {}
  if (lock && lock.at && (Date.now() - lock.at < LOCK_TTL)) {
    return { ok: true, skipped: true, msg: '另一个自测运行正在进行, 本次跳过(防并发覆盖)' };
  }
  try { await col('admin_config').doc(MARKER_ID).set({ data: { _id: MARKER_ID, at: Date.now() } }); }
  catch (e) { try { await col('admin_config').add({ data: { _id: MARKER_ID, at: Date.now() } }); } catch (e2) {} }

  const start = Date.now();
  try {
    while (s.phase !== 'done' && s.phase !== 'error') {
      if (Date.now() - start > TIME_BUDGET_MS) break;
      const fn = STEPS[s.phase];
      if (!fn) { s.error = { step: s.phase, message: 'unknown phase' }; s.phase = 'error'; break; }
      const failedPhase = s.phase;
      await fn(s);
      await saveState(s);
    }
  } catch (e) {
    // 先记下失败阶段, 再把 phase 置为 error(顺序不能反, 否则 error.step 永远是 'error')
    const failedPhase = s.phase;
    s.error = { step: failedPhase, message: e.message };
    s.phase = 'error';
    await saveState(s);
    console.log(`[SELFTEST] fatal at ${failedPhase}: ${e.message}`);
    try { await col('admin_config').doc(MARKER_ID).remove(); } catch (e2) {}
    return { ok: false, phase: 'error', error: s.error, steps: s.steps };
  }

  try { await col('admin_config').doc(MARKER_ID).remove(); } catch (e) {}

  return {
    ok: true,
    phase: s.phase,
    done: s.phase === 'done',
    all_pass: !!(s.a_pass && s.b_pass && s.idem_pass && s.phase === 'done'),
    a_pass: s.a_pass, b_pass: s.b_pass, idempotent_pass: s.idem_pass,
    order_a: s.order_a, order_b: s.order_b
  };
};
