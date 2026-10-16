// utils/constants.js 派生视图与常量表单测（技术债 P2-2 续作 · 2026-10-16）
// 核心价值：断言旧页兼容视图与 config/enums.js SSOT 不漂移；仅固化既有结构
const test = require('node:test');
const assert = require('node:assert');
const { ORDER_STATUS: SSOT } = require('../../miniprogram/config/enums.js');
const {
  ORDER_STATUS,
  SCENE_LIST,
  BLOG_TOPICS,
  AA_TIERS,
  SYSTEM_TEMPLATES,
  aaTierLabel
} = require('../../miniprogram/utils/constants.js');

test('派生 ORDER_STATUS 与 SSOT 键集合完全一致', () => {
  assert.deepStrictEqual(Object.keys(ORDER_STATUS).sort(), Object.keys(SSOT).sort());
});

test('派生视图每个状态的 code/name 与 SSOT 逐键一致（含 S2_5→code S2.5）', () => {
  for (const key of Object.keys(SSOT)) {
    assert.strictEqual(ORDER_STATUS[key].code, SSOT[key].code, `${key} code`);
    assert.strictEqual(ORDER_STATUS[key].name, SSOT[key].name, `${key} name`);
  }
  assert.strictEqual(ORDER_STATUS.S2_5.code, 'S2.5'); // 键名与 code 不同的关键例
});

test('6 类 colorTag 全部映射到五语义 class，无 muted 兜底漏网', () => {
  const expectColor = {
    'var(--func-warning)': 'warn',
    'var(--func-purple)': 'primary',
    'var(--func-info)': 'primary',
    'var(--func-danger)': 'danger',
    'var(--func-success)': 'success',
    'var(--text-4)': 'muted'
  };
  for (const key of Object.keys(SSOT)) {
    assert.strictEqual(ORDER_STATUS[key].color, expectColor[SSOT[key].colorTag], `${key} colorTag=${SSOT[key].colorTag}`);
  }
});

test('派生 color 取值只在五语义集合内（防 SSOT 新增未知色后静默 muted）', () => {
  const allowed = new Set(['warn', 'primary', 'danger', 'success', 'muted']);
  for (const key of Object.keys(ORDER_STATUS)) {
    assert.ok(allowed.has(ORDER_STATUS[key].color), `${key} color=${ORDER_STATUS[key].color}`);
  }
});

test('SCENE_LIST：5 场景、code/name/icon 非空、code 唯一', () => {
  assert.strictEqual(SCENE_LIST.length, 5);
  const codes = SCENE_LIST.map((s) => s.code);
  assert.strictEqual(new Set(codes).size, codes.length);
  for (const s of SCENE_LIST) {
    assert.ok(s.code && s.name && s.icon);
    assert.ok(Array.isArray(s.options) && s.options.length > 0);
  }
  assert.deepStrictEqual(codes, ['W1', 'W2', 'W8', 'W10', 'W11']);
});

test('AA_TIERS：4 档 value 唯一且标签非空', () => {
  assert.strictEqual(AA_TIERS.length, 4);
  const vals = AA_TIERS.map((t) => t.value);
  assert.strictEqual(new Set(vals).size, vals.length);
  assert.deepStrictEqual(vals, ['0-50', '50-200', '200+', 'custom']);
  AA_TIERS.forEach((t) => assert.ok(t.label.length > 0));
});

test('SYSTEM_TEMPLATES：t1-t8、id 唯一、文案非空', () => {
  assert.strictEqual(SYSTEM_TEMPLATES.length, 8);
  const ids = SYSTEM_TEMPLATES.map((t) => t.id);
  assert.strictEqual(new Set(ids).size, 8);
  assert.deepStrictEqual(ids, ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
  SYSTEM_TEMPLATES.forEach((t) => assert.ok(t.text.length > 0));
});

test('BLOG_TOPICS：7 话题 name 唯一（须与 blog-action 白名单一致）', () => {
  assert.strictEqual(BLOG_TOPICS.length, 7);
  const names = BLOG_TOPICS.map((t) => t.name);
  assert.strictEqual(new Set(names).size, names.length);
  BLOG_TOPICS.forEach((t) => assert.ok(t.icon));
});

test('aaTierLabel 三分支：命中/空值/未知值原样返回', () => {
  assert.strictEqual(aaTierLabel('0-50'), '0-50元');
  assert.strictEqual(aaTierLabel('custom'), '自定义');
  assert.strictEqual(aaTierLabel(''), '');
  assert.strictEqual(aaTierLabel(null), '');
  assert.strictEqual(aaTierLabel('历史中文文案'), '历史中文文案');
});
