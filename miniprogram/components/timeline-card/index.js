// components/timeline-card · 订单详情「订单动态」全事件时间线卡（拆分阶段3 A0 试点, 2026-10-16 用户书面批准）
// 纯展示卡: 数据由页面 fetchTimeline 拉取映射后以 list 切片传入(方案 §3 阶段3: callCloud/写操作留页面);
// 零 bind 事件; 卡专属 .od__tl* 样式在组件 wxss, 共用原语 .od__card/.od__card-title 留页面 wxss(styleIsolation=apply-shared 生效)
Component({
  properties: {
    list: { type: Array, value: [] }  // item: { key, type, icon, label, time, who, detail }
  }
});
