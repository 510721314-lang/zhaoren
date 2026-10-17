// components/evidence-card · 订单详情「履约留痕 + 履约凭证」两卡(拆分阶段3 A2, 2026-10-17 用户书面批准)
// 结构自 pages-v2/order-detail/order-detail.wxml 逐字迁入(两卡结构一字未改): 数据由页面 order.start_evidence / order.finish_evidence 切片传入
// 唯一交互: 图片点击预览 → triggerEvent('preview', {src, list}), 页面 onPreviewEvidence 接事件(已兼容 detail 与 dataset 两来源)
// .od__card/.od__card-title/.od__row/.od__label/.od__val 为页面 ≥7 卡共用原语; .od__evi* 被 留痕/爽约申诉/里程碑证据 3 处共用
//   → 上述样式一律留页面 wxss, 经 styleIsolation=apply-shared 对本组件生效; 本组件无专属样式, 故不建 index.wxss
Component({
  properties: {
    start: { type: Object, value: null },   // order.start_evidence: { address, at_text, photos[] }
    finish: { type: Object, value: null }   // order.finish_evidence: { address, at_text, photos[] }
  },
  methods: {
    // 图片点击预览(2026-10-17): 原页面 data-src / data-list 改由事件 detail 上抛, 页面 handler 兼容两来源
    onPreview(e) {
      this.triggerEvent('preview', {
        src: e.currentTarget.dataset.src || '',
        list: e.currentTarget.dataset.list || []
      });
    }
  }
});
