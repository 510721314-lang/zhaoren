// views/ConfigLog.vue · 参数变更日志
// 数据来源: admin-action config_log_list(platform_event type=config_change 分页倒序)
// 每条展开可见逐字段 before → after; 字段标签取自 config_schema。
<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="margin:0">参数变更日志</h3>
      <el-button :loading="loading" @click="load(1)">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border stripe size="small" row-key="_id">
      <el-table-column type="expand">
        <template #default="{row}">
          <div class="cl-detail">
            <span v-if="!changes(row).length" class="cl-old">无字段级明细</span>
            <div v-for="c in changes(row)" :key="c.f" class="cl-line">
              <span class="cl-label">{{ c.label }}</span>
              <span class="cl-old">{{ c.before }}</span>
              <span class="cl-arrow">→</span>
              <span class="cl-new">{{ c.after }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{row}">{{ fmtTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作人" width="150">
        <template #default="{row}">
          <span class="cl-openid">…{{ String(row.openid).slice(-10) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="变更原因" min-width="200" show-overflow-tooltip>
        <template #default="{row}">
          <span v-if="row.reason">{{ row.reason }}</span>
          <el-tag v-else type="info" size="small">未填写</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="变更项" width="110">
        <template #default="{row}">
          <el-tag size="small">{{ changes(row).length }} 项</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:14px;text-align:right">
      <el-pagination
        background
        layout="prev, pager, next, total"
        :total="total"
        :page-size="size"
        :current-page="page"
        @current-change="load"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(15);
const loading = ref(false);
const schemaMap = ref({});

// 非 schema 字段的友好名(schema 外的写操作也会产生日志)
const EXTRA_LABELS = {
  block_words: '屏蔽词', city_enabled: '开通城市', scene_list: '场景配置',
  system_templates: 'IM 模板', admin_web_key: '后台密钥',
  legal_disclaimer_text: '通用免责声明', legal_service_agreement: '服务协议',
  legal_privacy_policy: '隐私政策', legal_scene_disclaimers: '场景免责声明',
  modify_config: '改期规则'
};
const SKIP_KEYS = ['updated_at'];

async function load(p = 1) {
  loading.value = true;
  const r = await call('config_log_list', { page: p });
  loading.value = false;
  if (r.ok && r.data) {
    list.value = r.data.list || [];
    total.value = r.data.total || 0;
    page.value = r.data.page || p;
    size.value = r.data.size || 15;
  } else {
    ElMessage.error(r.msg || '加载失败');
  }
}

async function loadSchema() {
  const r = await call('config_get');
  if (r.ok && r.data && Array.isArray(r.data.config_schema)) {
    const m = {};
    r.data.config_schema.forEach((s) => { m[s.f] = s; });
    schemaMap.value = m;
  }
}

function valueText(f, v) {
  const s = schemaMap.value[f];
  if (v === undefined || v === null) return '—';
  if (s) {
    if (s.t === 'bool') return v ? '开启' : '关闭';
    return v + (s.unit ? ' ' + s.unit : '');
  }
  if (Array.isArray(v)) return `[${v.length} 项]`;
  if (typeof v === 'object') return '[对象]';
  return String(v);
}

function changes(row) {
  const after = row.after || {};
  const out = [];
  Object.keys(after).forEach((f) => {
    if (SKIP_KEYS.indexOf(f) >= 0) return;
    const s = schemaMap.value[f];
    const label = (s && s.label) || EXTRA_LABELS[f] || f;
    out.push({
      f, label,
      before: valueText(f, (row.before || {})[f]),
      after: valueText(f, after[f])
    });
  });
  return out;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

onMounted(async () => {
  await loadSchema();
  await load(1);
});
</script>

<style scoped>
.cl-detail { padding:8px 16px; background:#fafafa; }
.cl-line { display:flex; align-items:center; gap:10px; padding:3px 0; font-size:13px; }
.cl-label { width:180px; color:#606266; }
.cl-old { color:#909399; min-width:90px; }
.cl-arrow { color:#c0c4cc; }
.cl-new { color:#67c23a; font-weight:600; }
.cl-openid { font-family:monospace; font-size:12px; color:#606266; }
</style>
