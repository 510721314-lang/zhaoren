// components/tm-template-card · IM模板消息卡（PRD 16.5 / pages-spec P09 C4）
// props: msg = { tm_id, question, picked, status: pending|replied|confirmed, direction: out|in }
// 事件: optiontap(e: { tm_id, option, msg_id })
const { TM_TEMPLATES } = require('../../config/enums.js');

Component({
  properties: {
    msg: { type: Object, value: {} }
  },
  data: {
    tm: null,
    statusText: '',
    statusClass: ''
  },
  observers: {
    msg: function (m) { this.compute(m); }
  },
  lifetimes: {
    attached() { this.compute(this.properties.msg); }
  },
  methods: {
    compute(m) {
      if (!m) return;
      const tm = TM_TEMPLATES[m.tm_id] || null;
      const statusMap = {
        pending: { text: '等待回复', cls: 'pending' },
        replied: { text: '已回复✓', cls: 'replied' },
        confirmed: { text: '已确认✓', cls: 'confirmed' }
      };
      const st = statusMap[m.status] || statusMap.pending;
      this.setData({ tm, statusText: st.text, statusClass: st.cls });
    },
    onOption(e) {
      const option = e.currentTarget.dataset.option;
      const msg = this.properties.msg;
      if (msg.status === 'confirmed' || msg.status === 'replied') return;
      this.triggerEvent('optiontap', { tm_id: msg.tm_id, option, msg_id: msg._id });
    }
  }
});
