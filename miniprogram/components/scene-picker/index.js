// components/scene-picker · 发布页「场景选择」块(里程碑4·文件2阶段4a, 2026-10-17 用户确认边界=只抽场景选择块)
// 结构自 pages-v2/publish/publish.wxml 逐字迁入(场景网格 + 服务内容已选行), 数据由页面切片传入
// 两个事件 triggerEvent 上抛, 全部业务编排留页面:
//   scene → 页面 setScene(免责声明 modal → 清空服务项 → 打开选择窗);  open-sheet → 页面 openOptionSheet
// 「选择服务内容」bottom-sheet 弹层(optionSheetVisible/optionList/toggleOption/confirmOptions)按既有口径「弹层留页面」, 未迁
// .pub__scene-*/.pub__gb-badge/.pub__opt-row|-label|-picked|-chip|-empty|-edit 为本块独占 → 随块迁入本组件 index.wxss;
//   .pub__block/.pub__label/.pub__required 为页面共用原语, 留页面 wxss 经 styleIsolation=apply-shared 生效
Component({
  properties: {
    scenes: { type: Array, value: [] },          // 页面 scenes(动态场景列表, 含 code/name/icon/color/gb)
    sceneCode: { type: String, value: '' },      // form.scene_code(已选场景)
    contentOptions: { type: Array, value: [] }   // form.content_options(已选服务内容)
  },
  methods: {
    // 点场景卡 → 只上抛 code, 免责声明/清空/开窗由页面 setScene 编排
    onScene(e) {
      this.triggerEvent('scene', { code: e.currentTarget.dataset.code || '' });
    },
    // 点已选服务内容区 → 请求页面重新打开选择窗(页面按 form.scene_code 找场景)
    onOpenSheet() {
      this.triggerEvent('open-sheet');
    }
  }
});
