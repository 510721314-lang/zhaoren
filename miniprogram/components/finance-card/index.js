// components/finance-card · 订单详情「资金明细 + 费用明细」卡(拆分阶段3 A1, 2026-10-16 用户书面批准)
// 纯展示卡: 数据由页面 order.money / order.refund_view / order.fees_view 切片传入(均由服务端下发, 页面 js 零计算); 零 bind 事件
// 卡内仅用共用原语 .od__card/.od__card-title/.od__row/.od__label/.od__val(页面 ≥7 卡共用)
//   → 样式留页面 wxss, 经 styleIsolation=apply-shared 对本组件生效; 组件无专属样式故不建 index.wxss
Component({
  properties: {
    money: { type: Object, value: null },       // order.money: { paid_text, refunded_text, settle_text, settled_at_text }
    refundView: { type: Object, value: null },   // order.refund_view: { amount_text, source_text, at_text }
    feesView: { type: Object, value: null }      // order.fees_view: { fee_text, income_text, aa_tier }
  }
});
