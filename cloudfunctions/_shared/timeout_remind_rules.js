// timeout_remind_rules.js - S2_6/S3_6 待确认窗口「超时前提醒」纯规则(G3)
// 纯函数, 无 wx-server-sdk 依赖, 可独立单测。消费者: order-timer(自动链路)。
// 设计依据: docs/prd-g3-timeout-reminder-20261019.md(《线下陪伴履约流程规范》§C8「提醒 2 次后转争议」)
//   窗口内各提醒 2 次: S2_6 锚点 start_apply_at 默认 +5/+10min; S3_6 锚点 finish_apply_at 默认 +10/+20min。
//   渠道: 站内信(定时触发云调用订阅必报 -501001, 故自动链路降级站内)。
//   幂等: 每档用订单标记位(start_apply_remind1/2_at, finish_confirm_remind1/2_at)防重复轰炸; 命名避开 urge_t0/t1/t2。
//   互斥: cancel_request.pending(协商取消挂起) 或 frozen(申诉/投诉冻结) 时不提醒(与 urge_rules 同口径)。
//   硬约束: 第 2 档触发点应 ≤ 超时阈值 - 5min(order-timer 每 5min 一轮), 保证领先超时扫描一个轮询周期。
//   本模块不新增状态转移、不改超时阈值; 超时转 S10.5 仍由 order-timer/action_timeout.js 既有段负责。
// 修改本文件后须跑 cloudfunctions/_shared/sync-timeout-remind-rules.ps1 同步各消费方副本。

// ── JSDoc 契约类型(纯标注, 运行时零影响) ──
/**
 * 提醒配置(从 admin_config 解析后的强类型视图)。
 * @typedef {Object} RemindConfig
 * @property {number} startApplyRemind1Min    S2_6 第 1 档提醒(默认 5)
 * @property {number} startApplyRemind2Min    S2_6 第 2 档提醒(默认 10)
 * @property {number} finishConfirmRemind1Min S3_6 第 1 档提醒(默认 10)
 * @property {number} finishConfirmRemind2Min S3_6 第 2 档提醒(默认 20)
 */
/**
 * 一个到期提醒阶段(dueRemindStages 输出元素)。
 * @typedef {Object} RemindStage
 * @property {'sr1'|'sr2'|'fr1'|'fr2'} stage
 * @property {'start_apply_remind1_at'|'start_apply_remind2_at'|'finish_confirm_remind1_at'|'finish_confirm_remind2_at'} markField 幂等标记位字段名
 * @property {'user'} to   通知接收方(待确认方=需求方)
 * @property {string} title
 * @property {string} body
 */

/**
 * 从原始 config 解析提醒阈值(缺失回退默认值)。0 为合法值(不吞)。
 * @param {Object} [config] admin_config 原始对象
 * @returns {RemindConfig}
 */
function remindCfg(config) {
  const c = config || {};
  const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
  return {
    startApplyRemind1Min: num(c.start_apply_remind1_min, 5),
    startApplyRemind2Min: num(c.start_apply_remind2_min, 10),
    finishConfirmRemind1Min: num(c.finish_confirm_remind1_min, 10),
    finishConfirmRemind2Min: num(c.finish_confirm_remind2_min, 20)
  };
}

// 按订单状态解析窗口锚点与两档定义(内部用, 非导出)
function windowSpec(order, c) {
  if (!order) return null;
  if (order.status === 'S2_6') {
    return { anchor: Number(order.start_apply_at) || 0, stages: [
      { stage: 'sr1', markField: 'start_apply_remind1_at', min: c.startApplyRemind1Min,
        title: '⏳ 待你确认开始履约', body: '对方已提交开始履约申请, 请尽快在订单详情确认或拒绝; 逾期将自动转入争议处理' },
      { stage: 'sr2', markField: 'start_apply_remind2_at', min: c.startApplyRemind2Min,
        title: '⏰ 开始履约确认即将超时', body: '开始履约确认即将超时, 请立即在订单详情处理' }
    ]};
  }
  if (order.status === 'S3_6') {
    return { anchor: Number(order.finish_apply_at) || 0, stages: [
      { stage: 'fr1', markField: 'finish_confirm_remind1_at', min: c.finishConfirmRemind1Min,
        title: '⏳ 待你确认履约完毕', body: '对方已提交履约完毕确认申请, 请尽快在订单详情确认或拒绝; 逾期将自动转入争议处理' },
      { stage: 'fr2', markField: 'finish_confirm_remind2_at', min: c.finishConfirmRemind2Min,
        title: '⏰ 履约完毕确认即将超时', body: '履约完毕确认即将超时, 请立即在订单详情处理' }
    ]};
  }
  return null;
}

/**
 * 计算订单当前到期应触发的提醒阶段(自动链路用, 幂等+互斥)。
 * @param {Object} order 订单(需 status/start_apply_at|finish_apply_at/*_remind*_at/cancel_request/frozen)
 * @param {number} now    当前时间戳(ms)
 * @param {Object} [cfg]  admin_config 原始对象
 * @returns {RemindStage[]} 按第 1 档→第 2 档排序; 不满足条件返回 []
 */
function dueRemindStages(order, now, cfg) {
  if (!order) return [];
  if (order.cancel_request && order.cancel_request.status === 'pending') return []; // 取消挂起互斥
  if (order.frozen === true) return [];                                            // 申诉/投诉冻结互斥
  const c = remindCfg(cfg);
  const spec = windowSpec(order, c);
  if (!spec) return [];
  const { anchor, stages } = spec;
  if (!anchor || anchor >= now) return [];  // 未进入待确认窗口(申请时刻缺失或未到)
  const M = 60 * 1000;
  const out = [];
  for (const s of stages) {
    if (!order[s.markField] && now >= anchor + s.min * M) {
      out.push({ stage: s.stage, markField: s.markField, to: 'user', title: s.title, body: s.body });
    }
  }
  return out;
}

module.exports = { remindCfg, dueRemindStages };
