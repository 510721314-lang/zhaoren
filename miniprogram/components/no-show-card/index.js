// components/no-show-card · 订单详情「爽约申诉」卡(里程碑4·文件1阶段4 ②a, 2026-10-17 用户确认推进)
// 结构自 pages-v2/order-detail/order-detail.wxml 逐字迁入: 数据由页面 noShowReports 数组传入
// 三个事件全部 triggerEvent 上抛, 写操作(跳举证页 / 撤回申诉)× 云端调用一律留页面:
//   preview → 页面 onPreviewEvidence(已兼容 e.detail);  defense → 页面 onNoShowDefense;  withdraw → 页面 onNoShowWithdraw
// .od__nsitem* 为 dispute-card 与本卡共用、.od__evi* 被 留痕/本卡/里程碑证据 3 处共用、
//   .od__card/.od__card-title/.od__btn* 为多卡共用原语 → 一律留页面 wxss 经 styleIsolation=apply-shared 生效
//   本组件无专属样式, 故不建 index.wxss
Component({
  properties: {
    reports: { type: Array, value: [] }   // noShowReports: [{ report_id, my_role, status, status_text, verdict, reason_display, evidence[], defense_evidence[], defense_at_text, deadline_text, defense_overdue, defense_reason, decided_at_text, decided_reason, withdrawn_at_text, can_defense, can_withdraw }]
  },
  methods: {
    // 证据图片预览(2026-10-17): 原页面 data-src / data-list 改由事件 detail 上抛
    onPreview(e) {
      this.triggerEvent('preview', {
        src: e.currentTarget.dataset.src || '',
        list: e.currentTarget.dataset.list || []
      });
    },
    // 提交举证 / 撤回申诉: 只上抛 report_id, 页面保留跳转与云端调用
    onDefense(e) {
      this.triggerEvent('defense', { id: e.currentTarget.dataset.id || '' });
    },
    onWithdraw(e) {
      this.triggerEvent('withdraw', { id: e.currentTarget.dataset.id || '' });
    }
  }
});
