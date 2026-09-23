// views/Export.vue · 数据导出(export_collection 分页脱敏导出 + export_admin_config 配置快照)
// 所有导出均经后端白名单校验并自动脱敏(手机号/证件号/openid/密钥等敏感字段已打码)。
<template>
  <div>
    <h3 style="margin:0 0 16px">数据导出</h3>
    <el-alert type="info" :closable="false" style="margin-bottom:16px">
      所有导出均经后端白名单校验并自动脱敏（手机号/证件号/openid/密钥等敏感字段已打码），仅限运营排查使用。单次最多导出 10000 条，超出会截断提示。
    </el-alert>

    <el-tabs v-model="tab">
      <!-- ── Tab 1: 集合分页导出 ── -->
      <el-tab-pane label="集合数据" name="coll">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <el-select v-model="collection" placeholder="选择集合" style="width:230px" @change="onCollChange">
            <el-option v-for="c in COLLECTIONS" :key="c" :label="c" :value="c" />
          </el-select>
          <el-button type="primary" :loading="loading" @click="load">查询</el-button>
          <el-button :disabled="!list.length" @click="downloadCurrent">下载当前页 JSON</el-button>
          <el-tag v-if="total" type="info" size="small">共 {{ total }} 条<template v-if="truncated">（已截断 &gt;10000）</template></el-tag>
        </div>

        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column prop="_id" label="_id" width="230">
            <template #default="{row}"><code style="font-size:11px">{{ row._id }}</code></template>
          </el-table-column>
          <el-table-column label="字段" min-width="220">
            <template #default="{row}">
              <el-tag v-for="k in visibleKeys(row)" :key="k" size="small" style="margin:1px 3px 1px 0">{{ k }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="内容摘要" min-width="360" show-overflow-tooltip>
            <template #default="{row}"><code style="font-size:11px;word-break:break-all">{{ summary(row) }}</code></template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !list.length" description="暂无数据" :image-size="80" />

        <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
          v-model:current-page="page" v-model:page-size="pageSize"
          :total="total" :page-sizes="[10,50,100]" layout="total, sizes, prev, pager, next"
          @size-change="load" @current-change="load" />
      </el-tab-pane>

      <!-- ── Tab 2: 配置快照 ── -->
      <el-tab-pane label="配置快照" name="cfg">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <el-button type="primary" :loading="cfgLoading" @click="loadConfig">获取 admin_config 完整快照</el-button>
          <el-button v-if="cfgText" @click="downloadConfig">下载 JSON</el-button>
          <el-tag type="warning" size="small">密钥类字段仅显示是否存在，不返回明文</el-tag>
        </div>
        <el-alert v-if="cfgError" type="error" :closable="false" style="margin-bottom:12px">{{ cfgError }}</el-alert>
        <pre v-if="cfgText" class="cfg-pre">{{ cfgText }}</pre>
        <el-empty v-if="!cfgLoading && !cfgText && !cfgError" description="点击按钮获取配置快照" :image-size="80" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';

// 与 admin-action EXPORT_COLLECTIONS 白名单保持一致
const COLLECTIONS = [
  'admin_config', 'admin_web_sessions',
  'user_account', 'partner_profile',
  'demand', 'demand_draft',
  'order_main', 'order_status_log', 'order_confirmations',
  'emergency_contact', 'credit_score_log', 'platform_event', 'audit_log',
  'system_notice', 'disclaimer_signature', 'evaluation',
  'blog_post', 'blog_like', 'blog_comment',
  'safety_report',
  'im_conversation', 'im_message',
  'user_profile', 'partner_exam', 'partner_apply',
  'dispute', 'withdraw_request', 'credit_log',
  'insurance_record', 'report', 'sms_log', 'device_bind'
];

const tab = ref('coll');
const collection = ref(COLLECTIONS[0]);
const list = ref([]); const total = ref(0); const page = ref(1); const pageSize = ref(50);
const loading = ref(false); const truncated = ref(false);
const cfgText = ref(''); const cfgLoading = ref(false); const cfgError = ref('');

function visibleKeys(row) {
  return Object.keys(row).filter((k) => k !== '_id').slice(0, 6);
}
function summary(row) {
  const s = JSON.stringify(row);
  return s.length > 240 ? s.slice(0, 240) + '…' : s;
}
function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function onCollChange() {
  page.value = 1;
  load();
}

async function load() {
  loading.value = true;
  const r = await call('export_collection', { collection: collection.value, page: page.value, page_size: pageSize.value });
  loading.value = false;
  if (r.ok && r.data) {
    list.value = r.data.list || [];
    total.value = r.data.total || 0;
    truncated.value = !!r.data.truncated;
    // 越界回退: 当前页无数据但总数>0 → 回到末页
    if (r.data.total > 0 && list.value.length === 0 && page.value > 1) {
      page.value = Math.max(1, Math.ceil(r.data.total / pageSize.value));
      return load();
    }
  } else {
    list.value = []; total.value = 0;
    ElMessage.error(r.msg || r.code || '查询失败');
  }
}

function downloadCurrent() {
  download(`export_${collection.value}_p${page.value}.json`, JSON.stringify(list.value, null, 2));
}

async function loadConfig() {
  cfgLoading.value = true; cfgError.value = '';
  const r = await call('export_admin_config');
  cfgLoading.value = false;
  if (r.ok && r.data) {
    cfgText.value = JSON.stringify(r.data, null, 2);
  } else {
    cfgError.value = r.msg || r.code || '获取失败';
  }
}
function downloadConfig() {
  download(`admin_config_${Date.now()}.json`, cfgText.value);
}

onMounted(load);
</script>

<style scoped>
.cfg-pre {
  background:#f6f8fa;border:1px solid #ebeef5;border-radius:8px;
  padding:14px;font-size:12px;line-height:1.6;
  max-height:520px;overflow:auto;word-break:break-all;white-space:pre-wrap;
}
</style>
