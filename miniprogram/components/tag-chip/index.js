// components/tag-chip · 万能标签：type = scene / gongyi / aa / status
// 场景信息走 redline.getScene(硬编码 SCENES + 后台动态场景兜底)；13态色取 ORDER_STATUS（颜色均为 token）
const { ORDER_STATUS } = require('../../config/enums.js');
const { getScene } = require('../../utils/redline.js');

// 场景浅底 → 配套深字色（token）
const SCENE_TEXT_VAR = {
  W1:  'var(--scene-medical-text)',
  W2:  'var(--scene-study-text)',
  W8:  'var(--scene-life-text)',
  W10: 'var(--scene-travel-text)',
  W11: 'var(--scene-online-text)'
};

Component({
  properties: {
    type: { type: String, value: 'scene' },
    text: { type: String, value: '' },
    sceneCode: { type: String, value: '' },
    statusCode: { type: String, value: '' }
  },
  data: {
    label: '',
    customStyle: ''
  },
  observers: {
    'type,text,sceneCode,statusCode': function () { this.compute(); }
  },
  lifetimes: {
    attached() { this.compute(); }
  },
  methods: {
    compute() {
      const { type, text, sceneCode, statusCode } = this.properties;
      let label = text;
      let customStyle = '';
      if (type === 'scene') {
        const scene = getScene(sceneCode);
        if (scene) {
          label = label || scene.name;
          customStyle = `background:${scene.color};color:${SCENE_TEXT_VAR[scene.code] || 'var(--func-info)'};`;
        }
      } else if (type === 'gongyi') {
        label = label || '公益免费';
        customStyle = 'background:var(--func-success-light);color:var(--func-success);font-weight:600;';
      } else if (type === 'aa') {
        label = label || 'AA自理';
        customStyle = 'background:var(--brand-accent-light);color:var(--text-aa);';
      } else if (type === 'status') {
        const cfg = ORDER_STATUS[statusCode] || ORDER_STATUS[statusCode && statusCode.replace('.', '_')];
        if (cfg) {
          label = label || cfg.name;
          customStyle = `background:${cfg.bgTag};color:${cfg.colorTag};font-weight:600;`;
        }
      }
      this.setData({ label, customStyle });
    }
  }
});
