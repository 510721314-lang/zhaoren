<template>
  <div class="page">
    <el-alert type="info" :closable="false" show-icon
      title="理由配置（加时 / 改期）"
      description="可增加、删除选项（限平台白名单 key，不可自造），可修改显示文案（2-10 字，至少保留 1 项）。保存后小程序端在用户下次冷启动生效（v1.6.115+ 客户端可见，本地缓存最长 7 天）。" />

    <el-card v-for="g in groups" :key="g.kind" class="box">
      <template #header>
        <div class="card-head">
          <span>{{ g.title }}</span>
          <el-select v-model="g.pick" placeholder="＋ 添加理由" size="small" style="width: 180px" @change="(k) => addRow(g, k)">
            <el-option v-for="o in available(g)" :key="o.k" :label="o.t + '（' + o.k + '）'" :value="o.k" />
          </el-select>
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

    <div class="bar">
      <el-input v-model="reason" placeholder="变更原因（选填，≤100 字）" maxlength="100" style="width: 320px" />
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      <el-button @click="load">重置</el-button>
    </div>
  </div>
</template>

<script setup>
// ReasonTypes.vue · 理由配置页(2026-11-11, 评审修订: 文案可改 + 选项可增删)
// 数据链: config_get.reason_labels 回读 → 行增删/文案编辑 → config_set(reason_labels_extend/modify) 复用既有留痕(config_history + platform_event)
// 护栏(服务端同款): key 限内置白名单(不可自造); 文案 2-10 字; 至少 1 项(服务端拒空数组, UI 侧删除按钮同步禁用)
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
  { kind: 'extend', title: '加时申请理由（S3 履约中）', rows: [], pick: '' },
  { kind: 'modify', title: '改期申请理由（S2 已支付待履约）', rows: [], pick: '' }
]);
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

function available(g) {
  return ALL[g.kind].filter((o) => !g.rows.some((r) => r.k === o.k));
}

function addRow(g, k) {
  if (!k) return;
  const defIt = ALL[g.kind].find((d) => d.k === k);
  if (defIt && !g.rows.some((r) => r.k === k)) g.rows.push(reactive({ k, def: defIt.t, t: defIt.t }));
  g.pick = '';
}

async function load() {
  const r = await call('config_get');
  if (!r.ok) { ElMessage.error(r.msg || r.code || '配置加载失败'); return; }
  const rl = (r.data && r.data.reason_labels) || {};
  fillRows('extend', rl.extend);
  fillRows('modify', rl.modify);
  reason.value = '';
}

async function save() {
  // 组装: 文案为空 → 回退默认值下发(服务端要求非空且 2-10 字); 行列表即启用集合(增删结果)
  const payload = {};
  for (const g of groups) {
    payload[g.kind === 'extend' ? 'reason_labels_extend' : 'reason_labels_modify'] =
      g.rows.map((r) => ({ k: r.k, t: String(r.t || '').trim() || r.def }));
  }
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
