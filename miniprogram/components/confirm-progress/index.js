// components/confirm-progress · 四确认进度条（PRD 3.4 / pages-spec P09 C2）
// props: progress = { time:bool, location:bool, content:bool, fee:bool }
// 4段flex/每段高8rpx/完成绿/当前橙/未完成灰；下方步骤文字
Component({
  properties: {
    progress: { type: Object, value: { time: false, location: false, content: false, fee: false } }
  },
  data: {
    steps: [
      { key: 'time', name: '时间' },
      { key: 'location', name: '地点' },
      { key: 'content', name: '内容' },
      { key: 'fee', name: '费用' }
    ],
    count: 0,
    total: 4
  },
  observers: {
    progress: function (p) {
      if (!p) return;
      const steps = this.data.steps.map((s) => Object.assign({}, s, { done: !!p[s.key] }));
      const count = steps.filter((s) => s.done).length;
      // 当前段 = 第一个未完成
      const firstPending = steps.findIndex((s) => !s.done);
      steps.forEach((s, i) => {
        s.state = s.done ? 'done' : (i === firstPending ? 'current' : 'todo');
      });
      this.setData({ steps, count });
    }
  },
  lifetimes: {
    attached() {
      const p = this.properties.progress;
      if (p) {
        const steps = this.data.steps.map((s) => Object.assign({}, s, { done: !!p[s.key] }));
        const count = steps.filter((s) => s.done).length;
        const firstPending = steps.findIndex((s) => !s.done);
        steps.forEach((s, i) => {
          s.state = s.done ? 'done' : (i === firstPending ? 'current' : 'todo');
        });
        this.setData({ steps, count });
      }
    }
  }
});
