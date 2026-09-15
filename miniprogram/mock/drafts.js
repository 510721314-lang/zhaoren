// mock/drafts.js · V15.1 草稿箱 mock（30天有效期）
// 供 P06 publish 页 B1 草稿入口与 B10 自动保存使用

const drafts = [
  {
    _id: 'dr_a1b2c3d4e5f60718293a4b5c6d7e8f9',
    user_id: 'mock_openid_zhang_ming',
    demand_data: {
      project_attr: 'commercial',
      scene_code: 'W1',
      title: '陪母亲去省医院做检查',
      description: '母亲需要做全套体检，包括抽血、B超、心电图，希望有耐心的耍伴陪同。',
      service_date: '2026-09-20',
      service_time: '07:30-11:30',
      duration_hours: 4,
      location: { name: '四川省人民医院', address: '青羊区一环路西二段32号', lat: 30.67, lng: 104.04 },
      headcount: 1,
      budget: 75,
      gender_pref: '女',
      aa_estimate: '50-200',
      match_mode: 'broadcast'
    },
    saved_at: '2026-09-13T22:00:00',
    expires_at: '2026-10-13T22:00:00'
  },
  {
    _id: 'dr_b2c3d4e5f60718293a4b5c6d7e8f9a0',
    user_id: 'mock_openid_zhang_ming',
    demand_data: {
      project_attr: 'commercial',
      scene_code: 'W2',
      title: '周五晚图书馆考研自习陪伴',
      description: '考研冲刺阶段，需要耍伴在场督促专注，偶尔答疑英语阅读。',
      service_date: '2026-09-19',
      service_time: '18:30-22:00',
      duration_hours: 3,
      location: { name: '四川省图书馆', address: '青羊区人民西路4号', lat: 30.66, lng: 104.06 },
      headcount: 1,
      budget: 50,
      gender_pref: '不限',
      aa_estimate: '0-50',
      match_mode: 'broadcast'
    },
    saved_at: '2026-09-12T15:00:00',
    expires_at: '2026-10-12T15:00:00'
  }
];

module.exports = { drafts };
