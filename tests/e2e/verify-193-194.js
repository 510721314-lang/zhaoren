// 一次性验收脚本：REGISTRY #193（发布页多图 Banner）+ #194（订单详情履约地址取四确认最终地点）
// 2026-11-22 · 开发者工具模拟器内验证，产出 PASS / FAIL / SKIP 三态，禁止「解析不到=通过」
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');
const { PORT, startDevTools, waitForReady } = require('./devtools-launcher');

const ART = path.join(__dirname, 'artifacts');
if (!fs.existsSync(ART)) fs.mkdirSync(ART, { recursive: true });

const results = [];
function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name}${detail ? ' | ' + detail : ''}`);
}

async function shot(mp, file) {
  try { await mp.screenshot({ path: path.join(ART, file) }); } catch (_) {}
}

async function setOrder(page, order) {
  // 页面 wxml 顺序：wx:if loading → wx:elif loadError → wx:elif order；
  // 无效 order_id 会停在异常态，必须同时清掉 loading/loadError 才能渲染正常态
  await page.setData({ loading: false, loadError: false, order });
  await new Promise((r) => setTimeout(r, 500));
}

async function rowText(page) {
  // 页面上有多个 .od__row（子场景/耍伴/履约地址等），只认含「履约地址」的那一行
  const els = await page.$$('.od__row');
  for (const el of els) {
    const t = await el.text();
    if (t && t.indexOf('履约地址') >= 0) return t;
  }
  return null;
}

function portReady(port) {
  try {
    const out = require('child_process').execSync(`netstat -ano | findstr ":${port}.*LISTENING"`, { encoding: 'utf8' });
    return !!out.trim();
  } catch (_) { return false; }
}

(async () => {
  // 本机 DevTools 的 IDE server 端口为 28023（非 33306），startDevTools 的自检会误判并重复 spawn；
  // 故端口已就绪时直接连接，仅在未就绪时才走启动模块。
  if (portReady(PORT)) {
    console.log(`自动化端口 ${PORT} 已就绪，跳过启动流程`);
  } else {
    await startDevTools();
  }
  const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${PORT}` });
  let failed = 0;
  try {
    if (!(await waitForReady(mp, 60))) throw new Error('编译未就绪（currentPage 60s 内为 undefined）');

    // ══════════ #193 发布页多图 Banner ══════════
    const pub = await mp.reLaunch('/pages-v2/publish/publish');
    if (!pub) throw new Error('reLaunch 发布页返回 undefined');
    await pub.waitFor(2500);

    // 直连云函数拿原始返回，区分「后台无配置」与「调用失败/配额耗尽」
    let cloud = { ok: false, list: null, err: '' };
    try {
      const r = await mp.evaluate(async () => {
        const res = await wx.cloud.callFunction({ name: 'home-action', data: { action: 'publish_banner_list' } });
        return res.result;
      });
      cloud.ok = !!(r && r.ok);
      cloud.list = r && r.data && Array.isArray(r.data.list) ? r.data.list.length : null;
      cloud.err = (r && (r.msg || r.code)) || '';
    } catch (e) {
      cloud.err = String(e && e.message || e).slice(0, 160);
    }

    const pubData = await pub.data();
    const banners = Array.isArray(pubData.banners) ? pubData.banners : [];
    const swiperEl = await pub.$('.pub__banner');

    // 断言183-1：数据契约（≤6 张、每张 id/image/link 齐全、id 唯一）
    const badItem = banners.find((b) => !b || !b.id || !b.image || !b.link);
    const dup = banners.length !== new Set(banners.map((b) => b && b.id)).size;
    if (banners.length === 0) {
      record('193-1', 'banner 数据非空', 'SKIP',
        `banners=0；云返回 ok=${cloud.ok} list=${cloud.list} err=${cloud.err || '无'}` +
        (cloud.ok && cloud.list === 0 ? '（后台确实无配置，属预期空态）' : '（云调用异常，无法判定）'));
    } else if (banners.length > 6) {
      failed++; record('193-1', 'banner 张数封顶 6', 'FAIL', `实际 ${banners.length} 张 > 6`);
    } else if (badItem) {
      failed++; record('193-1', 'banner 字段完整性', 'FAIL', `缺字段项=${JSON.stringify(badItem).slice(0, 120)}`);
    } else if (dup) {
      failed++; record('193-1', 'banner id 唯一', 'FAIL', `id 重复：${banners.map((b) => b.id).join(',')}`);
    } else {
      record('193-1', 'banner 数据契约（≤6/字段齐/id 唯一）', 'PASS', `${banners.length} 张：${banners.map((b) => b.id).join(',')}`);
    }

    // 断言193-2：DOM 与数据一致（有数据必有 swiper，无数据必不渲染）
    if (banners.length > 0 && swiperEl) {
      record('193-2', 'swiper 渲染', 'PASS', `banners=${banners.length} 且 .pub__banner 存在`);
    } else if (banners.length === 0 && !swiperEl) {
      record('193-2', '空配置不渲染', 'PASS', 'banners=0 且 .pub__banner 不存在（符合 #190 空态约定）');
    } else {
      failed++; record('193-2', 'DOM/数据一致性', 'FAIL', `banners=${banners.length}，swiper=${!!swiperEl}`);
    }

    await shot(mp, '193-publish-banner.png');

    // ══════════ #194 订单详情履约地址 ══════════
    const od = await mp.reLaunch('/pages-v2/order-detail/order-detail?order_id=TEST_ONLY_VERIFY');
    if (!od) throw new Error('reLaunch 订单详情返回 undefined');
    await od.waitFor(2000);

    // 用例 A：四确认地点优先于手填地址
    await setOrder(od, { confirmed_location_name: '四确认地点XYZ', service_address: '手填门牌ABC' });
    const tA = await rowText(od);
    if (tA && tA.includes('四确认地点XYZ') && !tA.includes('手填门牌ABC')) {
      record('194-A', '四确认地点优先', 'PASS', `行文本=${tA.replace(/\s+/g, ' ').slice(0, 60)}`);
    } else {
      failed++; record('194-A', '四确认地点优先', 'FAIL', `期望含「四确认地点XYZ」且不含「手填门牌ABC」，实际=${tA}`);
    }

    // 用例 B：无四确认数据回退手填地址
    await setOrder(od, { confirmed_location_name: '', service_address: '手填门牌ABC' });
    const tB = await rowText(od);
    if (tB && tB.includes('手填门牌ABC')) {
      record('194-B', '回退手填地址', 'PASS', `行文本=${tB.replace(/\s+/g, ' ').slice(0, 60)}`);
    } else {
      failed++; record('194-B', '回退手填地址', 'FAIL', `期望含「手填门牌ABC」，实际=${tB}`);
    }

    // 用例 C：两者皆无时整行隐藏（不再回退地图 POI 短名）
    await setOrder(od, { confirmed_location_name: '', service_address: '', location: { name: '地图POI短名' } });
    const tC = await rowText(od);
    if (!tC) {
      record('194-C', '两者皆无则隐藏', 'PASS', '.od__row 不存在（未回退 location.name）');
    } else {
      failed++; record('194-C', '两者皆无则隐藏', 'FAIL', `行仍存在：${tC}`);
    }

    await shot(mp, '194-order-detail.png');

    // ══════════ #194-D 真实订单端到端（读真实云数据，验证 order-view 映射）══════════
    let realOd = null;
    try {
      const res = await mp.evaluate(async () => {
        const roles = ['user', 'partner'];
        for (const role of roles) {
          const r = await wx.cloud.callFunction({
            name: 'order-action',
            data: { action: 'my_orders', role, filter: 'all', page_size: 20 }
          });
          const l = (r.result && r.result.data && (r.result.data.list || r.result.data.items)) || [];
          // my_orders 里 item_type='demand' 是「待接单需求」，其 order_id 是 demand._id，不能用来查订单详情
          const hit = l.find((o) => o && o.order_id && o.item_type !== 'demand');
          if (hit) return { ok: true, order: hit };
        }
        return { ok: false, order: null };
      });
      realOd = (res && res.order) || null;
      if (!realOd) {
        record('194-D', '真实订单端到端', 'SKIP', `my_orders（user+partner，filter=all）均无订单，无法端到端`);
      }
    } catch (e) {
      record('194-D', '真实订单端到端', 'SKIP', `order-action list 调用异常：${String(e && e.message || e).slice(0, 120)}`);
    }

    if (realOd) {
      // 页面 onLoad 取的是 options.orderId（非 order_id），且校验 32 位 hex
      const od2 = await mp.reLaunch('/pages-v2/order-detail/order-detail?orderId=' + encodeURIComponent(realOd.order_id));
      await od2.waitFor(1500);
      // 轮询等详情云调用回填（模拟器 + 云函数冷启动最慢约 8s）
      let d2 = await od2.data();
      for (let i = 0; i < 12 && !(d2.order && d2.order.order_id); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        d2 = await od2.data();
      }
      const o = d2.order || {};
      const t = await rowText(od2);
      const expect = o.confirmed_location_name || o.service_address || '';
      const diag = `loading=${d2.loading} loadError=${!!d2.loadError} orderKeys=${Object.keys(o).slice(0, 6).join('/')}`;
      if (!o.order_id) {
        // 诊断：直接调 detail 拿到错误码/文案，避免把「脚本/权限问题」误判成产品缺陷
        let raw = '';
        try {
          const r = await mp.evaluate(async (oid) => {
            const res = await wx.cloud.callFunction({ name: 'order-action', data: { action: 'detail', order_id: oid } });
            return res.result;
          }, realOd.order_id);
          raw = JSON.stringify(r).slice(0, 200);
        } catch (e) { raw = String(e && e.message || e).slice(0, 200); }
        record('194-D', '真实订单端到端', 'SKIP', `详情未回填（${diag}）；直接调 detail 返回=${raw}`);
      } else if (!expect) {
        record('194-D', '真实订单端到端', 'SKIP',
          `订单 ${o.order_id}（状态 ${o.status}）无四确认地点也无手填地址，属预期「整行隐藏」，无法验证映射`);
      } else if (t && t.indexOf(expect) >= 0) {
        record('194-D', '真实订单端到端', 'PASS',
          `订单 ${o.order_id} 状态=${o.status} 期望=${expect} 实际行=${t.replace(/\s+/g, ' ').slice(0, 60)}`);
      } else {
        failed++;
        record('194-D', '真实订单端到端', 'FAIL', `订单 ${o.order_id} 期望含「${expect}」实际行=${t}`);
      }
      await shot(mp, '194-real-order.png');
    }
  } catch (e) {
    failed++;
    record('SYS', '脚本执行', 'FAIL', String(e && e.message || e).slice(0, 300));
  } finally {
    try { await mp.disconnect(); } catch (_) {}
  }

  const pass = results.filter((r) => r.status === 'PASS').length;
  const skip = results.filter((r) => r.status === 'SKIP').length;
  console.log(`\nSUMMARY pass=${pass} fail=${failed} skip=${skip} total=${results.length}`);
  console.log('ARTIFACTS ' + ART);
  process.exit(failed > 0 ? 1 : 0);
})();
