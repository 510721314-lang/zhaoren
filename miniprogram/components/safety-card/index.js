// components/safety-card · 订单详情「安全中心」卡(里程碑4·文件1阶段4 ②b, 2026-10-17 用户确认推进)
// 结构自 pages-v2/order-detail/order-detail.wxml 逐字迁入: 数据由页面 safety.checkins 数组传入
// 两个事件 triggerEvent 上抛, 能力链路(定位/云端/拨号弹层)一律留页面:
//   sos → 页面 onSos(二次确认→高精度定位→safety-report.sos→_showCallSheet);  safety → 页面 onSafety(跳安全报备页)
// .od__safety-*/.od__sos-btn/.od__report-btn/.od__checkin* 为本卡独占 → 随卡迁入本组件 index.wxss;
//   .od__card/.od__card-title 为页面多卡共用原语, 留页面 wxss 经 styleIsolation=apply-shared 生效
Component({
  properties: {
    checkins: { type: Array, value: [] }   // safety.checkins: [{ key, text, time }]
  },
  methods: {
    onSos() { this.triggerEvent('sos'); },
    onSafety() { this.triggerEvent('safety'); }
  }
});
