// components/order-progress · 13态进度轴（PRD 3.5.2 / pages-spec P11 O1）
// props: status 取 ORDER_STATUS 的 14 个键（S0-S10 + S2.5 + S3.5 + S10.5）
// 主轴：S0→S1→S2→S3→S5→S8→S10；分支态：S2.5/S3.5/S4/S6/S7/S9/S10.5
// 节点名/颜色一律取 config/enums.js ORDER_STATUS，组件内禁止再写映射
const { ORDER_STATUS, normalizeStatus } = require('../../config/enums.js');

// 主轴节点
const MAIN_CODES = ['S0', 'S1', 'S2', 'S3', 'S5', 'S8', 'S10'];
// 分支态：anchor=主轴锚点；terminal=终止态（锚点及之前 done、无 current）；preview=锚点态时是否灰显预告
const BRANCH_RULE = {
  S2_5:  { anchor: 'S2', terminal: false, preview: false },
  S3_5:  { anchor: 'S3', terminal: false, preview: true },
  S4:    { anchor: 'S5', terminal: false, preview: true },
  S6:    { anchor: 'S0', terminal: true,  preview: false },
  S7:    { anchor: 'S2', terminal: true,  preview: false },
  S9:    { anchor: 'S5', terminal: true,  preview: false },
  S10_5: { anchor: 'S8', terminal: false, preview: true }
};

Component({
  properties: {
    status: { type: String, value: 'S0' }
  },
  data: {
    mainSteps: [],
    branches: []
  },
  observers: {
    status: function (s) { this.compute(s); }
  },
  lifetimes: {
    attached() { this.compute(this.properties.status); }
  },
  methods: {
    normalize(s) {
      return normalizeStatus(s);
    },
    compute(raw) {
      const s = this.normalize(raw);
      const rule = BRANCH_RULE[s];
      const anchorIdx = rule ? MAIN_CODES.indexOf(rule.anchor) : -1;
      const axisIdx = rule ? -1 : MAIN_CODES.indexOf(s);
      const mainSteps = MAIN_CODES.map((code, i) => {
        let state = 'todo';
        let isCurrent = false;
        if (!rule) {
          // 主轴态
          state = i < axisIdx ? 'done' : (i === axisIdx ? 'current' : 'todo');
          isCurrent = i === axisIdx;
        } else if (rule.terminal) {
          // 终止分支：锚点及之前 done，无 current
          state = i <= anchorIdx ? 'done' : 'todo';
        } else {
          // 进行中分支：锚点 current
          state = i < anchorIdx ? 'done' : (i === anchorIdx ? 'current' : 'todo');
          isCurrent = i === anchorIdx;
        }
        return { code, name: ORDER_STATUS[code].name, state, isCurrent };
      });
      // 分支红点：当前命中，或主轴锚点态时灰显预告
      const branches = Object.keys(BRANCH_RULE)
        .filter((k) => k === s || (BRANCH_RULE[k].preview && BRANCH_RULE[k].anchor === s))
        .map((k) => {
          const cfg = ORDER_STATUS[k];
          const active = k === s;
          return {
            code: cfg.code,
            name: cfg.name,
            active,
            // 颜色取 SSOT token；灰显态由 wxss 默认中性色处理
            activeStyle: active ? `background:${cfg.bgTag};color:${cfg.colorTag};` : ''
          };
        });
      this.setData({ mainSteps, branches });
    }
  }
});
