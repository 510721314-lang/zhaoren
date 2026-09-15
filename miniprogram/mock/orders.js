// mock/orders.js · V15.1 订单 mock
// 供 P09 chat / P10 pay / P07 demand-detail 使用
// 金额一律用"分"（PRD硬性规则），展示时 /100 转元

const orders = [
  {
    _id: 'o_s1_001',
    order_no: '20260915001',
    demand_id: 'd0a1b2c3d4e5f60718293a4b5c6d7e8f',
    user_id: 'mock_openid_zhang_ming',
    partner_id: 'mock_partner_xiaoya',
    partner_name: '小雅酱',
    partner_avatar: '🧑‍⚕️',
    scene_code: 'medical_escort',
    // 金额：分
    amount_fen: 24000,         // 240元 = 80元/时 × 3时
    unit_price_fen: 8000,     // 80元/时
    duration_hours: 3,
    status: 'S1',
    project_attr: 'commercial',
    aa_estimate: '50-200',
    insurance: { policy_no: '', coverage: 500000, status: 'pending' },
    confirm_progress: { time: true, location: true, content: true, fee: false },
    // 预置聊天消息流（3项已确认 + TM4待确认）
    messages: [
      { _id: 'm1', msg_type: 'system', content: '订单已创建，请双方完成结构化四确认', created_at: '09:00' },
      { _id: 'm2', msg_type: 'template', tm_id: 'TM1', direction: 'out', question: '以下服务时间是否方便？', picked: '方便', status: 'confirmed', created_at: '09:01' },
      { _id: 'm3', msg_type: 'template', tm_id: 'TM2', direction: 'in', question: '请确认集合地点', picked: '地点正确', status: 'confirmed', created_at: '09:02' },
      { _id: 'm4', msg_type: 'template', tm_id: 'TM3', direction: 'out', question: '请确认服务内容', picked: '内容无误', status: 'confirmed', created_at: '09:03' },
      { _id: 'm5', msg_type: 'template', tm_id: 'TM4', direction: 'in', question: '请确认费用明细：80元/时 × 3时 = 240元', picked: '', status: 'pending', created_at: '09:04' }
    ],
    service_date: '2026-09-16',
    service_time: '08:30-12:00',
    location: { name: '华西医院门诊大楼', address: '武侯区国学巷37号', lat: 30.65, lng: 104.05 },
    paid_at: null,
    started_at: null,
    ended_at: null,
    evaluated: false,
    modify_count: 0,
    other_used_count: 0,   // 「其他」模板使用次数（≥3触发客服介入）
    timeline: [
      { status: 'S0', at: '2026-09-14T10:00:00' },
      { status: 'S1', at: '2026-09-14T10:05:00' }
    ]
  },
  {
    _id: 'o_s2_002',
    order_no: '20260915002',
    demand_id: 'd1f2e3d4c5b6a7988776655443322110',
    user_id: 'mock_openid_zhang_ming',
    partner_id: 'mock_partner_chenshu',
    partner_name: '陈叔帮帮忙',
    partner_avatar: '🧔',
    scene_code: 'study_companion',
    amount_fen: 18000,     // 180元
    unit_price_fen: 6000,  // 60元/时
    duration_hours: 3,
    status: 'S2',
    project_attr: 'commercial',
    aa_estimate: '0-50',
    insurance: { policy_no: 'PI20260915002', coverage: 500000, status: 'insured' },
    confirm_progress: { time: true, location: true, content: true, fee: true },
    messages: [],
    service_date: '2026-09-19',
    service_time: '09:00-12:00',
    location: { name: '四川省图书馆', address: '青羊区人民西路4号', lat: 30.66, lng: 104.06 },
    paid_at: '2026-09-14T10:30:00',
    started_at: null,
    ended_at: null,
    evaluated: false,
    modify_count: 0,
    other_used_count: 0,
    timeline: [
      { status: 'S0', at: '2026-09-14T09:50:00' },
      { status: 'S1', at: '2026-09-14T09:55:00' },
      { status: 'S2', at: '2026-09-14T10:30:00' }
    ]
  },
  {
    _id: 'o_s3_003',
    order_no: '20260915003',
    demand_id: 'd2a3b4c5d6e7f8091a2b3c4d5e6f7081',
    user_id: 'mock_openid_zhang_ming',
    partner_id: 'mock_partner_xiaoya',
    partner_name: '小雅酱',
    partner_avatar: '🧑‍⚕️',
    scene_code: 'medical_escort',
    amount_fen: 16000,
    unit_price_fen: 8000,
    duration_hours: 2,
    status: 'S3',
    project_attr: 'commercial',
    aa_estimate: '0-50',
    insurance: { policy_no: 'PI20260915003', coverage: 500000, status: 'insured' },
    confirm_progress: { time: true, location: true, content: true, fee: true },
    messages: [],
    service_date: '2026-09-15',
    service_time: '14:00-16:00',
    location: { name: '华西医院门诊大楼', address: '武侯区国学巷37号', lat: 30.65, lng: 104.05 },
    paid_at: '2026-09-14T08:00:00',
    started_at: '2026-09-15T13:55:00',
    ended_at: null,
    evaluated: false,
    modify_count: 0,
    other_used_count: 0,
    safety: { shared_location: true, last_checkin: '14:30', next_checkin_in: 1800, sos_active: false },
    timeline: [
      { status: 'S0', at: '2026-09-14T07:50:00' },
      { status: 'S1', at: '2026-09-14T07:55:00' },
      { status: 'S2', at: '2026-09-14T08:00:00' },
      { status: 'S3', at: '2026-09-15T13:55:00' }
    ]
  },
  {
    _id: 'o_s5_004',
    order_no: '20260914004',
    demand_id: 'd3b4c5d6e7f8091a2b3c4d5e6f708192',
    user_id: 'mock_openid_zhang_ming',
    partner_id: 'mock_partner_chenshu',
    partner_name: '陈叔帮帮忙',
    partner_avatar: '🧔',
    scene_code: 'life_assist',
    amount_fen: 12000,
    unit_price_fen: 6000,
    duration_hours: 2,
    status: 'S5',
    project_attr: 'commercial',
    aa_estimate: '0-50',
    insurance: { policy_no: 'PI20260914004', coverage: 500000, status: 'insured' },
    confirm_progress: { time: true, location: true, content: true, fee: true },
    messages: [],
    service_date: '2026-09-13',
    service_time: '10:00-12:00',
    location: { name: '天府广场', address: '人民南路', lat: 30.66, lng: 104.06 },
    paid_at: '2026-09-12T10:00:00',
    started_at: '2026-09-13T09:55:00',
    ended_at: '2026-09-13T12:05:00',
    evaluated: false,
    modify_count: 0,
    other_used_count: 0,
    timeline: [
      { status: 'S0', at: '2026-09-12T09:50:00' },
      { status: 'S1', at: '2026-09-12T09:55:00' },
      { status: 'S2', at: '2026-09-12T10:00:00' },
      { status: 'S3', at: '2026-09-13T09:55:00' },
      { status: 'S5', at: '2026-09-13T12:05:00' }
    ]
  },
  {
    _id: 'o_s8_005',
    order_no: '20260912005',
    demand_id: 'd4c5d6e7f8091a2b3c4d5e6f70819203',
    user_id: 'mock_openid_zhang_ming',
    partner_id: 'mock_partner_xiaoya',
    partner_name: '小雅酱',
    partner_avatar: '🧑‍⚕️',
    scene_code: 'study_companion',
    amount_fen: 24000,
    unit_price_fen: 8000,
    duration_hours: 3,
    status: 'S8',
    project_attr: 'commercial',
    aa_estimate: '50-200',
    insurance: { policy_no: 'PI20260912005', coverage: 500000, status: 'insured' },
    confirm_progress: { time: true, location: true, content: true, fee: true },
    messages: [],
    service_date: '2026-09-11',
    service_time: '09:00-12:00',
    location: { name: '四川省图书馆', address: '青羊区人民西路4号', lat: 30.66, lng: 104.06 },
    paid_at: '2026-09-10T10:00:00',
    started_at: '2026-09-11T08:55:00',
    ended_at: '2026-09-11T12:00:00',
    evaluated: true,
    evaluation: { stars: 5, tags: ['准时到达', '服务专业'], content: '非常满意', at: '2026-09-11T20:00:00' },
    modify_count: 0,
    other_used_count: 0,
    timeline: [
      { status: 'S0', at: '2026-09-10T09:50:00' },
      { status: 'S1', at: '2026-09-10T09:55:00' },
      { status: 'S2', at: '2026-09-10T10:00:00' },
      { status: 'S3', at: '2026-09-11T08:55:00' },
      { status: 'S5', at: '2026-09-11T12:00:00' },
      { status: 'S8', at: '2026-09-11T20:00:00' }
    ]
  }
];

// 按 demand_id / order_id 查找
function findOrder(orderId) {
  return orders.find((o) => o._id === orderId || o.order_no === orderId) || null;
}

module.exports = { orders, findOrder };
