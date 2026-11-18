// T-7.26(2026-11-07): 自 init-db/index.js 物理拆分(逐字搬移, 零行为变更)。
// 红线: 禁止 require('./index')(循环引用); 依赖一律经 ctx 注入。

// ── 测试数据清理(D6): 默认只删夹具前缀 TEST840710820 的 is_test 单; scope='all_istest' 已废除(2026-11-17误删事故); 清理仅允许 夹具前缀批量(默认) 或 order_ids/demand_ids 点名(32hex, ≤50); 默认 dry-run 只统计, 真删须 confirm='PURGE' ──
async function purge_test_data(ctx) {
  const { event, db, adminIdentity } = ctx;
  const _ = db.command;
  const confirmed = String(event.confirm || '') === 'PURGE';
  // 2026-11-06 范围收紧: 默认只清本工具夹具前缀单(原全量 is_test 模式已于 2026-11-18 废除, 见 L13)
  // 背景: is_test 只是「参与方命中 test_openids」的打标, 真实单号(ORD...)也会命中;
  // 实测云端 is_test:true 中 86 条为非 TEST 前缀, 原全量硬删不可恢复, 与本模块「绝不误删真实用户数据」冲突
  const PURGE_PREFIX = 'TEST840710820';
  // 2026-11-18 事故加固: 废除 scope=all_istest 全删模式 —— test_openids 含真实openid导致用户历史单被打标,
  // 11-17 all_istest 误删186单+1709通知(经11-16备份恢复)。清理仅允许: 夹具前缀批量(默认) 或 order_ids 点名(32hex, ≤50)
  if (String(event.scope || '') === 'all_istest') {
    return { ok: false, code: 'idb_purge_scope_disabled', msg: 'scope=all_istest 已废除(2026-11-17误删事故加固)。清理仅允许夹具前缀批量(默认)或 order_ids 点名(32hex, ≤50)' };
  }
  const nameIds = Array.isArray(event.order_ids) ? event.order_ids.map(String).filter((x) => /^[a-f0-9]{32}$/i.test(x)).slice(0, 50) : [];
  // demand_ids 点名: 处理「发布后未成单中断」的 demand 残留(e2e 场景); 扫描源已是 is_test:true, 天然护栏
  const nameDemandIds = Array.isArray(event.demand_ids) ? event.demand_ids.map(String).filter((x) => /^[a-f0-9]{32}$/i.test(x)).slice(0, 50) : [];
  // 1. 扫描测试主文档(拿 _id 供级联; 上限 1000 防失控)
  // 2026-11-18 P2-1 根因治理: 点名 ID 的单即使未打 is_test 也须能被扫到(否则 test_openids 移除真实 openid 后 e2e 造单无法清理).
  // count 仍用纯 is_test:true 统计(outOfScopeOrders 口径不变)
  const orderFilter = nameIds.length ? _.or([{ is_test: true }, { _id: _.in(nameIds) }]) : { is_test: true };
  const demandFilter = nameDemandIds.length ? _.or([{ is_test: true }, { _id: _.in(nameDemandIds) }]) : { is_test: true };
  const [demandsR, ordersR, demandCnt, orderCnt] = await Promise.all([
    db.collection('demand').where(demandFilter).limit(1000).get().catch(() => ({ data: [] })),
    db.collection('order_main').where(orderFilter).limit(1000).get().catch(() => ({ data: [] })),
    db.collection('demand').where({ is_test: true }).count().catch(() => ({ total: 0 })),
    db.collection('order_main').where({ is_test: true }).count().catch(() => ({ total: 0 }))
  ]);
  // 2. 按范围筛选: 夹具前缀批量 或 order_ids 点名; 关联 demand 随订单精确匹配(不做独立条件删)
  const pickedOrders = (ordersR.data || []).filter((o) => String(o.order_no || '').indexOf(PURGE_PREFIX) === 0 || nameIds.includes(o._id));
  const pickedDemandIds = new Set(pickedOrders.map((o) => o.demand_id).filter(Boolean));
  const pickedDemands = (demandsR.data || []).filter((d) => pickedDemandIds.has(d._id) || nameDemandIds.includes(d._id));
  const orderIds = pickedOrders.map((o) => o._id);
  const demandIds = pickedDemands.map((d) => d._id);
  const totalOrders = orderIds.length, totalDemands = demandIds.length;
  const outOfScopeOrders = (orderCnt.total || 0) - totalOrders;
  const cascadeCols = ['pay_transaction', 'system_notice', 'evaluation', 'disclaimer_signature', 'order_status_log', 'im_message', 'im_conversation'];
  // 2. dry-run: 报告将删数量, 不动任何数据
  if (!confirmed) {
    const stats = { demand: totalDemands, order_main: totalOrders };
    for (const c of cascadeCols) {
      if (!orderIds.length) { stats[c] = 0; continue; }
      try {
        const r = await db.collection(c).where({ order_id: _.in(orderIds) }).count();
        stats[c] = r.total || 0;
      } catch (e) { stats[c] = 'err:' + String(e.message || e).slice(0, 40); }
    }
    const preview = {
      scope: nameIds.length ? 'test_prefix+named' : 'test_prefix',
      named_orders: nameIds.length,
      out_of_scope_orders: outOfScopeOrders,
      sample_orders: pickedOrders.slice(0, 10).map((o) => o.order_no)
    };
    return {
      ok: true, mode: 'purge_test_data', dry_run: true, stats, preview,
      hint: `清理范围=夹具前缀 ${PURGE_PREFIX} 批量 + order_ids 点名(${nameIds.length})。真删重发 { confirm:'PURGE' }；另有 ${outOfScopeOrders} 条 is_test 单不在本范围内`
    };
  }
  // 3. 真删护栏: 超限拒绝(防误标/误操作大面积清除)
  if (totalOrders > 500 || totalDemands > 500) {
    return { ok: false, code: 'idb_purge_too_many', msg: `测试数据超单次上限(orders=${totalOrders}, demands=${totalDemands}, 上限 500), 请先分批处理` };
  }
  const removed = {};
  // 先删级联子表, 再删主表; 失败即中断并报告已删进度(幂等可重跑)
  for (const c of cascadeCols) {
    if (!orderIds.length) { removed[c] = 0; continue; }
    try {
      const r = await db.collection(c).where({ order_id: _.in(orderIds) }).remove();
      removed[c] = (r.stats && r.stats.removed) || 0;
    } catch (e) {
      return { ok: false, code: 'idb_purge_fail', col: c, msg: String(e.message || e), removed_partial: removed };
    }
  }
  try {
    // 2026-11-06 改为按 _id 精确删, 与上方 pickedOrders/pickedDemands 范围严格一致
    // 原 where({is_test:true}).remove() 会越过筛选, 把非夹具/非白名单参与方的历史单一起硬删
    const r1 = orderIds.length ? await db.collection('order_main').where({ _id: _.in(orderIds) }).remove() : { stats: { removed: 0 } };
    removed.order_main = (r1.stats && r1.stats.removed) || 0;
    const r2 = demandIds.length ? await db.collection('demand').where({ _id: _.in(demandIds) }).remove() : { stats: { removed: 0 } };
    removed.demand = (r2.stats && r2.stats.removed) || 0;
  } catch (e) {
    return { ok: false, code: 'idb_purge_fail', col: 'main', msg: String(e.message || e), removed_partial: removed };
  }
  // 4. P2 审计留痕
  try {
    await db.collection('platform_event').add({ data: {
      level: 'P2', type: 'purge_test_data', openid: adminIdentity || 'unknown',
      payload: { scope: nameIds.length ? 'test_prefix+named' : 'test_prefix', named_orders: nameIds.length, scanned_orders: totalOrders, scanned_demands: totalDemands, out_of_scope_orders: outOfScopeOrders, removed },
      created_at: Date.now(), updated_at: Date.now(), is_deleted: false
    }});
  } catch (_) {}
  return { ok: true, mode: 'purge_test_data', dry_run: false, scope: nameIds.length ? 'test_prefix+named' : 'test_prefix', removed, scanned_orders: totalOrders, scanned_demands: totalDemands, out_of_scope_orders: outOfScopeOrders };
}

// run_seed: 默认幂等种子补齐(建集合/索引 + 补齐 admin_config 缺失字段), 由 index 在种子鉴权门之后调用
async function run_seed(ctx) {
  const { db, SEED_CONFIG, COLLECTIONS, INDEXES } = ctx;
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
    // 幂等跳过 vs 真实失败必须可区分(2026-10-08 3B: 索引静默失效教训)
    skipped.push(`index:${idx.coll}.${idx.name}`);
    const msg = String((e && (e.errMsg || e.message)) || '');
    if (!/exist|already|重复|已存在/i.test(msg)) {
      warnings.push(`index:${idx.coll}.${idx.name} → ${msg.slice(0, 160)}`);
    }
    console.log(`skip index ${idx.coll}.${idx.name}: ${msg}`);
  }
}

// 3. 写入 admin_config 种子(幂等:不存在则建,已存在则补齐缺失字段,不覆盖已有值)
try {
  const exist = await db.collection('admin_config').doc('global').get();
  const doc = exist.data;
  if (doc && doc._id) {
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
    // 旧版 system_templates id 为 T1-T8, 前端/im-send 约定为 TM1-TM8;
    // 检测到任一 TM id 缺失即整组迁移覆盖(幂等: 已是 TM1-TM8 时不动)
    const tplIds = Array.isArray(doc.system_templates)
      ? doc.system_templates.map((t) => String(t && t.id).toUpperCase())
      : [];
    const seedTplIds = SEED_CONFIG.system_templates.map((t) => t.id);
    const needMigrate = seedTplIds.some((id) => tplIds.indexOf(id) < 0);
    if (needMigrate) {
      patch.system_templates = SEED_CONFIG.system_templates;
      hasPatch = true;
    }

    // ── 场景对齐(非破坏式) ──
    // 种子已含全部 9 个开放场景, 与线上 config 的差异仅为 options 中的运营测试项。
    // 规则: ① 云端额外场景(运营 scene_add 新增)一律保留 ② 种子已知场景按"字段级合并"同步:
    //          以云端对象为底, 只覆盖种子定义的字段(保留 created_at 等云端独有字段)
    //       ③ 云端缺失的种子场景追加到末尾
    // 语义说明: 9 个内置场景的 options 以种子为准(运营用 scene_option_add 加的选项会被同步覆盖),
    //           场景本身不会被删 —— 早期版本此处做"全量覆写", 会连同额外场景一起删掉。
    const seedList = SEED_CONFIG.scene_list;
    const seedCodes = seedList.map((s) => s.code);
    const docList = Array.isArray(doc.scene_list) ? doc.scene_list.slice() : [];
    const docCodes = docList.map((s) => s && s.code).filter(Boolean);
    const extraInDoc = docCodes.filter((c) => seedCodes.indexOf(c) < 0);
    const missingInDoc = seedCodes.filter((c) => docCodes.indexOf(c) < 0);
    let sceneChanged = false;
    const mergedList = docList.map((d) => {
      if (!d || seedCodes.indexOf(d.code) < 0) return d;
      const seedS = seedList.find((s) => s.code === d.code);
      if (!seedS) return d;
      // 字段级合并: 以云端为底(保留 created_at 等云端独有字段), 只覆盖种子定义的字段
      const merged = Object.assign({}, d, seedS);
      if (JSON.stringify(merged) !== JSON.stringify(d)) sceneChanged = true;
      return merged;
    });
    for (const c of missingInDoc) {
      const seedS = seedList.find((s) => s.code === c);
      if (seedS) {
        mergedList.push(seedS);
        sceneChanged = true;
      }
    }
    if (sceneChanged && mergedList.length > 0) {
      patch.scene_list = mergedList;
      hasPatch = true;
    }
    if (extraInDoc.length > 0) {
      console.log('scene_list keeps scenes not in seed (operator-added): ' + extraInDoc.join(','));
    }
    if (hasPatch) {
      patch.updated_at = Date.now();
      await db.collection('admin_config').doc('global').update({ data: patch });
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
}

module.exports = { purge_test_data, run_seed };
