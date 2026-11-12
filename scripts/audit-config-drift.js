// audit-config-drift.js — 配置漂移巡检 + 留痕活性探针（只读，2026-11-12）
// 来源: 改期规则配置漂移事故(2/1/2 静默上线)处置机制A, 双专家评审 2/2 通过
// 评审修正已吸收: ①基准不硬编码——schema/config_defaults 为唯一真值源;
//              ②命名避开 check- 前缀(防 check-gate-mounts 误判为门禁样本);
//              ③运营态字段只检存在性/类型, 不检值;
//              ④不挂 verify:offline(依赖网络), 独立跑: node scripts/audit-config-drift.js
// 退出码: 0=通过(可含 WARN)  1=存在 ERROR 或留痕探针 FAIL
// 用法(模块): const { runDriftAudit } = require('./audit-config-drift');
const fs = require('fs');
const path = require('path');
const { execTcbCommands } = require('./tcb-exec');

// 附录A 不可变红线(数值以 rules 附录A 为准; schema def 与其一致, 双保险)
const REDLINE = {
  s0_timeout_min: 30, s1_timeout_min: 15, interrupt_timeout_h: 24,
  eval_window_h: 48, default_star: 4,
  min_credit_place_order: 600, min_credit_take_order: 600, credit_freeze_line: 400,
};

function q(table, filter, projection, sort, limit) {
  const cmd = { find: table, filter: filter || {}, limit: limit || 1 };
  if (projection) cmd.projection = projection;
  if (sort) cmd.sort = sort;
  return JSON.stringify(cmd);
}
// 解析 tcb Extended JSON: {$numberLong}/{$numberInt} → Number
function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (v.$numberLong != null) return Number(v.$numberLong);
    if (v.$numberInt != null) return Number(v.$numberInt);
  }
  return v;
}
function runOne(cmdStr) {
  const r = execTcbCommands(JSON.stringify([{ TableName: 'x', CommandType: 'COMMAND', Command: cmdStr }]));
  if (r.status !== 0 || !r.parsed) throw new Error('tcb 查询失败: ' + (r.stderr || r.stdout || '').slice(0, 300));
  const arr = Array.isArray(r.parsed) ? r.parsed : (r.parsed.data || [r.parsed]);
  return arr;
}

function runDriftAudit() {
  const errors = [], warns = [], info = [];
  // ── 1. 云端配置回读 ──
  const docRow = runOne(q('admin_config', { _id: 'global' },
    { updated_at: 1, env: 1, modify_config: 1, mock_payment_enabled: 1, realname_face_mode: 1, auto_approve_partner: 1 }))[0] || {};
  if (!docRow) throw new Error('admin_config(_id:"global") 不存在');
  // 全字段回读(供 schema 比对)——分两次投影避免超限: schema 字段集
  const schema = require('../cloudfunctions/admin-action/config_schema.js').CONFIG_SCHEMA;
  const fields = schema.map((s) => s.f);
  const proj = {}; fields.forEach((f) => { proj[f] = 1; }); proj.updated_at = 1;
  const full = runOne(q('admin_config', { _id: 'global' }, proj))[0] || {};
  const updatedAt = num(full.updated_at);

  // ── 2. 漂移比对: schema 区间(ERROR) / 默认偏离(WARN) / 红线(ERROR) / 运营态(WARN) ──
  for (const s of schema) {
    const v = num(full[s.f]);
    if (v == null) continue; // 未配置 = 走代码兜底, 不告警
    if (s.min != null && (v < s.min || v > s.max)) errors.push(`越界: ${s.f}=${v} 允许[${s.min}-${s.max}] (${s.g}/${s.label})`);
    else if (REDLINE[s.f] != null && v !== REDLINE[s.f]) errors.push(`红线: ${s.f}=${v} 须=${REDLINE[s.f]} (附录A)`);
    else if (s.def != null && v !== s.def) warns.push(`偏离默认: ${s.f}=${v} (def=${s.def}, ${s.g}/${s.label})——有意配置请忽略`);
  }
  if (docRow.env && docRow.env !== 'prod') errors.push(`环境: env=${docRow.env} 须 prod`);
  if (docRow.auto_approve_partner === true) warns.push('auto_approve_partner=true (耍伴自动接单已开)');
  if (docRow.mock_payment_enabled === false) warns.push('mock_payment_enabled=false (模拟支付已关——提审口径须确认)');
  if (docRow.realname_face_mode && docRow.realname_face_mode !== 'mock') warns.push(`realname_face_mode=${docRow.realname_face_mode} (非 mock)`);
  if (docRow.modify_config) warns.push('遗留嵌套 modify_config 对象仍存在(11-10 分钟制迁移漏清, 死数据)——建议授权 $unset 清理');

  // ── 3. 留痕活性探针: 配置写入(updated_at)后三通道零增长 → FAIL ──
  // 心跳噪声排除: error_scan_last_at/heartbeat_at 每轮扫描刷 updated_at 但非配置变更,
  //   若 updated_at == error_scan_last_at 则该写入是心跳, 不触发探针(2026-11-12 实证)
  const now = Date.now();
  const H24 = 24 * 3600 * 1000;
  let probeFail = false, probeDetail = [];
  const heartbeat = num(full.error_scan_last_at);
  const isHeartbeatWrite = heartbeat != null && heartbeat === updatedAt;
  if (!isHeartbeatWrite && updatedAt && now - updatedAt < H24) {
    const chk = [
      ['audit_log(admin_config_change)', 'audit_log', { action: 'admin_config_change' }],
      ['config_history', 'config_history', {}],
      ['platform_event(config_change)', 'platform_event', { type: 'config_change' }],
    ];
    let newestAll = 0;
    for (const [name, table, filter] of chk) {
      const row = runOne(q(table, filter, { created_at: 1 }, { created_at: -1 }, 1))[0];
      const t = row ? num(row.created_at) : 0;
      probeDetail.push(`${name} 最新=${t ? new Date(t).toISOString() : '(空)'}`);
      if (t > newestAll) newestAll = t;
    }
    if (newestAll < updatedAt - 10 * 60 * 1000) {
      probeFail = true;
      errors.push(`留痕探针 FAIL: 配置 ${new Date(updatedAt).toISOString()} 有写入, 三通道最新均早于其 10 分钟以上——后台写入零留痕(T-9.14 实证)\n    ${probeDetail.join('\n    ')}`);
    }
  } else {
    info.push('近 24h 无配置写入, 留痕探针不触发');
  }

  // ── 4. 输出 ──
  console.log(`[audit-config-drift] 云端 updated_at=${updatedAt ? new Date(updatedAt).toISOString() : '?'}  schema 字段 ${fields.length} 项`);
  errors.forEach((e) => console.log('  [ERROR] ' + e));
  warns.forEach((w) => console.log('  [WARN]  ' + w));
  info.forEach((i) => console.log('  [INFO]  ' + i));
  console.log(`结果: ERROR=${errors.length} WARN=${warns.length} → exit ${errors.length || probeFail ? 1 : 0}`);
  return { errors, warns, exitCode: (errors.length || probeFail) ? 1 : 0 };
}

module.exports = { runDriftAudit };

if (require.main === module) {
  try {
    const { exitCode } = runDriftAudit();
    process.exit(exitCode);
  } catch (e) {
    console.error('[audit-config-drift] 执行失败: ' + e.message);
    process.exit(2);
  }
}
