<template>
  <div class="page">
    <el-alert type="info" :closable="false" show-icon
      title="理由配置（加时 / 改期 / 爽约）"
      description="加时/改期：自由输入新增理由（2-10 字，服务端提交时以文字原样归类）、行内改文案、删除（至少保留 1 项）。爽约：自由文案（2-20 字，提交时原文入库，至少保留 1 项）。保存后小程序端在用户下次冷启动生效（本地缓存最长 7 天；爽约需下一体验版起的客户端支持）。" />

    <el-card v-for="g in groups" :key="g.kind" class="box">
      <template #header>
        <div class="card-head">
          <span>{{ g.title }}</span>
          <div style="display:flex;gap:8px">
            <el-input v-model="g.input" placeholder="新理由（2-10 字）" size="small" style="width: 180px" maxlength="10" @keyup.enter="addRow(g)" />
            <el-button size="small" @click="addRow(g)">添加</el-button>
          </div>
        </div>
      </template>
      <el-table :data="g.rows" size="small" border>
        <el-table-column label="key（只读）" prop="k" width="180" />
        <el-table-column label="显示文案">
          <template #default="{ row }">
            <el-input v-model="row.t" maxlength="10" show-word-limit :placeholder="'默认：' + row.def" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ $index }">
            <el-button size="small" type="danger" plain :disabled="g.rows.length <= 1" @click="g.rows.splice($index, 1)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card class="box">
      <template #header>
        <div class="card-head">
          <span>爽约申诉理由（S2/S3.5 报告爽约）</span>
          <div style="display:flex;gap:8px">
            <el-input v-model="nsPick" placeholder="新理由（2-20 字）" size="small" style="width: 180px" maxlength="20" @keyup.enter="addNsRow" />
            <el-button size="small" @click="addNsRow">添加</el-button>
          </div>
        </div>
      </template>
      <el-table :data="nsRows" size="small" border>
        <el-table-column label="显示文案（提交时原文入库）">
          <template #default="{ row }">
            <el-input v-model="row.s" maxlength="20" show-word-limit placeholder="2-20 字" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ $index }">
            <el-button size="small" type="danger" plain :disabled="nsRows.length <= 1" @click="nsRows.splice($index, 1)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <div class="bar">
      <el-input v-model="reason" placeholder="变更原因（选填，≤100 字）" maxlength="100" style="width: 320px" />
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      <el-button @click="load">重置</el-button>
    </div>
  </div>
</template>

<script setup>
// ReasonTypes.vue · 理由配置页(2026-11-11, 方案A 双专家评审通过: 加时/改期添加改自由输入 {k:文案,t:文案}; 同日增爽约通道)
// 数据链: config_get.reason_labels 回读 → 行增删/文案编辑 → config_set(reason_labels_extend/modify/reason_labels_noshow) 复用既有留痕(config_history + platform_event)
// 护栏(服务端同款): 白名单 key 项仍可编辑文案; 自由项 k===t(2-10 字, 服务端 k!==t 且非白名单会拒); 至少 1 项(服务端拒空数组, UI 侧删除按钮同步禁用)
// 评审整改(#1): fillRows 以「云端已存数组」为准生成行(保留顺序/支持子集), 不再按 DEFAULTS 硬编码 —— 否则云端已存的 location_change 会被静默丢弃
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';

// 全集白名单(与 admin-action REASON_LABEL_KEYS / order-action REASON_TYPES 同源): extend 4 项 / modify 3 项
const ALL = {
  extend: [
    { k: 'time_conflict', t: '时间冲突' },
    { k: 'location_change', t: '地点变动' },
    { k: 'content_adjust', t: '内容调整' },
    { k: 'other', t: '其他' }
  ],
  modify: [
    { k: 'time_conflict', t: '时间冲突' },
    { k: 'location_change', t: '地点变动' },
    { k: 'other', t: '其他' }
  ]
};
// 未配置时的初始展示 = 默认下发列表(不含「地点变动」, 与 config_public 兜底一致)
const DEFAULTS = {
  extend: ALL.extend.filter((x) => x.k !== 'location_change'),
  modify: ALL.modify.filter((x) => x.k !== 'location_change')
};

const groups = reactive([
  { kind: 'extend', title: '加时申请理由（S3 履约中）', rows: [], input: '' },
  { kind: 'modify', title: '改期申请理由（S2 已支付待履约）', rows: [], input: '' }
]);
// 爽约通道(2026-11-11): 中文字符串数组(服务端 reason_type 原文入库, 无 {k,t}), 编辑器与 extend/modify 分离
const NS_DEFAULT = ['未出现', '迟到超30分钟', '中途离开', '其他'];
const nsRows = ref([]);
const nsPick = ref('');
const saving = ref(false);
const reason = ref('');

// 行来源: 云端已存数组优先(原样, 含子集/顺序), 未配置时用默认列表; def 取全集默认文案
function fillRows(kind, saved) {
  const g = groups.find((x) => x.kind === kind);
  const savedList = Array.isArray(saved) ? saved.filter((x) => x && x.k) : [];
  const src = savedList.length ? savedList : DEFAULTS[kind];
  g.rows = src.map((it) => {
    const defIt = ALL[kind].find((d) => d.k === it.k) || {};
    return reactive({ k: it.k, def: defIt.t || it.t, t: it.t || defIt.t || '' });
  });
}

// 自由输入添加(方案A): {k:文案, t:文案}, 服务端白名单 key 或 k===t 2-10 字均放行; 2-10 字 + 与现有行不重复
function addRow(g) {
  const t = String(g.input || '').trim();
  if (!t) return;
  if (t.length < 2 || t.length > 10) { ElMessage.warning('理由须为 2-10 字'); return; }
  if (g.rows.some((r) => r.k === t || r.t === t)) { ElMessage.warning('理由已存在'); return; }
  g.rows.push(reactive({ k: t, def: ALL[g.kind].find((d) => d.t === t)?.t || t, t }));
  g.input = '';
}

// 爽约行来源: 云端已存数组优先, 未配置才用默认(模式 D 铁律 1: 防止云端已存项被静默丢弃)
function fillNsRows(saved) {
  const savedList = Array.isArray(saved) ? saved.filter((x) => typeof x === 'string' && x) : [];
  const src = savedList.length ? savedList : NS_DEFAULT;
  nsRows.value = src.map((s) => ({ s: String(s) }));
}

function addNsRow() {
  const s = String(nsPick.value || '').trim();
  if (!s) return;
  if (s.length < 2 || s.length > 20) { ElMessage.warning('爽约理由须为 2-20 字'); return; }
  if (nsRows.value.some((r) => r.s === s)) { ElMessage.warning('爽约理由已存在'); return; }
  nsRows.value.push({ s });
  nsPick.value = '';
}

async function load() {
  const r = await call('config_get');
  if (!r.ok) { ElMessage.error(r.msg || r.code || '配置加载失败'); return; }
  const rl = (r.data && r.data.reason_labels) || {};
  fillRows('extend', rl.extend);
  fillRows('modify', rl.modify);
  fillNsRows(rl.noshow);
  reason.value = '';
}

async function save() {
  // 组装: 文案为空 → 回退默认值下发(服务端要求非空且 2-10 字); 行列表即启用集合(增删结果)
  // 方案A(评审 B2#3): 自由项(非白名单 k)的文案改动后 k 同步=t(服务端仅放行白名单 key 或 k===t), 并做重复校验
  const payload = {};
  for (const g of groups) {
    const list = g.rows.map((r) => {
      const t = String(r.t || '').trim() || r.def || r.k;
      const isWhitelist = ALL[g.kind].some((d) => d.k === r.k);
      return { k: isWhitelist ? r.k : t, t };
    });
    if (new Set(list.map((x) => x.k)).size !== list.length) { ElMessage.error('理由存在重复项'); return; }
    payload[g.kind === 'extend' ? 'reason_labels_extend' : 'reason_labels_modify'] = list;
  }
  // 爽约: 自由文案 2-20 字(服务端同款校验), 至少 1 项、去重
  const nsList = nsRows.value.map((r) => String(r.s || '').trim()).filter(Boolean);
  if (!nsList.length) { ElMessage.error('爽约理由至少保留 1 项'); return; }
  if (nsList.some((s) => s.length < 2 || s.length > 20)) { ElMessage.error('爽约理由须为 2-20 字'); return; }
  if (new Set(nsList).size !== nsList.length) { ElMessage.error('爽约理由存在重复项'); return; }
  payload.reason_labels_noshow = nsList;
  try {
    await ElMessageBox.confirm(
      '保存后小程序端将在用户下次冷启动生效（缓存最长 7 天）。确定保存？',
      '二次确认', { type: 'warning' });
  } catch (e) { return; }
  saving.value = true;
  const r = await call('config_set', Object.assign({ reason: reason.value || '理由配置变更' }, payload));
  saving.value = false;
  if (r.ok) {
    ElMessage.success('已保存（下次冷启动生效）');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '保存失败');
  }
}

onMounted(load);
</script>

<style scoped>
.page { padding: 4px; }
.box { margin-top: 12px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.bar { margin-top: 16px; display: flex; gap: 12px; align-items: center; }
</style>
