// order-view 纯映射函数单测（批 5.4）· 从 order-detail.js 抽离的 computeNextStep 全分支覆盖
const test = require('node:test');
const assert = require('node:assert');
const { computeNextStep, pad, buildModifyTs, buildPrepCountdown, fmtDate, buildOrderView } = require('../../miniprogram/utils/order-view.js');
const { ORDER_STATUS } = require('../../miniprogram/config/enums.js');

const U = (over) => Object.assign({ status: 'S2', my_role: 'user', service_date: '10-12', service_time: '20:00' }, over);

test('pad 补零', () => {
  assert.strictEqual(pad(5), '05');
  assert.strictEqual(pad(12), '12');
});

test('加时在途且可响应 → extend_respond', () => {
  const r = computeNextStep(U({ pending_extend: { can_respond: true, add_hours: 2, add_amount_fen: 1000, expire_text: '2小时内' } }));
  assert.strictEqual(r.action.key, 'extend_respond');
  assert.strictEqual(r.tone, 'primary');
});

test('加时在途(己方发起) → info 无 action', () => {
  const r = computeNextStep(U({ my_role: 'partner', pending_extend: { can_respond: false, add_hours: 1, add_amount_fen: 500 } }));
  assert.strictEqual(r.tone, 'info');
  assert.strictEqual(r.action, undefined);
});

test('改期在途且可响应 → modify_respond(确定性 now)', () => {
  const now = 1_700_000_000_000;
  const r = computeNextStep(U({ pending_modify: { can_respond: true, new_date: '10-13', new_time: '09:00', expire_at: now + 2 * 3600000 } }), now);
  assert.strictEqual(r.action.key, 'modify_respond');
  assert.ok(r.subtitle.includes('2小时内'));
});

test('S0 发单人 → 去支付', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S0', my_role: 'user' })).action.key, 'pay');
});
test('S0 耍伴 → 等待支付(无 action)', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S0', my_role: 'partner' })).action, undefined);
});
test('S1 → 进入聊天', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S1' })).action.key, 'chat');
});
test('S2 耍伴 → 准备履约', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S2', my_role: 'partner' })).title, '准备履约');
});
test('S3 耍伴有下一里程碑 → 提交 N%', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S3', my_role: 'partner', nextPercent: 30 })).action.key, 'milestone');
});
test('S3 耍伴无下一里程碑 → 履约完成', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S3', my_role: 'partner', nextPercent: 0 })).action.key, 'finish');
});
test('S3 发单人 → 安全报备', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S3', my_role: 'user' })).action.key, 'safety');
});
test('S3_5 耍伴 → 恢复履约', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S3_5', my_role: 'partner' })).action.key, 'resume');
});
test('S5 发单人 → 去评价', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S5', my_role: 'user' })).action.key, 'eval');
});
test('终态 S6/S7/S8/S9/S10/S10_5 均无 action', () => {
  for (const s of ['S6', 'S7', 'S8', 'S9', 'S10', 'S10_5']) {
    assert.strictEqual(computeNextStep(U({ status: s })).action, undefined, s);
  }
});
test('未知状态 → null', () => {
  assert.strictEqual(computeNextStep(U({ status: 'S99' })), null);
});

// ── 拆分阶段1 C1（2026-10-15）：buildModifyTs / buildPrepCountdown ──
test('buildModifyTs 合法日期时分 → 本地时间戳', () => {
  assert.strictEqual(buildModifyTs('2026-10-20', '14:30'), new Date(2026, 9, 20, 14, 30, 0, 0).getTime());
});
test('buildModifyTs 缺日期/缺时间 → 0', () => {
  assert.strictEqual(buildModifyTs('', '14:30'), 0);
  assert.strictEqual(buildModifyTs('2026-10-20', ''), 0);
});
test('buildModifyTs 非法字段 → 0', () => {
  assert.strictEqual(buildModifyTs('2026-10-x', '14:30'), 0);
  assert.strictEqual(buildModifyTs('2026-10-20', 'ab:30'), 0);
});
test('buildPrepCountdown 45 分钟 → 分钟档', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now + 45 * 60000 }, now), '还有 45 分钟开始');
});
test('buildPrepCountdown 120 分钟 → 小时档', () => {
  const now = new Date(2026, 9, 20, 12, 30, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now + 120 * 60000 }, now), '还有 2 小时 0 分钟开始');
});
test('buildPrepCountdown 90 分钟 → Math.round 旧行为 2 小时 30 分', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now + 90 * 60000 }, now), '还有 2 小时 30 分钟开始');
});
test('buildPrepCountdown 2880 分钟 → 天档', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now + 2880 * 60000 }, now), '还有 2 天开始');
});
test('buildPrepCountdown 已过开始时间 → 0 分钟（不显示负数）', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_start_ts: now - 100000 }, now), '还有 0 分钟开始');
});
test('buildPrepCountdown 无 service_start_ts 时由 service_date/time 推导（单位数小时补零）', () => {
  const now = new Date(2026, 9, 20, 8, 5, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({ service_date: '2026-10-20', service_time: '9:05' }, now), '还有 1 小时 0 分钟开始');
});
test('buildPrepCountdown 无任何时间信息 → 0 分钟', () => {
  const now = new Date(2026, 9, 20, 12, 0, 0, 0).getTime();
  assert.strictEqual(buildPrepCountdown({}, now), '还有 0 分钟开始');
});
test('buildPrepCountdown 不传 now → 不抛错且返回字符串（默认 Date.now 旧行为）', () => {
  assert.strictEqual(typeof buildPrepCountdown({ service_start_ts: Date.now() + 600000 }), 'string');
});

// ── 拆分阶段1 C2（2026-10-15）：fmtDate / buildOrderView（refreshOrder 13 键视图 patch） ──
const NOW = new Date(2026, 9, 20, 12, 0, 0, 0).getTime(); // 2026-10-20 12:00 本地
const H = 3600000;
// detail 最小原始返回（老订单形态：无任何扩展字段）
const D = (over) => Object.assign({ order_id: 'O1', order_no: 'NO1', status: 'S1', role: 'user', scene: 'W9', start_time: 0 }, over);
const PATCH_KEYS = ['amountYuan', 'currentCancelIdx', 'finishingService', 'modifyDateMin', 'modifyUsedUp', 'nextStep', 'order', 'orderSummary', 'scene', 'statusInfo', 'timeMaxRange', 'tipEnabled', 'tipTotalYuan'];

test('fmtDate → YYYY-MM-DD 补零', () => {
  assert.strictEqual(fmtDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('buildOrderView 最小入参 → 恰好 13 键 + 老订单安全空值', () => {
  const p = buildOrderView(D(), NOW);
  assert.deepStrictEqual(Object.keys(p).sort(), PATCH_KEYS.slice().sort());
  assert.strictEqual(p.finishingService, false);
  assert.strictEqual(p.tipEnabled, false);                 // CONFIG.PAYMENT.tipEnabled=false
  assert.strictEqual(p.orderSummary, null);
  assert.strictEqual(p.amountYuan, '0.00');
  assert.strictEqual(p.tipTotalYuan, '0.00');
  assert.strictEqual(p.modifyUsedUp, false);
  assert.strictEqual(p.modifyDateMin, '2026-10-20');       // fmtDate(now)
  assert.strictEqual(p.timeMaxRange, '2026-10-23');        // now + CONFIG.MODIFY.maxSpanH(72h)
  assert.strictEqual(p.currentCancelIdx, 2);               // start_time=0 → hoursLeft 大负 → 末档
  assert.strictEqual(p.scene.name, '宠物陪伴');             // getScene 回退 SCENES 硬编码
  assert.strictEqual(p.statusInfo, ORDER_STATUS.S1);
  assert.strictEqual(p.nextStep.action.key, 'chat');       // computeNextStep 已接入
  const o = p.order;
  assert.strictEqual(o._id, 'O1');
  assert.strictEqual(o.status, 'S1');
  assert.strictEqual(o.my_role, 'user');
  assert.strictEqual(o.service_date, '');
  assert.strictEqual(o.service_time, '');
  assert.deepStrictEqual(o.location, {});
  assert.strictEqual(o.money, null);
  assert.strictEqual(o.refund_view, null);
  assert.strictEqual(o.dispute_view, null);
  assert.strictEqual(o.fees_view, null);
  assert.strictEqual(o.complaint, null);
  assert.strictEqual(o.start_evidence, null);
  assert.strictEqual(o.finish_evidence, null);
  assert.strictEqual(o.pending_modify, null);
  assert.strictEqual(o.pending_extend, null);
  assert.strictEqual(o.modify_result, null);
  assert.strictEqual(o.insurance, null);
  assert.strictEqual(o.nextPercent, 30);
  assert.strictEqual(o.canFinishService, false);
  assert.strictEqual(o.start_confirm_text, '确认耍伴已到场');
});

test('buildOrderView 服务时间映射 + 金额/打赏元值', () => {
  const p = buildOrderView(D({ start_time: NOW, total_fen: 8000, tip_total_fen: 500, duration_h: 2 }), NOW);
  assert.strictEqual(p.order.service_date, '2026-10-20');
  assert.strictEqual(p.order.service_time, '12:00');
  assert.strictEqual(p.order.duration_hours, 2);
  assert.strictEqual(p.order.amount_fen, 8000);
  assert.strictEqual(p.amountYuan, '80.00');
  assert.strictEqual(p.tipTotalYuan, '5.00');
});

test('buildOrderView 取消三档（CONFIG.CANCEL_LEAD_HOURS=[24,4]）', () => {
  assert.strictEqual(buildOrderView(D({ start_time: NOW + 25 * H }), NOW).currentCancelIdx, 0);
  assert.strictEqual(buildOrderView(D({ start_time: NOW + 10 * H }), NOW).currentCancelIdx, 1);
  assert.strictEqual(buildOrderView(D({ start_time: NOW + 2 * H }), NOW).currentCancelIdx, 2);
});

test('buildOrderView 改期次数用尽（maxTimes=2）', () => {
  assert.strictEqual(buildOrderView(D({ modify_count: 2 }), NOW).modifyUsedUp, true);
});

test('buildOrderView 改期在途：对方可响应/己方不可 + 日期时分映射', () => {
  const pm = { new_start_time: new Date(2026, 9, 21, 9, 5).getTime(), by_role: 'partner', reason: '有事', expire_at: NOW + 2 * H };
  const other = buildOrderView(D({ role: 'user', pending_modify: pm }), NOW).order.pending_modify;
  assert.strictEqual(other.can_respond, true);
  assert.strictEqual(other.new_date, '2026-10-21');
  assert.strictEqual(other.new_time, '09:05');
  assert.strictEqual(other.by_role, 'partner');
  const mine = buildOrderView(D({ role: 'partner', pending_modify: pm }), NOW).order.pending_modify;
  assert.strictEqual(mine.can_respond, false);
  assert.strictEqual(buildOrderView(D({ pending_modify: { by_role: 'partner' } }), NOW).order.pending_modify, null);
});

test('buildOrderView 加时在途：分钟/小时/超时三文案 + 可响应判定', () => {
  const mk = (mins) => ({ add_hours: 1, add_amount_fen: 1000, by_role: 'partner', expire_at: NOW + mins * 60000 });
  const m10 = buildOrderView(D({ role: 'user', pending_extend: mk(10) }), NOW).order.pending_extend;
  assert.strictEqual(m10.expire_text, '10分钟内确认');
  assert.strictEqual(m10.can_respond, true);
  const m120 = buildOrderView(D({ role: 'user', pending_extend: mk(120) }), NOW).order.pending_extend;
  assert.strictEqual(m120.expire_text, '2小时内确认');
  const expired = buildOrderView(D({ role: 'user', pending_extend: { add_hours: 1, by_role: 'partner', expire_at: NOW - 1 } }), NOW).order.pending_extend;
  assert.strictEqual(expired.expire_text, '已超时');
  assert.strictEqual(expired.can_respond, true); // can_respond 与超时无关, 保旧逻辑
});

test('buildOrderView 改期结果 confirmed/rejected/null', () => {
  const t = NOW;
  assert.strictEqual(buildOrderView(D({ modify_confirmed_at: t }), NOW).order.modify_result.type, 'confirmed');
  assert.strictEqual(buildOrderView(D({ modify_rejected_at: t }), NOW).order.modify_result.type, 'rejected');
  assert.strictEqual(buildOrderView(D({ modify_confirmed_at: t, modify_rejected_at: t + 1 }), NOW).order.modify_result.type, 'rejected');
});

test('buildOrderView 投诉卡全字段映射 + 状态文案', () => {
  const c = { status: 'withdrawn', mine: true, by_role: 'user', reason: '爽约', at: NOW, withdrawn_at: NOW, handled_at: 0, result_note: '已撤', refund_fen: 5000 };
  const v = buildOrderView(D({ complaint: c }), NOW).order.complaint;
  assert.strictEqual(v.status_text, '已撤回');
  assert.strictEqual(v.by_text, '我（发单人）');
  assert.strictEqual(v.at_text, '10-20 12:00');
  assert.strictEqual(v.handled_at_text, '');
  assert.strictEqual(v.refund_text, '50.00');
  assert.strictEqual(buildOrderView(D({ complaint: { status: 'open', by_role: 'partner' } }), NOW).order.complaint.status_text, '处理中');
  assert.strictEqual(buildOrderView(D({ complaint: { status: 'resolved', by_role: 'partner' } }), NOW).order.complaint.status_text, '平台已处理');
});

test('buildOrderView 资金/退款/争议/费用四视图', () => {
  const p = buildOrderView(D({
    fund: { paid_fen: 8000, refunded_fen: 0, settle_state: 'done', settled_at: NOW },
    refund: { fen: 2000, source: 'dispute', at: NOW, no: 'R1' },
    dispute: { state: 'open', type: 'start_timeout', opened_at: NOW },
    fees: { fee_fen: 300, partner_income_fen: 1700, aa_tier: 'A' }
  }), NOW);
  assert.deepStrictEqual(p.order.money, { paid_text: '80.00', refunded_text: '0.00', settle_text: '已结算', settled_at_text: '10-20 12:00' });
  assert.strictEqual(p.order.refund_view.source_text, '争议裁决退款');
  assert.strictEqual(p.order.dispute_view.type_text, '开始履约超时');
  assert.strictEqual(p.order.fees_view.fee_text, '3.00');
  assert.strictEqual(p.order.fees_view.aa_tier, 'A');
  // 边界：未支付无资金卡；非 open 争议无卡；零费用无卡；未知 source 回退原值
  const q = buildOrderView(D({
    fund: { paid_fen: 0 },
    refund: { fen: 1, source: 'weird_x' },
    dispute: { state: 'closed', type: 'complaint' },
    fees: { fee_fen: 0, partner_income_fen: 0 }
  }), NOW).order;
  assert.strictEqual(q.money, null);
  assert.strictEqual(q.dispute_view, null);
  assert.strictEqual(q.fees_view, null);
  assert.strictEqual(q.refund_view.source_text, 'weird_x');
});

test('buildOrderView 开始/完毕履约留痕：照片映射+空数组安全', () => {
  const withPhotos = buildOrderView(D({
    service_start_evidence: { photos: [{ file_id: 'f1' }, null, { file_id: 'f2' }], partner_location: { address: '新南门' }, submitted_at: NOW },
    service_finish_evidence: { photos: [{ file_id: 'f9' }], partner_location: { address: '春熙路' }, submitted_at: NOW }
  }), NOW).order;
  assert.deepStrictEqual(withPhotos.start_evidence.photos, ['f1', 'f2']);
  assert.strictEqual(withPhotos.start_evidence.address, '新南门');
  assert.strictEqual(withPhotos.start_evidence.at_text, '10-20 12:00');
  assert.deepStrictEqual(withPhotos.finish_evidence.photos, ['f9']);
  const empty = buildOrderView(D({ service_start_evidence: { photos: [] }, service_finish_evidence: null }), NOW).order;
  assert.strictEqual(empty.start_evidence, null);
  assert.strictEqual(empty.finish_evidence, null);
});

test('buildOrderView 到场确认文案：实名+脱敏号三组合', () => {
  assert.strictEqual(buildOrderView(D({ partner_contact: { real_name: '张三', phone_mask: '138****5678' } }), NOW).order.start_confirm_text, '确认耍伴（张三 · 138****5678）已到场');
  assert.strictEqual(buildOrderView(D({ partner_contact: { real_name: '张三' } }), NOW).order.start_confirm_text, '确认耍伴（张三）已到场');
  assert.strictEqual(buildOrderView(D({ partner_contact: { phone_mask: '138****5678' } }), NOW).order.start_confirm_text, '确认耍伴（138****5678）已到场');
  assert.strictEqual(buildOrderView(D({ partner_contact: {} }), NOW).order.partner_contact && buildOrderView(D({ partner_contact: {} }), NOW).order.start_confirm_text, '确认耍伴已到场');
});

test('buildOrderView 里程碑 0/1/2/3 → nextPercent 取 [30,60,100][current] 与完成位', () => {
  assert.strictEqual(buildOrderView(D({ milestone: { current: 0 } }), NOW).order.nextPercent, 30);
  const p1 = buildOrderView(D({ milestone: { current: 1 } }), NOW).order;
  assert.strictEqual(p1.nextPercent, 60);                 // 已确认 30%, 下一档 60%
  assert.strictEqual(p1.milestoneSteps[0].done, true);
  assert.strictEqual(p1.milestoneSteps[1].done, false);
  const p2 = buildOrderView(D({ milestone: { current: 2 } }), NOW).order;
  assert.strictEqual(p2.nextPercent, 100);                // 已确认 30%/60%, 下一档 100%
  assert.strictEqual(p2.milestoneSteps[0].done, true);
  assert.strictEqual(p2.milestoneSteps[1].done, true);
  assert.strictEqual(p2.milestoneSteps[2].done, false);
  assert.strictEqual(p2.canFinishService, false);
  const p3 = buildOrderView(D({ milestone: { current: 3 } }), NOW).order;
  assert.strictEqual(p3.nextPercent, null);
  assert.strictEqual(p3.canFinishService, true);
});

test('buildOrderView 服务内容：数组/单值/缺省三路', () => {
  assert.strictEqual(buildOrderView(D({ content_options: ['陪诊', '取药'] }), NOW).order.scene_content_text, '陪诊/取药');
  assert.strictEqual(buildOrderView(D({ content_option: '陪玩' }), NOW).order.scene_content_text, '陪玩');
  assert.strictEqual(buildOrderView(D(), NOW).order.scene_content_text, '');
});

test('buildOrderView 布尔/透传字段不漂移', () => {
  const o = buildOrderView(D({ frozen: 1, can_withdraw_complaint: 1, user_confirm: { at: NOW }, urge: { count: 1 }, confirm: { a: 1 }, evaluation: { star: 5 }, pay_expire_at: NOW, partner_nickname: '小李' }), NOW).order;
  assert.strictEqual(o.frozen, true);
  assert.strictEqual(o.can_withdraw_complaint, true);
  assert.deepStrictEqual(o.user_confirm, { at: NOW });
  assert.deepStrictEqual(o.urge, { count: 1 });
  assert.deepStrictEqual(o.confirm, { a: 1 });
  assert.deepStrictEqual(o.evaluation, { star: 5 });
  assert.strictEqual(o.pay_expire_at, NOW);
  assert.strictEqual(o.partner_name, '小李');
  assert.strictEqual(o.scene_code, 'W9');
  assert.strictEqual(o.modify_count, 0);
});
