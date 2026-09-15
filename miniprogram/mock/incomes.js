// mock/incomes.js · V15.1 收益流水 mock
// 供 P14 workbench / P16 wallet 使用
// 字段：fund_status 对齐 enums.FUND_STATUS 四态

const incomes = [
  {
    _id: 'ic001',
    order_no: '20260912005',
    scene_code: 'W2',
    scene_name: '学习陪伴',
    partner_name: '小雅酱',
    gross_fen: 24000,           // 总额 240元
    commission_fen: 4800,       // 平台抽成 20%
    net_fen: 19200,             // 实收 192元
    fund_status: 'splitting',   // 分账中
    created_at: '2026-09-12T12:00:00',
    estimated_at: '2026-09-13T12:00:00',
    is_welfare: false
  },
  {
    _id: 'ic002',
    order_no: '20260914004',
    scene_code: 'W8',
    scene_name: '生活协助',
    partner_name: '陈叔帮帮忙',
    gross_fen: 12000,
    commission_fen: 2400,
    net_fen: 9600,
    fund_status: 'withdrawable', // 可提现
    created_at: '2026-09-13T12:05:00',
    estimated_at: '2026-09-14T12:05:00',
    is_welfare: false
  },
  {
    _id: 'ic003',
    order_no: '20260910008',
    scene_code: 'W1',
    scene_name: '就医陪诊',
    partner_name: '小雅酱',
    gross_fen: 16000,
    commission_fen: 0,            // 公益单无抽成
    subsidy_fen: 6400,            // 公益补贴 80%
    net_fen: 12800,               // 80% 实收
    fund_status: 'processing',    // 提现处理中
    created_at: '2026-09-10T12:00:00',
    estimated_at: '2026-09-12T12:00:00',
    is_welfare: true
  },
  {
    _id: 'ic004',
    order_no: '20260908010',
    scene_code: 'W10',
    scene_name: '出行陪伴',
    partner_name: '陈叔帮帮忙',
    gross_fen: 18000,
    commission_fen: 3600,
    net_fen: 14400,
    fund_status: 'arrived',       // 已到账
    created_at: '2026-09-08T18:00:00',
    estimated_at: '2026-09-09T18:00:00',
    is_welfare: false
  },
  {
    _id: 'ic005',
    order_no: '20260907012',
    scene_code: 'W2',
    scene_name: '学习陪伴',
    partner_name: '小雅酱',
    gross_fen: 8000,
    commission_fen: 1600,
    net_fen: 6400,
    fund_status: 'arrived',
    created_at: '2026-09-07T15:00:00',
    estimated_at: '2026-09-08T15:00:00',
    is_welfare: false
  }
];

// 统计四态金额（分）
function summarize() {
  const sum = { splitting: 0, withdrawable: 0, processing: 0, arrived: 0 };
  incomes.forEach((i) => { sum[i.fund_status] = (sum[i.fund_status] || 0) + i.net_fen; });
  return sum;
}

// 钱包余额 = 可提现 + 提现处理中
function balanceFen() {
  return summarize().withdrawable + summarize().processing;
}

module.exports = { incomes, summarize, balanceFen };
