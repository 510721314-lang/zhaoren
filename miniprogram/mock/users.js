// mock/users.js · V15.1 用户/耍伴 mock
// 来源：mock-data.md 第2节 users 集合（2条：1双身份耍伴 + 1纯用户18-22岁）
// 字段名对齐云集合 user_account，后续可直接换真接口

const users = [
  {
    _id: 'u5f8a2c1e9b04d7a8c3f6291de0a4b71',
    openid: 'mock_openid_zhang_ming',
    nickname: '张明',
    avatar: '🧑',
    phone: '138****8888',
    real_name: '张*明',
    id_card_masked: '3201**********1234',
    face_verified: true,
    age: 26,
    user_credit_score: 820,
    partner_credit_score: 800,
    is_partner: true,
    partner_level: 'L2',
    // 已认证场景（R9 抢单按钮依据）：未认证 travel/online
    certified_scenes: ['medical_escort', 'study_companion', 'life_assist'],
    emergency_contacts: [
      { name: '王**', phone: '139****0000', verified: false, relation: '父母' }
    ],
    user_type: 'personal',
    status: 'active',
    new_user: true,
    first_order_used: false,
    fast_withdraw_used: 3,
    unread_notice: 3,
    has_active_order: false,
    created_at: '2026-09-01'
  },
  {
    _id: 'u9c2e7b41a8f04d6b93e25c7fa10d8e4',
    openid: 'mock_openid_li_hua',
    nickname: '李华',
    avatar: '🧑‍🎓',
    phone: '137****6666',
    real_name: '李*华',
    id_card_masked: '5101**********5678',
    face_verified: true,
    age: 20, // 18-22岁：紧急联系人须2条，单笔上限200元
    user_credit_score: 780,
    partner_credit_score: 0,
    is_partner: false,
    partner_level: '',
    certified_scenes: [],
    emergency_contacts: [
      { name: '李**', phone: '135****1111', verified: true, relation: '父亲' },
      { name: '周**', phone: '136****2222', verified: true, relation: '母亲' }
    ],
    user_type: 'personal',
    status: 'active',
    new_user: true,
    first_order_used: false,
    fast_withdraw_used: 0,
    unread_notice: 0,
    has_active_order: false,
    created_at: '2026-09-10'
  }
];

// 首页/广场耍伴推荐 mock（partner-card / P08 数据源）
const partners = [
  {
    _id: 'p1a2b3c4d5e6f7081920a1b2c3d4e5f6',
    user_id: 'mock_partner_xiaoya',
    nickname: '小雅酱',
    avatar: '🧑‍⚕️',
    real_name_verified: true,
    face_verified: true,
    certs: ['陪诊认证', '学习认证'],
    partner_credit_score: 850,
    partner_level: 'L3',
    medals: ['🏅 月度之星'],
    scenes: ['medical_escort', 'study_companion'],
    on_time_rate: 98,
    praise_rate: 95,
    order_count: 128,
    price_min: 50,
    price_max: 80,
    distance_km: 2.3,
    latest_dynamic: {
      cover: '🏥',
      title: '今天陪阿姨去华西复诊，一切顺利，阿姨说下次还找我～',
      at: '2小时前'
    }
  },
  {
    _id: 'p6f5e4d3c2b1a0987654321f0e9d8c7b',
    user_id: 'mock_partner_chenshu',
    nickname: '陈叔帮帮忙',
    avatar: '🧔',
    real_name_verified: true,
    face_verified: true,
    certs: ['生活协助认证', '出行认证'],
    partner_credit_score: 912,
    partner_level: 'L3',
    medals: ['🛡 安全标兵', '⭐ 百单达人'],
    scenes: ['life_assist', 'travel_companion'],
    on_time_rate: 99,
    praise_rate: 98,
    order_count: 206,
    price_min: 40,
    price_max: 60,
    distance_km: 1.1,
    latest_dynamic: {
      cover: '🚶',
      title: '上午陪张爷爷在天府广场散步，天气好心情也好。',
      at: '昨天'
    }
  }
];

// 当前登录用户（mock 阶段固定为双身份耍伴张明，便于演示抢单双视角）
const CURRENT_USER = users[0];

module.exports = { users, partners, CURRENT_USER };
