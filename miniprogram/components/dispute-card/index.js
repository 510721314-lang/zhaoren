// components/dispute-card · 订单详情「投诉详情 + 争议处理中 + 保险保障」三卡(拆分阶段3 A3, 2026-10-16 用户批准)
// 纯展示卡: 数据由页面 order.complaint / order.dispute_view / order.insurance 切片 + 页面 insuranceWan 传入(均服务端下发/页面计算, 页面 js 零改); 零 bind 事件
// 卡内 .od__card/.od__card-title/.od__row/.od__label/.od__val 为页面 ≥7 卡共用原语; .od__nsitem* 与爽约申诉卡(L153-183)共用
//   → 上述样式留页面 wxss, 经 styleIsolation=apply-shared 对本组件生效; 仅 .od__val--success 为三卡专属, 随卡迁入 index.wxss
Component({
  properties: {
    complaint: { type: Object, value: null },     // order.complaint: { by_text, status, status_text, reason, at_text, withdrawn_at_text, result_note, handled_at_text, refund_text }
    disputeView: { type: Object, value: null },   // order.dispute_view: { type_text, opened_at_text }
    insurance: { type: Object, value: null },     // order.insurance: { policy_no, status }
    insuranceWan: { type: String, value: '' }     // 页面计算: 保额(万元)
  }
});
