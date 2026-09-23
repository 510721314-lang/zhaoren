// components/signature-canvas · 手写签名板(canvas 2d)
// 用法: <signature-canvas id="sig" tip="请在此处手写签名" />
//       页面通过 this.selectComponent('#sig') 调 clear() / isEmpty() / exportPNG()
// 说明: 白底 PNG 导出, 签名图上传云存储后由服务端下载复算 SHA-256 留证
Component({
  properties: {
    tip: { type: String, value: '请在此处手写签名' }
  },

  data: {
    hasInk: false
  },

  lifetimes: {
    ready() {
      this._initCanvas();
    }
  },

  methods: {
    _initCanvas() {
      const q = this.createSelectorQuery();
      q.select('#sgc-canvas').fields({ node: true, size: true }).exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) {
          console.error('[signature-canvas] canvas init fail');
          return;
        }
        const canvas = item.node;
        const ctx = canvas.getContext('2d');
        let dpr = 2;
        try {
          const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          dpr = info.pixelRatio || 2;
        } catch (e) {}
        canvas.width = item.width * dpr;
        canvas.height = item.height * dpr;
        ctx.scale(dpr, dpr);
        this._canvas = canvas;
        this._ctx = ctx;
        this._w = item.width;
        this._h = item.height;
        this._reset();
      });
    },

    // 重置画布(白底 + 画笔参数); 不清 hasInk, 由调用方决定
    _reset() {
      const ctx = this._ctx;
      if (!ctx) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, this._w, this._h);
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1F2937';
      ctx.fillStyle = '#1F2937';
      this._drawing = false;
    },

    // 清除重写
    clear() {
      this._reset();
      this.setData({ hasInk: false });
    },

    // 是否空签名(未落笔)
    isEmpty() {
      return !this.data.hasInk;
    },

    onTouchStart(e) {
      const ctx = this._ctx;
      const t = (e.touches && e.touches[0]) || null;
      if (!ctx || !t) return;
      this._drawing = true;
      this._lastX = t.x;
      this._lastY = t.y;
      this._lastMidX = t.x;
      this._lastMidY = t.y;
      // 单点落笔也留痕(避免点按无笔画)
      ctx.beginPath();
      ctx.arc(t.x, t.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
      if (!this.data.hasInk) this.setData({ hasInk: true });
    },

    // 二次贝塞尔平滑: 以相邻两点中点为锚, 消除折线感
    onTouchMove(e) {
      const ctx = this._ctx;
      const t = (e.touches && e.touches[0]) || null;
      if (!ctx || !t || !this._drawing) return;
      const midX = (this._lastX + t.x) / 2;
      const midY = (this._lastY + t.y) / 2;
      ctx.beginPath();
      ctx.moveTo(this._lastMidX, this._lastMidY);
      ctx.quadraticCurveTo(this._lastX, this._lastY, midX, midY);
      ctx.stroke();
      this._lastMidX = midX;
      this._lastMidY = midY;
      this._lastX = t.x;
      this._lastY = t.y;
    },

    onTouchEnd() {
      this._drawing = false;
    },

    // 导出 PNG; 空签 reject('empty_signature')
    exportPNG() {
      return new Promise((resolve, reject) => {
        if (!this._canvas) return reject(new Error('canvas_not_ready'));
        if (!this.data.hasInk) return reject(new Error('empty_signature'));
        wx.canvasToTempFilePath({
          canvas: this._canvas,
          fileType: 'png',
          success: (r) => resolve(r.tempFilePath),
          fail: (err) => reject(err)
        }, this);
      });
    }
  }
});