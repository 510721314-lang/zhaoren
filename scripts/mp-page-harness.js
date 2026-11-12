'use strict';
// scripts/mp-page-harness.js —— 小程序页面级单测沙箱（P2-2 阶段 1，2026-11-07 用户批准）
//
// 用途：在 Node 内 require miniprogram/pages-v2/**.js（顶层 Page({...})），驱动生命周期，
//   断言 setData 结果、云函数 action 契约、页面跳转、按钮态。不需要开发者工具、不联网、不改小程序源码。
//
// 用法：
//   const { createPage, sleep } = require('./mp-page-harness.js');
//   const p = createPage({ page: 'pages-v2/workbench/workbench.js', fixtures: { 'payment-mock:balance_info': {...} } });
//   p.inst.onLoad(); await sleep(20);
//   assert.strictEqual(p.inst.data.xxx, ...); p.restore();
//
// 与真机的已知差异：
//   ① 只实现被测页面用到的 wx API，未实现的返回空函数（不抛错）；
//   ② setInterval 被替换为假定时器（只记录不触发），避免轮询把测试挂住；
//   ③ setData 支持浅合并与 a.b.c 路径键，不触发重渲染。
const path = require('path');

const MP_ROOT = path.resolve(__dirname, '..', 'miniprogram');

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// setData 的路径键语义（真机支持 'form.title' 写法）
function applyPatch(target, patch) {
  Object.keys(patch).forEach((key) => {
    const parts = key.split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = patch[key];
  });
}

// 夹具路由：'<函数名>:<action>' > '<函数名>' > 'default'
function resolveFixture(fixtures, name, data) {
  const action = (data && data.action) || '';
  if (typeof fixtures === 'function') return fixtures(name, data);
  if (fixtures) {
    const key = name + ':' + action;
    if (typeof fixtures[key] !== 'undefined') return fixtures[key];
    if (typeof fixtures[name] !== 'undefined') return fixtures[name];
    if (typeof fixtures.default !== 'undefined') return fixtures.default;
  }
  return { ok: true, data: {} };
}

function createPage(opts) {
  const o = opts || {};
  if (!o.page) throw new Error('createPage 需要 page 参数（相对 miniprogram/ 的路径）');
  const abs = path.resolve(MP_ROOT, o.page);

  const calls = { cloud: [], nav: [], toast: [], modal: [], wx: {}, storage: [], setData: [] };
  const storage = Object.assign({}, clone(o.storage) || {});
  const timers = [];

  const record = (bucket) => (arg) => { bucket.push(clone(arg)); };

  // 云调用统一出口：页面经 utils/cloud.js 走 app.cloudCall，故这里同时是调用记录点
  const app = Object.assign({
    globalData: Object.assign({ cloudReady: Promise.resolve() }, clone(o.globalData) || {}),
    cloudCall(name, data) {
      calls.cloud.push({ name, data: clone(data) });
      const fx = resolveFixture(o.fixtures, name, data);
      return fx instanceof Error ? Promise.reject(fx) : Promise.resolve(clone(fx));
    }
  }, o.app || {});

  const wxBase = Object.assign({
    cloud: {
      callFunction(arg) {
        calls.cloud.push({ name: arg && arg.name, data: clone(arg && arg.data) });
        const fx = resolveFixture(o.fixtures, arg && arg.name, arg && arg.data);
        if (fx instanceof Error) return Promise.reject(fx);
        return Promise.resolve({ result: clone(fx) });
      }
    },
    navigateTo: record(calls.nav),
    redirectTo: record(calls.nav),
    switchTab: record(calls.nav),
    reLaunch: record(calls.nav),
    openLocation: record(calls.wx),
    showToast: record(calls.toast),
    // 弹窗：记录参数并挂 __confirm()/__cancel()，便于测试驱动 success 回调
    showModal(arg) {
      const src = arg || {};
      const rec = clone(src);
      rec.__confirm = () => { if (typeof src.success === 'function') src.success({ confirm: true, cancel: false }); };
      rec.__cancel = () => { if (typeof src.success === 'function') src.success({ confirm: false, cancel: true }); };
      rec.__fail = () => { if (typeof src.fail === 'function') src.fail({ errMsg: 'showModal:fail' }); };
      calls.modal.push(rec);
      return rec;
    },
    // 选择器查询：链式空桩（页面只做滚动/测量，测试不校验渲染）
    createSelectorQuery() {
      const q = {
        select: () => q, selectAll: () => q, selectViewport: () => q, in: () => q,
        boundingClientRect: () => q, scrollOffset: () => q, fields: () => q,
        exec: (cb) => { if (typeof cb === 'function') cb([]); }
      };
      return q;
    },
    stopPullDownRefresh() {},
    nextTick(fn) { if (typeof fn === 'function') fn(); },
    getStorageSync(k) { return typeof storage[k] === 'undefined' ? '' : storage[k]; },
    setStorageSync(k, v) { storage[k] = clone(v); calls.storage.push({ op: 'set', key: k }); },
    removeStorageSync(k) { delete storage[k]; calls.storage.push({ op: 'remove', key: k }); },
    getSystemInfoSync() {
      return {
        platform: 'devtools', SDKVersion: '3.0.0', statusBarHeight: 20,
        windowWidth: 375, windowHeight: 667,
        safeArea: { top: 20, left: 0, right: 375, bottom: 667, width: 375, height: 647 }
      };
    }
  }, o.wx || {}); // 用例可覆盖特定 API（如让 getLocation 立即 fail，避免触发 8s 兜底定时器）

  // 未显式实现的 wx API：返回空函数并留痕（避免页面 typeof 判定走错分支时抛错）
  const wx = new Proxy(wxBase, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      return function unknownWxApi(arg) {
        calls.wx[key] = clone(arg);
      };
    }
  });

  const saved = {
    Page: global.Page,
    getApp: global.getApp,
    wx: global.wx,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval
  };

  let captured = null;
  global.Page = (cfg) => { captured = cfg; };
  global.getApp = () => app;
  global.wx = wx;
  global.setInterval = (fn, ms) => {
    const handle = { fn, ms, cleared: false };
    timers.push(handle);
    return handle;
  };
  global.clearInterval = (handle) => {
    if (handle) handle.cleared = true;
    const i = timers.indexOf(handle);
    if (i >= 0) timers.splice(i, 1);
  };

  delete require.cache[require.resolve(abs)];
  require(abs);
  if (!captured) throw new Error('页面未调用 Page()：' + o.page);
  // 注意：页面方法在运行期才解析全局 wx / getApp，故沙箱全局必须保持到 restore()，
  //   不能像普通模块那样 require 完就还原。

  const inst = Object.assign({}, captured);
  inst.data = Object.assign(clone(captured.data) || {}, clone(o.data) || {});
  inst.setData = (patch, cb) => {
    if (patch && typeof patch === 'object') {
      calls.setData.push(clone(patch));
      applyPatch(inst.data, patch);
    }
    if (typeof cb === 'function') cb();
  };

  return {
    inst,
    cfg: captured,
    wx,
    app,
    calls,
    timers,
    // 还原沙箱全局并清掉页面模块缓存（仅当自己仍是当前生效的沙箱，避免串扰上层）
    restore() {
      if (global.wx === wx) {
        global.Page = saved.Page;
        global.getApp = saved.getApp;
        global.wx = saved.wx;
        global.setInterval = saved.setInterval;
        global.clearInterval = saved.clearInterval;
      }
      delete require.cache[require.resolve(abs)];
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { createPage, sleep, MP_ROOT };
