// home-action 入口契约测试 · 批2 服务项目只读浏览(service_list / service_detail)
// 只增不改：拦截 wx-server-sdk，断言「event 输入 → 返回 code」契约，零运行时改动。
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
  for (const f of ['../home-action/index.js', '../home-action/openid.js', '../home-action/logger.js']) {
    try { delete require.cache[require.resolve(f)]; } catch (e) {}
  }
  return require('../home-action/index.js');
}

// store 预置 admin_config.scene_list 白名单; 未传则走 SCENE_FALLBACK
function storeWithScenes(scenes) {
  return { admin_config: { global: { scene_list: scenes } } };
}
const SCENES = [{ code: 'W1', name: '学习陪伴' }];

test('service_detail: 缺 id → home_bad_param(不查库)', async () => {
  const sdk = makeSdk({ openid: '', store: storeWithScenes(SCENES) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'service_detail' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'home_bad_param');
});

test('service_list: scene_code 非法 → home_bad_scene(查库前白名单校验拦截)', async () => {
  const sdk = makeSdk({ openid: '', store: storeWithScenes(SCENES) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'service_list', scene_code: 'W99' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'home_bad_scene');
});

test('service_detail: id 不存在 → home_not_found(查库后空兜底)', async () => {
  const sdk = makeSdk({ openid: '', store: storeWithScenes(SCENES) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'service_detail', id: 'not_exist_123' }, {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'home_not_found');
});

// store 预置 admin_config.publish_banners; 未传则 loadPublishBannersRaw 兜底 []
function storeWithBanners(banners) {
  return { admin_config: { global: { publish_banners: banners } } };
}

test('publish_banner_list: 无配置 → ok 且 list 为空(发布页整块不渲染)', async () => {
  const sdk = makeSdk({ openid: '', store: storeWithBanners([]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish_banner_list' }, {});
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data.list, []);
});

test('publish_banner_list: 过滤 disabled+缺图 + 按 sort 升序 + 只下发 id/image/link', async () => {
  const sdk = makeSdk({ openid: '', store: storeWithBanners([
    { id: 'b2', image: 'cloud://x/2.jpg', link: '/pages-v2/square/square', sort: 20, enabled: true },
    { id: 'b1', image: 'cloud://x/1.jpg', link: '/pages-v2/index/index', sort: 10, enabled: true },
    { id: 'b3', image: 'cloud://x/3.jpg', link: '/pages-v2/service/service', sort: 30, enabled: false },
    { id: 'b4', image: '', link: '/x', sort: 5, enabled: true }
  ]) });
  const { main } = loadIndex(sdk);
  const r = await main({ action: 'publish_banner_list' }, {});
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data.list, [
    { id: 'b1', image: 'cloud://x/1.jpg', link: '/pages-v2/index/index' },
    { id: 'b2', image: 'cloud://x/2.jpg', link: '/pages-v2/square/square' }
  ]);
});
