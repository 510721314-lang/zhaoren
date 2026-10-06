// bp-charts.js - 商业计划书配图生成: 从 20261005 云端 DB 备份生成真实数据 SVG 图表
// 用法: node scripts/bp-charts.js
// 输出: docs/bp-assets/*.svg
const fs = require('fs');
const path = require('path');

const BAK = 'C:/zhaoren-bak/zhaoren_backup_20261005-2204/db';
const OUT = path.join(__dirname, '..', 'docs', 'bp-assets');
fs.mkdirSync(OUT, { recursive: true });

const GREEN = '#07C160', ORANGE = '#FF8F1F', GRAY = '#9AA0A6', DARK = '#1F2329', GRID = '#E5E7EB';
const FONT = 'Microsoft YaHei, PingFang SC, sans-serif';

function load(name) { return JSON.parse(fs.readFileSync(path.join(BAK, name + '.json'), 'utf8')); }

function svgHeader(w, h, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">` +
    `<rect width="${w}" height="${h}" fill="#FFFFFF"/>` +
    `<text x="${w / 2}" y="34" text-anchor="middle" font-size="20" font-weight="bold" fill="${DARK}">${title}</text>`;
}

// 横向条形图
function hbar(items, title, unit) {
  const W = 760, rowH = 46, top = 70, left = 190, H = top + items.length * rowH + 30;
  const max = Math.max(...items.map(i => i.v), 1);
  let s = svgHeader(W, H, title);
  items.forEach((it, i) => {
    const y = top + i * rowH, bw = Math.max(2, (it.v / max) * (W - left - 90));
    s += `<text x="${left - 12}" y="${y + 20}" text-anchor="end" font-size="15" fill="${DARK}">${it.k}</text>`;
    s += `<rect x="${left}" y="${y + 4}" width="${bw}" height="26" rx="4" fill="${it.c || GREEN}"/>`;
    s += `<text x="${left + bw + 10}" y="${y + 23}" font-size="15" font-weight="bold" fill="${DARK}">${it.v}${unit || ''}</text>`;
  });
  return s + `</svg>`;
}

// 双序列折线图(周)
function line2(series, title, labels) {
  const W = 760, H = 360, top = 70, left = 70, right = 90, bottom = 40;
  const pw = W - left - right, ph = H - top - bottom;
  const max = Math.max(...series.flatMap(se => se.data), 10);
  const nice = Math.ceil(max / 10) * 10;
  let s = svgHeader(W, H, title);
  for (let g = 0; g <= 4; g++) {
    const y = top + (ph * g) / 4, val = Math.round(nice * (1 - g / 4));
    s += `<line x1="${left}" y1="${y}" x2="${W - right}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    s += `<text x="${left - 10}" y="${y + 5}" text-anchor="end" font-size="12" fill="${GRAY}">${val}</text>`;
  }
  const colors = [GREEN, ORANGE];
  series.forEach((se, si) => {
    const pts = se.data.map((v, i) => {
      const x = left + (pw * i) / (se.data.length - 1), y = top + ph - (v / nice) * ph;
      return `${x},${y}`;
    });
    s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${colors[si]}" stroke-width="3" stroke-linejoin="round"/>`;
    se.data.forEach((v, i) => {
      const x = left + (pw * i) / (se.data.length - 1), y = top + ph - (v / nice) * ph;
      s += `<circle cx="${x}" cy="${y}" r="4" fill="${colors[si]}"/>`;
      s += `<text x="${x}" y="${y - 10}" text-anchor="middle" font-size="12" fill="${colors[si]}" font-weight="bold">${v}</text>`;
    });
    s += `<rect x="${left + si * 150}" y="18" width="14" height="4" fill="${colors[si]}"/>` +
      `<text x="${left + si * 150 + 20}" y="24" font-size="13" fill="${DARK}">${se.name}</text>`;
  });
  labels.forEach((lb, i) => {
    const x = left + (pw * i) / (labels.length - 1);
    s += `<text x="${x}" y="${H - 14}" text-anchor="middle" font-size="12" fill="${GRAY}">${lb}</text>`;
  });
  return s + `</svg>`;
}

function weekKey(ts) {
  const CN = 8 * 3600 * 1000, DAY = 24 * 3600 * 1000;
  const d = new Date(ts + CN);
  const dayUTC = Math.floor((ts + CN) / DAY);
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  return dayUTC - dow; // 该周周一的 UTC 天序
}
function weekLabel(monUtcDays) {
  const CN = 8 * 3600 * 1000, DAY = 24 * 3600 * 1000;
  const d = new Date(monUtcDays * DAY - CN);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ── 1. 需求场景分布 ──
const SCENE = { W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴', W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴' };
const demands = load('demand').list.filter(x => !x.is_deleted);
const dByScene = {};
demands.forEach(d => { dByScene[d.scene] = (dByScene[d.scene] || 0) + 1; });
fs.writeFileSync(path.join(OUT, 'scene-distribution.svg'),
  hbar(Object.keys(SCENE).map(k => ({ k: SCENE[k], v: dByScene[k] || 0 })).sort((a, b) => b.v - a.v),
    '需求发布分布（内测期累计，按场景）', ' 单'));

// ── 2. 订单状态分布 ──
const orders = load('order_main').list.filter(x => !x.is_deleted);
const STATUS = { 'S0': '待接单', 'S1': '四确认中', 'S2': '待支付', 'S3': '已支付待履约', 'S3.5': '履约准备', 'S6': '履约中', 'S5': '已完成待评价', 'S8': '已评价', 'S9': '评价超时结单', 'S10': '已关闭' };
const oByStatus = {};
orders.forEach(o => { oByStatus[o.status] = (oByStatus[o.status] || 0) + 1; });
const stItems = Object.keys(STATUS).filter(k => oByStatus[k]).map(k => ({ k: STATUS[k], v: oByStatus[k] }));
const doneFamily = ['S5', 'S8', 'S9', 'S10'].reduce((a, k) => a + (oByStatus[k] || 0), 0);
stItems.push({ k: '完成族小计', v: doneFamily, c: ORANGE });
fs.writeFileSync(path.join(OUT, 'order-status.svg'), hbar(stItems.sort((a, b) => b.v - a.v), '订单状态分布（内测期累计）', ' 单'));

// ── 3. 近8周需求/订单趋势 ──
const allTs = [...demands.map(d => d.created_at), ...orders.map(o => o.created_at)];
const maxTs = Math.max(...allTs), minTs = Math.min(...allTs);
const wMax = weekKey(maxTs), wMin = Math.max(weekKey(minTs), wMax - 7 * 7);
const weeks = []; for (let w = wMin; w <= wMax; w += 7) weeks.push(w);
const dCnt = new Array(weeks.length).fill(0), oCnt = new Array(weeks.length).fill(0);
demands.forEach(d => { const i = weeks.indexOf(weekKey(d.created_at)); if (i >= 0) dCnt[i]++; });
orders.forEach(o => { const i = weeks.indexOf(weekKey(o.created_at)); if (i >= 0) oCnt[i]++; });
fs.writeFileSync(path.join(OUT, 'weekly-trend.svg'),
  line2([{ name: '需求发布', data: dCnt }, { name: '订单创建', data: oCnt }],
    '内测期周度趋势：需求发布 vs 订单创建', weeks.map(weekLabel)));

// ── 4. 评价星级分布 ──
const evals = load('evaluation').list.filter(x => !x.is_deleted);
const starCnt = {}; evals.forEach(e => { const s = Math.round(e.star || 0); starCnt[s] = (starCnt[s] || 0) + 1; });
const avgStar = (evals.reduce((a, e) => a + (e.star || 0), 0) / (evals.length || 1)).toFixed(2);
fs.writeFileSync(path.join(OUT, 'star-distribution.svg'),
  hbar([5, 4, 3, 2, 1].map(s => ({ k: `${s} 星`, v: starCnt[s] || 0 })), `评价星级分布（均值 ${avgStar} / 5，n=${evals.length}）`, ' 条'));

// ── 5. 订单金额分布 ──
const buckets = [[0, 100, '100元以下'], [100, 200, '100-200元'], [200, 300, '200-300元'], [300, 420, '300-420元'], [420, 1e9, '420元以上']];
const bCnt = new Array(buckets.length).fill(0);
orders.filter(o => o.total_fen > 0).forEach(o => {
  const yuan = o.total_fen / 100;
  buckets.forEach((b, i) => { if (yuan >= b[0] && yuan < b[1]) bCnt[i]++; });
});
fs.writeFileSync(path.join(OUT, 'amount-distribution.svg'),
  hbar(buckets.map((b, i) => ({ k: b[2], v: bCnt[i] })), '订单金额分布（内测期累计）', ' 单'));

console.log('charts done →', OUT);
fs.readdirSync(OUT).forEach(f => console.log(' -', f, fs.statSync(path.join(OUT, f)).size, 'bytes'));
