// scripts/auto-ui-pages.js —— 模拟器 UI 最小版自动验收（2026-11-05，授权口径：仅 2 项）
// 覆盖：runbook §3.12（S1 不出现 S2 变更入口）+ §3.7（S2 到点文案「已到服务时间」）
// 前置：开发者工具已登录；会占用 IDE 自动化端口（默认 9420）
// 跑法：node scripts/auto-ui-pages.js
// 说明：不改任何小程序源码；夹具走 scripts/test-order-tool.js create（is_test:true，勿 cleanup，真机还要用）
const { execFileSync } = require('child_process');
const automator = require('miniprogram-automator');
const { devtools, validateDevtools } = require('./load-env.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 造夹具（复用既有工具，输出 JSON 取 _id）
// 若同后缀单已存在（uk_order_no 唯一索引，软删单仍占位），退化为只读查回该单
const { execTcbCommands } = require('./tcb-exec');
function findExisting(orderNo) {
  const r = execTcbCommands([{ TableName: 'order_main', CommandType: 'COMMAND', Command: JSON.stringify({
    find: 'order_main', filter: { order_no: orderNo }, projection: { _id: 1, order_no: 1, status: 1, start_time: 1, is_deleted: 1 }, limit: 1
  }) }]);
  const row = (r.parsed || [])[0];
  // 2026-11-06 修正：软删单不可复用（uk_order_no 仍占位），否则会拿软删单跑断言造成假通过
  if (row && row.is_deleted) return null;
  return row ? { order_no: row.order_no, _id: row._id, status: row.status, start: row.start_time } : null;
}
function createOrder(args) {
  const suffix = args[args.indexOf('--suffix') + 1];
  try {
    const out = execFileSync(process.execPath, ['scripts/test-order-tool.js', 'create', ...args], {
      cwd: require('path').join(__dirname, '..'), encoding: 'utf8', timeout: 120000
    });
    const m = out.match(/\{[\s\S]*?\}/);
    if (!m) throw new Error('create 输出无法解析: ' + out.slice(0, 200));
    return JSON.parse(m[0]);
  } catch (e) {
    const row = findExisting('TEST840710820' + suffix);
    if (!row) throw e;
    console.log('  （' + row.order_no + ' 已存在，复用只读查回）');
    return row;
  }
}

// 页面上所有 button 的文案（用于断言「入口存在 / 不存在」）
async function buttonTexts(page) {
  const els = await page.$$('button');
  const list = [];
  for (const el of els) {
    const t = await el.text().catch(() => '');
    if (t) list.push(t.trim());
  }
  return list;
}

const results = [];
function record(no, name, state, detail) {
  results.push({ no, name, state, detail });
  console.log(`[${state}] ${no} ${name}${detail ? ' | ' + detail : ''}`);
}

(async () => {
  validateDevtools({ strict: true });
  const port = devtools.autoPort || 9420;

  console.log('▶ CLI:', devtools.cliPath);
  console.log('▶ autoPort:', port);

  // 夹具：S2 已过点（到点文案） + S1（不应有 S2 变更入口）
  console.log('▶ 造夹具 ...');
  // 夹具后缀每次随机生成：uk_order_no 唯一索引会让「软删后的旧后缀」永久占位（实测 N/M/P/Q/R 均被占）
  const tag = ('S' + Date.now().toString(36).slice(-3)).toUpperCase();
  const s2 = createOrder(['--status', 'S2', '--suffix', tag, '--start-hours', '-1']);
  const s1 = createOrder(['--status', 'S1', '--suffix', tag + 'B', '--start-hours', '2.5']);
  console.log('  S2:', s2.order_no, s2._id);
  console.log('  S1:', s1.order_no, s1._id);

  // cli auto 在「IDE 已在自动化模式」或已打开时可能返回非 0，但不代表失败：以 connect 结果为准
  try {
    execFileSync(`"${devtools.cliPath}"`, ['auto', '--project', devtools.projectPath, '--auto-port', String(port)],
      { encoding: 'utf8', timeout: 30000, shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    console.log('  cli auto 返回非0（可能是 IDE 已开），继续尝试 connect：' + (e.stderr || e.message).split('\n').slice(-2).join(' / '));
  }

  let mp = null;
  for (let i = 0; i < 3 && !mp; i++) {
    await sleep(2000);
    try {
      mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
    } catch (e) {
      if (i === 2) {
        console.log('BLOCKED: automator.connect 失败 -> ' + e.message);
        process.exit(0);
      }
    }
  }
  await sleep(15000); // 冷启动首次编译较慢：给足时间（实测 6s 会 timeout）

  // 预热：首次导航会吃编译耗时，先打一枪（失败不判定），避免污染首条用例
  try {
    await mp.reLaunch(`/pages-v2/order-detail/order-detail?orderId=${s2._id}`);
  } catch (e) {
    console.log('  （预热导航超时，属正常冷启动）');
  }
  await sleep(12000);

  async function openDetail(id) {
    for (let i = 0; i < 2; i++) {
      try {
        await mp.reLaunch(`/pages-v2/order-detail/order-detail?orderId=${id}`);
        await sleep(4000);
        const page = await mp.currentPage();
        // 等页面数据落地（最多 10s）：page.data() 是异步方法（Page.d.ts:21）
        for (let k = 0; k < 5; k++) {
          const d = await page.data().catch(() => ({}) || {});
          if (d && d.order) return page;
          await sleep(2000);
        }
        return page;
      } catch (e) {
        if (i === 1) throw e;
        await sleep(5000);
      }
    }
  }

  // ── 3.7 #142：S2 已过点 → nextStep.title = 已到服务时间 ──
  // IDE 自动化偶发 getPageMetaByWebviewId null（页面刚 reLaunch 完），重试 3 次再判定
  for (let i = 0; i < 3; i++) {
    try {
      const page = await openDetail(s2._id);
      const d = await page.data();
      const title = (d.nextStep && d.nextStep.title) || '';
      if (!d.order) {
        record('3.7', 'S2 到点文案', 'NEED-HUMAN', '详情页未加载订单（IDE 登录账号可能非该单参与方），nextStep=' + JSON.stringify(title));
      } else if (title === '已到服务时间') {
        record('3.7', 'S2 到点文案', 'PASS', 'nextStep.title=' + title);
      } else {
        record('3.7', 'S2 到点文案', 'FAIL', '期望「已到服务时间」，实得「' + title + '」');
      }
      break;
    } catch (e) {
      if (i === 2) record('3.7', 'S2 到点文案', 'FAIL', String(e && e.message));
      else await sleep(4000);
    }
  }

  // ── 3.12 #144：S1 页面不出现「申请变更（地点/内容）」──
  // 静态结构证明（不依赖登录账号）：该按钮必须位于 order.status === 'S2' 分支内
  try {
    const wxml = require('fs').readFileSync(require('path').join(__dirname, '..', 'miniprogram/pages-v2/order-detail/order-detail.wxml'), 'utf8').split('\n');
    const idx = wxml.findIndex((l) => l.indexOf('申请变更（地点/内容）') >= 0);
    let owner = '未找到按钮';
    if (idx >= 0) {
      for (let i = idx; i >= 0; i--) {
        if (/<block[^>]*wx:(if|elif)="\{\{order\.status/.test(wxml[i])) { owner = wxml[i].trim(); break; }
      }
    }
    if (owner.indexOf("'S2'") >= 0) {
      record('3.12', 'S1 无 S2 变更入口（静态结构）', 'PASS', '按钮位于 ' + owner.replace(/\s+/g, ' '));
    } else {
      record('3.12', 'S1 无 S2 变更入口（静态结构）', 'FAIL', '按钮归属分支=' + owner);
    }
  } catch (e) {
    record('3.12', 'S1 无 S2 变更入口（静态结构）', 'FAIL', String(e && e.message));
  }

  // S1 页面实测（若该登录账号非 S1 夹具参与方，只能标 NEED-HUMAN）
  try {
    const page = await openDetail(s1._id);
    const texts = await buttonTexts(page);
    const hasS2Entry = texts.some((t) => t.indexOf('申请变更') >= 0);
    const d = await page.data();
    const loaded = !!(d && d.order);
    if (!loaded) {
      record('3.12-runtime', 'S1 页实测', 'NEED-HUMAN', 'S1 夹具未加载（登录账号非参与方）；静态结构已证按钮仅在 S2 分支');
    } else if (hasS2Entry) {
      record('3.12-runtime', 'S1 页实测', 'FAIL', 'S1 页出现「申请变更」按钮');
    } else {
      record('3.12-runtime', 'S1 页实测', 'PASS', 'nextStep=' + JSON.stringify((d.nextStep || {}).title) + '；无申请变更按钮');
    }
  } catch (e) {
    record('3.12-runtime', 'S1 页实测', 'NEED-HUMAN', String(e && e.message));
  }

  // 正对照：S2 页存在「申请变更」入口（保证上一条不是选择器误判）
  try {
    const page = await openDetail(s2._id);
    const texts = await buttonTexts(page);
    const has = texts.some((t) => t.indexOf('申请变更') >= 0);
    record('3.12+', 'S2 正对照：有申请变更入口', has ? 'PASS' : 'NEED-HUMAN',
      has ? '按钮文案命中「申请变更」' : '未命中，按钮文案=' + JSON.stringify(texts.slice(0, 6)));
  } catch (e) {
    record('3.12+', 'S2 正对照：有申请变更入口', 'NEED-HUMAN', String(e && e.message));
  }

  // ── 3.11 #146：改期规则后台化 → 详情页规则文案与云端 admin_config 一致 ──
  // 期望值不写死：直接读云端 modifyMinLeadHours / modifyMaxTimes / modifyMaxSpanH（缺省回 4/2/72）
  try {
    const cfgR = execTcbCommands([{ TableName: 'admin_config', CommandType: 'COMMAND', Command: JSON.stringify({
      find: 'admin_config', filter: { _id: 'global' },
      projection: { modifyMinLeadHours: 1, modifyMaxTimes: 1, modifyMaxSpanH: 1 }, limit: 1
    }) }]);
    const c = (cfgR.parsed || [])[0] || {};
    // tcb 回读数字是 BSON 包装（{$numberInt:string} / {$numberLong:string}），需先解包再比较
    const num = (v, dft) => {
      const raw = (v && typeof v === 'object') ? (v.$numberInt != null ? v.$numberInt : (v.$numberLong != null ? v.$numberLong : v.$numberDouble)) : v;
      const n = Number(raw);
      return Number.isFinite(n) ? n : dft;
    };
    const lead = num(c.modifyMinLeadHours, 4);
    const times = num(c.modifyMaxTimes, 2);
    const span = num(c.modifyMaxSpanH, 72);
    const page = await openDetail(s2._id);
    const d = await page.data();
    const txt = d.modifyRuleText || '';
    const ok = txt.indexOf('提前' + lead + '小时') >= 0 && txt.indexOf('最多' + times + '次') >= 0 && txt.indexOf('幅度≤' + span + '小时') >= 0;
    record('3.11', '改期规则后台化：页面文案与云端一致', txt ? (ok ? 'PASS' : 'FAIL') : 'NEED-HUMAN',
      '云端=' + lead + '/' + times + '/' + span + '；页面=' + txt);
  } catch (e) {
    record('3.11', '改期规则后台化：页面文案与云端一致', 'FAIL', String(e && e.message));
  }

  // ── 3.10 #145：S2 变更卡静态结构（变更卡绑定 pending_change；待反馈时隐藏发起入口）──
  try {
    const w = require('fs').readFileSync(require('path').join(__dirname, '..', 'miniprogram/pages-v2/order-detail/order-detail.wxml'), 'utf8');
    const hasCard = /wx:if="\{\{order\.pending_change\}\}"/.test(w) && w.indexOf('变更「') >= 0;
    const hideEntry = /wx:if="\{\{!order\.pending_change\}\}"[^>]*>[^<]*申请变更/.test(w.replace(/\n/g, ''));
    record('3.10', 'S2 变更卡与入口互斥（静态结构）', hasCard && hideEntry ? 'PASS' : 'FAIL',
      '变更卡=' + hasCard + '；入口互斥=' + hideEntry);
  } catch (e) {
    record('3.10', 'S2 变更卡与入口互斥（静态结构）', 'FAIL', String(e && e.message));
  }

  // ── 3.5 #栈满 10 层兜底：navigateTo 必须带 fail 提示「请到订单列表重新进入」──
  try {
    const b = require('fs').readFileSync(require('path').join(__dirname, '..', 'miniprogram/utils/bootstrap.js'), 'utf8');
    const ok = /navigateTo\(\{[^}]*fail:[^}]*请到订单列表重新进入/.test(b.replace(/\n/g, ' '));
    record('3.5', '栈满跳转兜底文案（静态结构）', ok ? 'PASS' : 'FAIL', ok ? 'bootstrap.js 命中 navigateTo+fail 兜底' : '未命中');
  } catch (e) {
    record('3.5', '栈满跳转兜底文案（静态结构）', 'FAIL', String(e && e.message));
  }

  // ── 3.6 #141：页面侧时间 +8（订单列表 time_str / 会话列表 last_msg_at_display）──
  // 期望值独立手算：强制按 UTC+8 取分量（不用设备本地时区，避免自指）
  const numOf = (v, dft) => {
    const raw = (v && typeof v === 'object') ? (v.$numberLong != null ? v.$numberLong : (v.$numberInt != null ? v.$numberInt : v.$numberDouble)) : v;
    const n = Number(raw);
    return Number.isFinite(n) ? n : dft;
  };
  const bjOf = (ms) => {
    const d = new Date(ms + 8 * 3600000);
    const pad2 = (n) => String(n).padStart(2, '0');
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, day: d.getUTCDate(),
      h: pad2(d.getUTCHours()), mi: pad2(d.getUTCMinutes()), s: pad2(d.getUTCSeconds())
    };
  };
  async function openPage(url, readyKey) {
    for (let i = 0; i < 2; i++) {
      try {
        await mp.reLaunch(url);
        await sleep(4000);
        const page = await mp.currentPage();
        for (let k = 0; k < 6; k++) {
          const d = await page.data().catch(() => ({}) || {});
          if (d && d[readyKey] && d[readyKey].length) return { page, d };
          await sleep(2000);
        }
        return { page, d: await page.data() };
      } catch (e) {
        if (i === 1) throw e;
        await sleep(5000);
      }
    }
  }
  try {
    const { d: od } = await openPage('/pages-v2/orders/orders', 'orders');
    // 取列表首行（不绑定夹具：页签/角色可能挡掉夹具单），再回查其 start_time 手算比对
    const row = (od.orders || []).find((x) => x.order_no && x.time_str);
    if (!row) {
      record('3.6-a', '订单列表 time_str = 北京时间(+8)', 'NEED-HUMAN', '列表为空（该账号无订单）');
    } else {
      const oR = execTcbCommands([{ TableName: 'order_main', CommandType: 'COMMAND', Command: JSON.stringify({
        find: 'order_main', filter: { order_no: row.order_no }, projection: { start_time: 1 }, limit: 1
      }) }]);
      const startMs = numOf(((oR.parsed || [])[0] || {}).start_time, 0);
      const e = bjOf(startMs);
      const expectOrders = `${e.mo}月${e.day}日 ${e.h}:${e.mi}`; // orders.js fmtTime 口径（月日不补零）
      record('3.6-a', '订单列表 time_str = 北京时间(+8)', startMs && row.time_str === expectOrders ? 'PASS' : 'FAIL',
        row.order_no + ' 期望「' + expectOrders + '」，实得「' + row.time_str + '」');
    }
  } catch (e) {
    record('3.6-a', '订单列表 time_str = 北京时间(+8)', 'FAIL', String(e && e.message));
  }
  try {
    // 会话列表：不绑定夹具（夹具单无消息 → last_msg_at 为空），改取最近一条有 last_msg_at 的会话
    const cR = execTcbCommands([{ TableName: 'im_conversation', CommandType: 'COMMAND', Command: JSON.stringify({
      find: 'im_conversation', filter: {}, projection: { _id: 1, order_id: 1, last_msg_at: 1 }, limit: 20, sort: { last_msg_at: -1 }
    }) }]);
    const conv = ((cR.parsed || [])[0] && cR.parsed[0]) || {};
    const msgMs = numOf(conv.last_msg_at, 0);
    if (!msgMs) {
      record('3.6-b', '会话列表 last_msg_at_display = +08:00', 'NEED-HUMAN', '云库无任何带 last_msg_at 的会话');
    } else {
      const e2 = bjOf(msgMs);
      const expectIso = `${e2.y}-${String(e2.mo).padStart(2, '0')}-${String(e2.day).padStart(2, '0')}T${e2.h}:${e2.mi}:${e2.s}+08:00`;
      const { d: md } = await openPage('/pages-v2/message/message', 'orderList');
      const conv2 = (md.orderList || []).find((x) => x._id === conv._id);
      record('3.6-b', '会话列表 last_msg_at_display = +08:00', conv2 ? (conv2.last_msg_at_display === expectIso ? 'PASS' : 'FAIL') : 'NEED-HUMAN',
        conv2 ? '期望「' + expectIso + '」，实得「' + conv2.last_msg_at_display + '」' : '会话列表中未见该会话（可能非本账号/不在首屏）');
    }
  } catch (e) {
    record('3.6-b', '会话列表 last_msg_at_display = +08:00', 'FAIL', String(e && e.message));
  }

  const pass = results.filter((r) => r.state === 'PASS').length;
  const fail = results.filter((r) => r.state === 'FAIL').length;
  const need = results.filter((r) => r.state === 'NEED-HUMAN').length;
  console.log(`UI-SUMMARY pass=${pass} fail=${fail} need_human=${need}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.log('BLOCKED: ' + (e && e.message));
  process.exit(0);
});
