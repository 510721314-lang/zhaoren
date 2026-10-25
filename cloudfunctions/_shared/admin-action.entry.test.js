// admin-action 入口鉴权门契约测试
// 覆盖点：白名单拒绝 / 空名单 / 无 openid / config_public 免鉴权放行
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

let activeSdk = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return activeSdk;
  return origLoad.apply(this, arguments);
};
function loadIndex(sdk) {
  activeSdk = sdk;
  // 清 index + 其依赖的 openid(模块级 _cachedEnv 会跨用例残留) + logger 缓存
  for (const f of ['../admin-action/index.js', '../admin-action/openid.js', '../admin-action/logger.js']) {
    delete require.cache[require.resolve(f)];
  }
  return require('../admin-action/index.js');
}

const ADMIN = 'o_admin_1';
const STRANGER = 'o_stranger_1';

function store(env, adminOpenids) {
  const global = { env, admin_openids: adminOpenids };
  if (env === 'dev') global.dev_until = Date.now() + 2 * 3600 * 1000;
  return { admin_config: { global } };
}

// 1. 非白名单 → admin_forbidden（白名单非空）
test('admin: 非白名单 openid → admin_forbidden', async () => {
  const sdk = makeSdk({ openid: STRANGER, store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'list_orders' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_forbidden');
});

// 2. 白名单为空 → admin_empty
test('admin: 白名单为空 → admin_empty', async () => {
  const sdk = makeSdk({ openid: STRANGER, store: store('prod', []) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'list_orders' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_empty');
});

// 3. 无 openid（prod + 无真实身份）→ admin_no_openid
test('admin: 无登录身份 → admin_no_openid', async () => {
  const sdk = makeSdk({ openid: '', store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'list_orders' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_no_openid');
});

// 4. config_public 免鉴权：非白名单也能拉取公开配置
test('admin: config_public 免鉴权 → ok', async () => {
  const sdk = makeSdk({ openid: STRANGER, store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_public' }, {});
  assert.strictEqual(r.ok, true);
  assert.ok(r.data, '应返回公开配置数据');
});

// 5. dev 环境 mock_openid → 视为测试管理员放行（不被白名单拦截）
test('admin: dev + mock_openid → 放行(不返回 forbidden)', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'list_orders', mock_openid: STRANGER }, {});
  // 通过鉴权门后才会进入后续；只要不是 forbidden/empty/no_openid 即证明鉴权门放行
  assert.notStrictEqual(r.code, 'admin_forbidden');
  assert.notStrictEqual(r.code, 'admin_empty');
  assert.notStrictEqual(r.code, 'admin_no_openid');
});

// 批4.1: 切 dev 必须带 dev_hours(1-24), 否则 fail-closed 拒绝放开 mock 身份门控
test('config_set: 切 dev 缺 dev_hours → config_bad_dev_hours', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', env: 'dev', confirm: 'SWITCH_DEV', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'config_bad_dev_hours');
});

test('config_set: 切 dev dev_hours=25(超上限) → config_bad_dev_hours', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', env: 'dev', confirm: 'SWITCH_DEV', dev_hours: 25, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'config_bad_dev_hours');
});

test('config_set: 切 dev 带 dev_hours=2 → ok(updated 含 env/dev_until)', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', env: 'dev', confirm: 'SWITCH_DEV', dev_hours: 2, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, true);
  assert.ok((r.data.updated || []).indexOf('env') >= 0, '应写入 env');
  assert.ok((r.data.updated || []).indexOf('dev_until') >= 0, '应写入 dev_until');
});

// 阶段 H(2026-10-15): 履约双确认两超时阈值注册 CONFIG_SCHEMA, 走通用 int 区间校验(1-1440)
test('config_set: start/finish 超时阈值越界(0 / 1441) → config_bad_* 且不落库', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r1 = await main({ action: 'config_set', start_apply_timeout_min: 0, mock_openid: ADMIN }, {});
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.code, 'config_bad_start_apply_timeout_min');
  const r2 = await main({ action: 'config_set', finish_confirm_timeout_min: 1441, mock_openid: ADMIN }, {});
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.code, 'config_bad_finish_confirm_timeout_min');
  assert.ok(!sdk.writes.admin_config, '越界不应写 admin_config');
});

test('config_set: start/finish 超时阈值合法(15/30) → ok 且 updated 含两键、按整数落库', async () => {
  const sdk = makeSdk({ openid: '', store: store('dev', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', start_apply_timeout_min: 15, finish_confirm_timeout_min: 30, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, true);
  assert.ok((r.data.updated || []).indexOf('start_apply_timeout_min') >= 0, 'updated 应含 start_apply_timeout_min');
  assert.ok((r.data.updated || []).indexOf('finish_confirm_timeout_min') >= 0, 'updated 应含 finish_confirm_timeout_min');
  const w = (sdk.writes.admin_config || [])[0];
  assert.strictEqual(w.data.start_apply_timeout_min, 15);
  assert.strictEqual(w.data.finish_confirm_timeout_min, 30);
});

// ── 2026-10-13: admin_login 防爆破锁定(复用 _shared/security_policy.js, 与 user-login 同口径) ──
const crypto2 = require('crypto');
const SALT = 'salt_x1';
const PWD = 'p@ssw0rd-8';
const PWD_HASH = crypto2.createHash('sha256').update(SALT + PWD + SALT).digest('hex');

function loginStore(acc) {
  return {
    admin_config: { global: { env: 'prod', admin_openids: [ADMIN] } },
    admin_accounts: {
      acc_root: Object.assign({
        _id: 'acc_root', account: 'root', password_salt: SALT, password_hash: PWD_HASH,
        role: 'R1', display_name: 'Root', status: 'active', is_deleted: false
      }, acc || {})
    }
  };
}

// (2026-10-13 留存负债闭环: 计数改原子自增 + 达阈值条件写, 断言协议形状 + 条件命中与否)
test('admin_login: 错误密码(未达上限) → login_bad + 原子自增 + 条件置锁写(gte 5, 未命中)', async () => {
  // updateCount 模拟真库语义: 计数<5 时 gte 条件不命中(updated=0)
  const sdk = makeSdk({ openid: '', store: loginStore(), updateCount: (name, q) => (q && q.pwd_fail_count && q.pwd_fail_count.__sentinel === 'gte' ? 0 : 1) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_login', account: 'root', password: 'wrong-pwd-1' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'login_bad');
  const ws = sdk.writes.admin_accounts || [];
  const incW = ws.find((w) => w.doc === 'acc_root' && w.data && w.data.pwd_fail_count && w.data.pwd_fail_count.__sentinel === 'inc');
  assert.ok(incW, '应原子自增失败计数(_.inc)');
  assert.strictEqual(incW.data.pwd_fail_count.args[0], 1, '每次失败 +1');
  const lockW = ws.find((w) => w.where && w.where.pwd_fail_count && w.where.pwd_fail_count.__sentinel === 'gte');
  assert.ok(lockW, '应发起达阈值条件置锁写');
  assert.strictEqual(lockW.where.pwd_fail_count.args[0], 5, '阈值 = 5');
  const ev = (sdk.writes.platform_event || []).find((e) => e.data.type === 'admin_login_fail');
  assert.strictEqual(ev.data.payload.locked, false, '条件未命中 → locked=false');
});

test('admin_login: 第5次失败 → 条件置锁命中(pwd_lock_until≈now+10min, 计数清零)', async () => {
  const sdk = makeSdk({ openid: '', store: loginStore({ pwd_fail_count: 4 }) });
  const { main } = loadIndex(sdk);
  const t0 = Date.now();
  const r = await main({ action: 'admin_login', account: 'root', password: 'wrong-pwd-2' }, {});
  assert.strictEqual(r.code, 'login_bad');
  const ws = sdk.writes.admin_accounts || [];
  const lockW = ws.find((w) => w.where && w.where.pwd_fail_count && w.where.pwd_fail_count.__sentinel === 'gte');
  assert.ok(lockW, '应发起达阈值条件置锁写');
  assert.strictEqual(lockW.data.pwd_fail_count, 0);
  assert.ok(lockW.data.pwd_lock_until > t0 + 9 * 60 * 1000 && lockW.data.pwd_lock_until < t0 + 11 * 60 * 1000, '锁定 10 分钟');
  const ev = (sdk.writes.platform_event || []).find((e) => e.data.type === 'admin_login_fail');
  assert.strictEqual(ev.data.payload.locked, true, 'P1 事件应标注本次触发锁定');
});

test('admin_login: 锁定中(即使密码正确) → login_locked, 不验密不写库', async () => {
  const sdk = makeSdk({ openid: '', store: loginStore({ pwd_lock_until: Date.now() + 5 * 60 * 1000 }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_login', account: 'root', password: PWD }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'login_locked');
  assert.ok(!sdk.writes.admin_accounts, '锁定拒绝不应有账号写');
});

test('admin_login: 密码正确 → 发 token 并清零历史失败计数', async () => {
  const sdk = makeSdk({ openid: '', store: loginStore({ pwd_fail_count: 3, pwd_lock_until: 0 }) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_login', account: 'root', password: PWD }, {});
  assert.strictEqual(r.ok, true);
  assert.ok(String(r.data.token).startsWith('ADMT-'), '应发会话 token');
  const w = (sdk.writes.admin_accounts || [])[0];
  assert.deepStrictEqual(w.data, { pwd_fail_count: 0, pwd_lock_until: 0 });
});

// ── 2026-10-13 P4#1 评审修复: 禁用→启用须清零防爆破锁定残留 ──
function setStatusStore() {
  return {
    admin_config: { global: { env: 'dev', admin_openids: [ADMIN], dev_until: Date.now() + 2 * 3600 * 1000 } },
    admin_accounts: {
      acc_root: {
        _id: 'acc_root', account: 'root', role: 'R1', display_name: 'Root', status: 'disabled', is_deleted: false,
        pwd_fail_count: 3, pwd_lock_until: Date.now() + 5 * 60 * 1000
      }
    }
  };
}

test('admin_account_set_status: 重新启用 → 清零 pwd_fail_count/pwd_lock_until', async () => {
  const sdk = makeSdk({ openid: '', store: setStatusStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'admin_account_set_status', account: 'root', status: 'active', mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, true);
  const w = (sdk.writes.admin_accounts || [])[0];
  assert.ok(w, '应更新账号状态');
  assert.strictEqual(w.data.status, 'active');
  assert.strictEqual(w.data.pwd_fail_count, 0, '启用应清零失败计数');
  assert.strictEqual(w.data.pwd_lock_until, 0, '启用应清零锁定截止');
});

// ── 2026-10-13: 场景/服务项排序(config_set 新增键, 管理后台配置前端显示顺序) ──
function sceneStore() {
  return {
    admin_config: { global: {
      env: 'dev', admin_openids: [ADMIN], dev_until: Date.now() + 2 * 3600 * 1000,
      scene_list: [
        { code: 'W1', name: '就医陪诊', options: ['挂号排队', '取药送药', '陪诊解压'], hidden_options: [], builtin: true },
        { code: 'W2', name: '学习陪伴', options: ['自习陪伴'], hidden_options: [], builtin: true }
      ]
    } }
  };
}

test('config_set scene_reorder: 场景下移 → scene_list 相邻交换', async () => {
  const sdk = makeSdk({ openid: '', store: sceneStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', scene_reorder: { scene: 'W1', direction: 'down' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, true);
  const w = (sdk.writes.admin_config || [])[0];
  assert.deepStrictEqual(w.data.scene_list.map((s) => s.code), ['W2', 'W1']);
});

test('config_set scene_reorder: 已在首位再上移 → config_reorder_noop 且不落库', async () => {
  const sdk = makeSdk({ openid: '', store: sceneStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', scene_reorder: { scene: 'W1', direction: 'up' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'config_reorder_noop');
  assert.ok(!sdk.writes.admin_config, '边界失败不应写库');
});

test('config_set scene_option_reorder: 服务项上移 → options 相邻交换', async () => {
  const sdk = makeSdk({ openid: '', store: sceneStore() });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_set', scene_option_reorder: { scene: 'W1', option: '陪诊解压', direction: 'up' }, mock_openid: ADMIN }, {});
  assert.strictEqual(r.ok, true);
  const w = (sdk.writes.admin_config || [])[0];
  assert.deepStrictEqual(w.data.scene_list[0].options, ['挂号排队', '陪诊解压', '取药送药']);
});

// ── 2026-10-13: 网关代理身份校验从 openid.js 上移到 index.js 包装层后的行为锁定 ──
const WK = 'WK-proxy-1';
function proxyStore() {
  return { admin_config: { global: { env: 'prod', admin_openids: [ADMIN], admin_web_key: WK } } };
}

test('proxy: 网关密钥匹配 → 以上游声明 openid 通过鉴权(不再 forbidden/no_openid)', async () => {
  const sdk = makeSdk({ openid: '', store: proxyStore() });
  const { main } = loadIndex(sdk);
  const r = await main({
    action: 'dashboard', __admin_web_proxy: true,
    _admin_web_proxy_openid: ADMIN, _admin_web_proxy_key: WK, mock_openid: ADMIN
  }, {});
  assert.notStrictEqual(r.code, 'admin_forbidden');
  assert.notStrictEqual(r.code, 'admin_empty');
  assert.notStrictEqual(r.code, 'admin_no_openid');
});

test('proxy: 密钥不匹配 → fail-closed 回落正常解析(prod 拒绝 mock → admin_no_openid)', async () => {
  const sdk = makeSdk({ openid: '', store: proxyStore() });
  const { main } = loadIndex(sdk);
  const r = await main({
    action: 'dashboard', __admin_web_proxy: true,
    _admin_web_proxy_openid: ADMIN, _admin_web_proxy_key: 'WRONG-KEY', mock_openid: ADMIN
  }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'admin_no_openid');
});

// ── 批1a(2026-10-25): 法律文档版本库（legal_doc_*），授权见 docs/legal-compliance-1a-authorization-20261025.md ──
test('legal_doc_publish: 合法 → ok 且版本 v1、双写 admin_config 旧字段+版本快照', async () => {
  const sdk = makeSdk({ openid: ADMIN, store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_publish', doc_type: 'service_agreement', content: '协议正文', remark: '首次发布' }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.version, 1, '空库首次发布应为 v1');
  const addW = (sdk.writes.legal_doc || []).find((w) => w.add);
  assert.ok(addW, '应写入 legal_doc');
  assert.strictEqual(addW.data.status, 'published');
  assert.strictEqual(addW.data.content, '协议正文');
  const cfgW = (sdk.writes.admin_config || []).find((w) => w.where && w.data && w.data.legal_service_agreement);
  assert.ok(cfgW, '应双写 admin_config.legal_service_agreement');
  assert.strictEqual(cfgW.data.legal_service_agreement, '协议正文');
  assert.strictEqual(cfgW.data.legal_versions.service_agreement, 1, '应写版本快照供 config_public 暴露');
});

test('legal_doc_publish: 空内容/非法类型/超长 → 对应错误码且不落库', async () => {
  const sdk = makeSdk({ openid: ADMIN, store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r1 = await main({ action: 'legal_doc_publish', doc_type: 'service_agreement', content: '   ' }, {});
  assert.strictEqual(r1.code, 'legal_empty_content');
  const r2 = await main({ action: 'legal_doc_publish', doc_type: 'not_a_doc', content: 'x' }, {});
  assert.strictEqual(r2.code, 'legal_bad_type');
  const r3 = await main({ action: 'legal_doc_publish', doc_type: 'disclaimer', content: 'x'.repeat(8001) }, {});
  assert.strictEqual(r3.code, 'legal_too_long');
  assert.ok(!sdk.writes.legal_doc, '校验失败不应写 legal_doc');
  assert.ok(!sdk.writes.admin_config, '校验失败不应写 admin_config');
});

test('legal_doc_rollback: 版本不存在 → legal_version_not_found', async () => {
  const sdk = makeSdk({ openid: ADMIN, store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_rollback', doc_type: 'service_agreement', version: 9 }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'legal_version_not_found');
});

test('legal_doc_rollback: 历史存在 → 以旧内容生成新版本(不复用版本号)', async () => {
  const st = store('prod', [ADMIN]);
  st.legal_doc = {
    d1: { _id: 'd1', doc_type: 'service_agreement', version: 1, content: '旧正文', status: 'archived', is_deleted: false }
  };
  const sdk = makeSdk({ openid: ADMIN, store: st });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'legal_doc_rollback', doc_type: 'service_agreement', version: 1 }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.version, 2, '回滚应生成新版本号');
  const addW = (sdk.writes.legal_doc || []).find((w) => w.add);
  assert.strictEqual(addW.data.content, '旧正文');
  assert.strictEqual(addW.data.rolled_back_from, 1);
});

test('config_public: legal_public 补齐隐私政策/通用免责/版本号快照', async () => {
  const sdk = makeSdk({ openid: STRANGER, store: store('prod', [ADMIN]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'config_public' }, {});
  assert.strictEqual(r.ok, true);
  const lp = r.data.legal_public || {};
  assert.ok('privacy_policy' in lp, '应含 privacy_policy');
  assert.ok('disclaimer_text' in lp, '应含 disclaimer_text');
  assert.ok('versions' in lp, '应含 versions 快照');
});

test.after(() => { Module._load = origLoad; });
