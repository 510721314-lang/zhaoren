// mock/conversations.js · V15.1 消息会话 mock（5条）
// 来源：mock-data.md 第2节 conversations + pages-spec P04
// 含订单会话 S1/S2/S3 各一 + 系统通知 + 平台客服（后两者供M2固定入口渲染）

const conversations = [
  {
    _id: 'c0a1b2c3d4e5f60718293a4b5c6d7e80',
    type: 'order',
    order_id: 'mock_order_s2_001',
    order_no: '20260915001',
    order_status: 'S2',
    scene_code: 'medical_escort',
    counterpart: '小雅酱',
    avatar: '🧑‍⚕️',
    last_msg: '[模板] 请确认集合地点：华西医院门诊大楼正门',
    last_msg_type: 'template',
    last_msg_at: '12:26',
    unread_count: 2,
    is_read: false,
    pinned: false
  },
  {
    _id: 'c1b2c3d4e5f60718293a4b5c6d7e8f01',
    type: 'order',
    order_id: 'mock_order_s3_002',
    order_no: '20260914008',
    order_status: 'S3',
    scene_code: 'study_companion',
    counterpart: '陈叔帮帮忙',
    avatar: '🧔',
    last_msg: '我已经到图书馆门口啦，你们慢慢来～',
    last_msg_type: 'text',
    last_msg_at: '09:41',
    unread_count: 0,
    is_read: true,
    pinned: false
  },
  {
    _id: 'c2c3d4e5f60718293a4b5c6d7e8f0112',
    type: 'order',
    order_id: 'mock_order_s1_003',
    order_no: '20260914012',
    order_status: 'S1',
    scene_code: 'life_assist',
    counterpart: '跑腿阿强',
    avatar: '🧑‍🔧',
    last_msg: '[模板] 以下服务时间是否方便？明天08:00',
    last_msg_type: 'template',
    last_msg_at: '昨天',
    unread_count: 1,
    is_read: false,
    pinned: false
  },
  {
    _id: 'c3d4e5f60718293a4b5c6d7e8f011223',
    type: 'system',
    order_id: '',
    order_no: '',
    order_status: '',
    scene_code: '',
    counterpart: '系统通知',
    avatar: '🔔',
    last_msg: '您的订单已投保成功，保单号 PI20260915001',
    last_msg_type: 'system',
    last_msg_at: '11:30',
    unread_count: 3,
    is_read: false,
    pinned: false
  },
  {
    _id: 'c4e5f60718293a4b5c6d7e8f01122304',
    type: 'kefu',
    order_id: '',
    order_no: '',
    order_status: '',
    scene_code: '',
    counterpart: '平台客服',
    avatar: '🎧',
    last_msg: '7×24小时在线，有问题随时找我',
    last_msg_type: 'text',
    last_msg_at: '周一',
    unread_count: 0,
    is_read: true,
    pinned: false
  }
];

module.exports = { conversations };
