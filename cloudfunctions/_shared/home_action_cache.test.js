// home-action scene_groups 访客维度 60s 缓存守护测试(零依赖 node:test)
// 背景: 物理拆分后 TTL_SCENE_GROUPS 一度漏注入 ctx → memSet 第三参 undefined →
//       until=Date.now()+undefined=NaN → memGet 永不命中 → 每次都重跑 buildSceneGroups。
// 本测试: 同一(暖实例)模块连调两次 scene_groups, 断言第二次不再产生 demand 查询(命中缓存)。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { makeSdk } = require('./_mock_sdk');

const USER = 'o_user_1';

function store() {
  return {
    admin_config: { global: {
      env: 'dev', dev_until: Date.now() + 3600 * 1000, take_distance_max_km: 50,
      scene_list: [
        { code: 'W1', name: '就医陪诊', options: ['陪同挂号', '取药'], visible: true, builtin: true },
        { code: 'W2', name: '学习陪伴', options: ['陪读'], visible: true, builtin: true }
      ]
    } },
    // USER 为 approved 耍伴(带 range 也不影响: 两次入参一致 → cacheKey 一致)
    partner_profile: {
      ['p'.repeat(32)]: { _id: 'p'.repeat(32), openid: USER, status: 'approved', accept_scenes: ['W1'], is_deleted: false }
    },
    demand: {}, user_account: {}, blog_post: {}, system_notice: {}, audit_log: {}
  };
}

function loadHome(sdk) {
  const orig = Module._load;
  Module._load = function (r) { if (r === 'wx-server-sdk') return sdk; return orig.apply(this, arguments); };
  const full = path.join(__dirname, '..', 'home-action', 'index.js');
  delete require.cache[require.resolve(full)];
  const mod = require(full);
  Module._load = orig;
  return mod;
}

// 统计一次调用期间对 demand 集合的读次数(where.get; buildSceneGroups 每可见场景一次)
function demandReads(calls, mark) {
  return calls.slice(mark).filter((c) => c.name === 'demand' && c.method === 'where.get').length;
}

test('scene_groups 同一暖实例第二次调用命中 60s 缓存, 不再重查 demand', async () => {
  const sdk = makeSdk({ openid: USER, store: store() });
  const mod = loadHome(sdk);
  const event = { action: 'scene_groups', mock_openid: USER };

  const m1 = sdk.calls.length;
  const r1 = await mod.main(event, {});
  const n1 = demandReads(sdk.calls, m1);

  const m2 = sdk.calls.length;
  const r2 = await mod.main(event, {});
  const n2 = demandReads(sdk.calls, m2);

  assert.equal(r1.ok, true, '首次调用应成功');
  assert.equal(r2.ok, true, '二次调用应成功');
  assert.deepStrictEqual(
    r1.data && r1.data.scene_groups,
    r2.data && r2.data.scene_groups,
    '两次返回的 scene_groups 应一致(缓存内容相同)'
  );
  assert.ok(n1 >= 2, `首次 miss 应按可见场景重查 demand(期望≥2), 实际 ${n1}`);
  assert.equal(n2, 0, `第二次应命中缓存、0 次 demand 查询, 实际 ${n2}(TTL 漏注入?)`);
});
