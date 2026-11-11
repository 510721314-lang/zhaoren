<template>
  <div class="page">
    <el-alert type="info" :closable="false" show-icon
      title="理由文案配置（加时 / 改期）"
      description="仅可修改显示文案（2-10 字），不可增删选项、不可改 key。保存后小程序端在用户下次冷启动生效（本地缓存最长 7 天）。" />

    <el-card v-for="g in groups" :key="g.kind" class="box">
      <template #header>{{ g.title }}</template>
      <el-table :data="g.rows" size="small" border>
        <el-table-column label="key（只读）" prop="k" width="180" />
        <el-table-column label="显示文案">
          <template #default="{ row }">
            <el-input v-model="row.t" maxlength="10" show-word-limit :placeholder="'默认：' + row.def" />
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
// ReasonTypes.vue · 理由文案配置页(2026-11-11)
// 数据链: config_get.reason_labels 回读 → 行内编辑 → config_set(reason_labels_extend/modify) 复用既有留痕(config_history + platform_event)
// 护栏(服务端同款): key 白名单锁死; 文案 2-10 字; 空文案 = 恢复默认(不下发该项)
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';

// 内置默认(与 order-action REASON_TYPES / config_public 兜底同源)
const DEFAULTS = {
  extend: [
    { k: 'time_conflict', t: '时间冲突' },
    { k: 'content_adjust', t: '内容调整' },
    { k: 'other', t: '其他' }
  ],
  modify: [
    { k: 'time_conflict', t: '时间冲突' },
    { k: 'other', t: '其他' }
  ]
};

const groups = reactive([
  { kind: 'extend', title: '加时申请理由（S3 履约中）', rows: [] },
  { kind: 'modify', title: '改期申请理由（S2 已支付待履约）', rows: [] }
]);
const saving = ref(false);
const reason = ref('');

function fillRows(kind, saved) {
  const g = groups.find((x) => x.kind === kind);
  const savedMap = {};
  (saved || []).forEach((it) => { if (it && it.k) savedMap[it.k] = it.t; });
  g.rows = DEFAULTS[kind].map((d) => reactive({ k: d.k, def: d.t, t: savedMap[d.k] || d.t }));
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
  // 组装: 文案为空或与默认相同 → 恢复默认值下发(服务端要求非空且 2-10 字)
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
  const r = await call('config_set', Object.assign({ reason: reason.value || '理由文案配置' }, payload));
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
.bar { margin-top: 16px; display: flex; gap: 12px; align-items: center; }
</style>
