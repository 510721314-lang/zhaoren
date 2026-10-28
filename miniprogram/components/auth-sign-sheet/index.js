// components/auth-sign-sheet · 发布页授权签字弹层组(里程碑4·文件2阶段4b, 2026-10-17 用户书面批准)
// 合一 W9 宠物照料授权 与 需求②代发委托授权 两套弹层(授权书电子文件弹窗 + 手写签字窗口); 页面根部两次实例化(kind=pet / kind=proxy)
// 边界(§5.5): 组件只承载 fixed 弹层与 canvas —— 不 callCloud、不 wx.cloud.uploadFile、不推进业务状态; 只出事件
// 文案来源留页面(宠物 admin-action config_public / 委托 本地硬编码), 经 docText 属性传入; 勾选态与签字图 fileID 一律留页面 state
// 差异保留: ①文案来源不改(仅经 properties 传入); ②两实例 id 不同(#pet-auth / #proxy-auth); ③页面 state 命名仍 pet*/proxy*
Component({
  properties: {
    kind: { type: String, value: '' },      // 'pet' | 'proxy'(随事件 detail 透传, 供页面区分)
    docTitle: { type: String, value: '' },  // 《宠物照料授权书》/《委托授权书》
    docText: { type: String, value: '' },   // 页面加载的授权书全文
    signTip: { type: String, value: '' }    // 签字窗口提示文案
  },

  data: {
    sheetVisible: false,   // 授权书电子文件弹窗
    signVisible: false,    // 手写签字窗口
    submitting: false,     // 签字图导出/上传中(防连点)
    fromCheck: false       // 由勾选动作进入(取消时回到未签署初始态)
  },

  methods: {
    // 页面经 this.selectComponent('#pet-auth'/'#proxy-auth').openDoc({fromCheck}) 调用
    openDoc(opts) {
      this.setData({ sheetVisible: true, fromCheck: !!(opts && opts.fromCheck) });
    },
    // 弹窗取消(含点遮罩触发 bottom-sheet close): 由勾选进入 → 通知页面回未签署(仅查看进入则不回退)
    onDocCancel() {
      const fromCheck = this.data.fromCheck;
      this.setData({ sheetVisible: false });
      if (fromCheck) this.triggerEvent('check-change', { on: false, kind: this.data.kind });
    },
    // 「本人签字确认」→ 弹出手写签字窗口
    onDocSign() {
      this.setData({ sheetVisible: false, signVisible: true, submitting: false });
    },
    // 签字窗口取消: 由勾选进入 → 通知页面回未签署; 由「已签署·点击查看」进入 → 保持已签
    onSignCancel() {
      const fromCheck = this.data.fromCheck;
      this.setData({ signVisible: false, submitting: false });
      if (fromCheck) this.triggerEvent('check-change', { on: false, kind: this.data.kind });
    },
    onSignClear() {
      const sig = this.selectComponent('#sig');
      if (sig) sig.clear();
    },
    // 完成签署: 导出签名图 → 上抛临时路径(uploadFile 由页面负责, §5.5)
    onSignConfirm() {
      if (this.data.submitting) return;
      const sig = this.selectComponent('#sig');
      if (!sig) { wx.showToast({ title: '签字板未就绪,请重试', icon: 'none' }); return; }
      // P0-4(2026-10-28): 导出前签名质量识别, 空签/单点/笔画过少/过小一律阻断
      const chk = sig.recognize();
      if (!chk || !chk.ok) {
        wx.showToast({ title: (chk && chk.message) || '签名识别未通过，请重写', icon: 'none' });
        return;
      }
      this.setData({ submitting: true });
      sig.exportPNG().then((tempPath) => {
        this.triggerEvent('sign-confirm', { tempFilePath: tempPath, kind: this.data.kind });
      }).catch((e) => {
        this.setData({ submitting: false });
        if (e && e.message === 'empty_signature') { wx.showToast({ title: '请先手写签名', icon: 'none' }); return; }
        wx.showToast({ title: '签字失败,请重试', icon: 'none' });
      });
    },
    // 页面 uploadFile 成功后回调: 关闭签字窗
    finishSign() {
      this.setData({ signVisible: false, submitting: false, fromCheck: false });
    },
    // 页面 uploadFile 失败后回调: 复位提交态
    failSign() {
      this.setData({ submitting: false });
    },
    noop() {}
  }
});
