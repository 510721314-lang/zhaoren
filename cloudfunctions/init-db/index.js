// 对应 PRD 章节：16 数据库设计与数据模型 / 附录M 参数总表
// init-db 是部署工具函数,用于一次性初始化数据库集合、索引与运营参数种子配置
// 幂等:重复运行不报错、不覆盖已有数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 16 个业务集合(rules.md 第五节第7条)
const COLLECTIONS = [
  'user_account', 'partner_profile', 'demand', 'order_main', 'order_confirmations',
  'order_status_log', 'pay_transaction', 'im_conversation', 'im_message', 'safety_report',
  'credit_score_log', 'emergency_contact', 'evaluation', 'settlement', 'platform_event', 'admin_config'
];

// 索引清单(rules.md 第五节第7条索引设计规范)
// unique 唯一索引 / 复合索引按查询模式建
const INDEXES = [
  { coll: 'user_account', name: 'uk_openid', keys: { openid: 1 }, unique: true },
  { coll: 'partner_profile', name: 'uk_openid', keys: { openid: 1 }, unique: true },
  { coll: 'demand', name: 'idx_creator_status_created', keys: { creator_openid: 1, status: 1, created_at: -1 } },
  { coll: 'order_main', name: 'uk_order_no', keys: { order_no: 1 }, unique: true },
  { coll: 'order_main', name: 'idx_demand_id', keys: { demand_id: 1 } },
  { coll: 'order_main', name: 'idx_partner_status', keys: { partner_openid: 1, status: 1 } },
  { coll: 'pay_transaction', name: 'idx_order_id', keys: { order_id: 1 } },
  { coll: 'order_status_log', name: 'idx_order_created', keys: { order_id: 1, created_at: -1 } },
  { coll: 'im_message', name: 'idx_conv_created', keys: { conv_id: 1, created_at: -1 } },
  { coll: 'evaluation', name: 'idx_order_id', keys: { order_id: 1 } },
  { coll: 'settlement', name: 'idx_order_id', keys: { order_id: 1 } }
];

// 运营参数种子配置(PRD 附录M / 8.5节 可运营参数 · SSOT)
const SEED_CONFIG = {
  _id: 'global',
  // 抽成:冷启动期 10%(可运营参数)
  platform_fee_rate_fen: 1000,
  city_enabled: ['成都'],
  // 超时规则(PRD 8.3 SSOT)
  s0_timeout_min: 30,        // S0 待支付 30 分钟未支付 → S6
  s1_timeout_min: 15,       // S1 待确认 15 分钟未四确认 → S6
  interrupt_timeout_h: 24,   // S3.5 履约中断 24 小时 → 默认转 S4
  eval_window_h: 48,         // S5 完成后 48 小时未评价 → 系统默认 4 星转 S9
  dispute_escalate_d: 30,
  // 信用分(PRD 8.1 SSOT)
  min_credit_take_order: 600,
  min_credit_place_order: 600,
  credit_freeze_line: 400,
  // 青少年保护(PRD 1.7.1):18-22 岁单笔上限 200 元
  youth_limit_fen: 20000,
  // 耍伴时薪区间 30-100 元/小时
  rate_min_fen: 3000,
  rate_max_fen: 10000,
  // 默认评价:超时未评价记 4 星(非 5 星)
  default_star: 4,
  // 场景白名单(MVP-V1 一期 · PRD 3.2/11章)
  scene_list: [
    { code: 'W1',  name: '就医陪诊', options: ['挂号排队', '取药送药', '陪诊解压'], aa_default: true },
    { code: 'W2',  name: '学习陪伴', options: ['自习陪伴', '口语陪练', '作业督促'] },
    { code: 'W8',  name: '生活协助', options: ['排队代办', '搬家帮手', '采买陪同'] },
    { code: 'W10', name: '出行陪伴', options: ['逛街同行', '夜跑陪跑', '活动搭子'] },
    { code: 'W11', name: '线上陪伴', options: ['树洞倾听', '游戏陪玩', '打卡监督'] }
  ],
  // AA 费用档位(PRD 3.4 · 平台不代收)
  aa_tiers: ['0-50元', '50-200元', '200元以上', '自定义'],
  // IM 系统模板消息(PRD 3.3.2 四确认前仅允许这些)
  system_templates: [
    { id: 'T1', text: '你好' },
    { id: 'T2', text: '我准备好了' },
    { id: 'T3', text: '请确认服务时间' },
    { id: 'T4', text: '请确认服务地点' },
    { id: 'T5', text: '请确认服务内容' },
    { id: 'T6', text: '请确认费用明细' },
    { id: 'T7', text: '我发起四确认了' },
    { id: 'T8', text: '好的马上到' }
  ],
  // 本地兜底词库(msgSecCheck 不可用时使用)
  block_words: ['加微信', '加V', '转账', '私聊我'],
  // 测试期自动通过耍伴申请;提审前改 false
  auto_approve_partner: true,
  // 管理员 openid 白名单(阶段 5 由产品经理填入自己的 openid)
  admin_openids: [],
  // 四确认前仅允许模板消息(PRD 3.3.2)
  security_only_template_before_confirm: true,
  version: 'V15-MVP',
  // 基础字段(rules.md 第五节第7条)
  created_at: Date.now(),
  updated_at: Date.now(),
  is_deleted: false
};

exports.main = async (event, context) => {
  const created = [];
  const skipped = [];
  const warnings = [];

  // 1. 创建集合(幂等:已存在则跳过)
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      created.push(`collection:${name}`);
      console.log(`created collection: ${name}`);
    } catch (e) {
      // 已存在或权限不足均视为跳过
      skipped.push(`collection:${name}`);
      console.log(`skip collection ${name}: ${e.errMsg || e.message}`);
    }
  }

  // 2. 创建索引(幂等:已存在则跳过,SDK 不支持时降级警告)
  for (const idx of INDEXES) {
    try {
      await db.collection(idx.coll).createIndex({
        name: idx.name,
        keys: idx.keys,
        unique: !!idx.unique
      });
      created.push(`index:${idx.coll}.${idx.name}`);
      console.log(`created index: ${idx.coll}.${idx.name}`);
    } catch (e) {
      skipped.push(`index:${idx.coll}.${idx.name}`);
      console.log(`skip index ${idx.coll}.${idx.name}: ${e.errMsg || e.message}`);
    }
  }

  // 3. 写入 admin_config 种子(幂等:不存在则建,已存在则补齐缺失字段,不覆盖已有值)
  try {
    const exist = await db.collection('admin_config').where({ _id: 'global' }).limit(1).get();
    if (exist.data && exist.data.length > 0) {
      const doc = exist.data[0];
      // 检测 SEED_CONFIG 中存在但 doc 中缺失的字段,补齐(不覆盖已有值)
      const patch = {};
      let hasPatch = false;
      for (const k of Object.keys(SEED_CONFIG)) {
        if (k === '_id') continue;
        if (doc[k] === undefined || doc[k] === null) {
          patch[k] = SEED_CONFIG[k];
          hasPatch = true;
        }
      }
      if (hasPatch) {
        patch.updated_at = Date.now();
        await db.collection('admin_config').doc(exist.data[0]._id).update({ data: patch });
        created.push('seed:admin_config (patched: ' + Object.keys(patch).filter(k => k !== 'updated_at').join(',') + ')');
        console.log('patched seed: admin_config fields: ' + Object.keys(patch).filter(k => k !== 'updated_at').join(','));
      } else {
        skipped.push('seed:admin_config (already complete)');
        console.log('skip seed: admin_config already complete');
      }
    } else {
      await db.collection('admin_config').add({ data: SEED_CONFIG });
      created.push('seed:admin_config');
      console.log('created seed: admin_config');
    }
  } catch (e) {
    warnings.push(`seed:admin_config (${e.errMsg || e.message})`);
    console.log(`fail seed admin_config: ${e.errMsg || e.message}`);
  }

  return {
    ok: true,
    data: {
      created,
      skipped,
      warnings,
      collections_total: COLLECTIONS.length,
      indexes_total: INDEXES.length
    }
  };
};
