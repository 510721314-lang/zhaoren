// views/NoShow.vue · 爽约申诉与裁定 (第三批 3B)
// 列表(状态筛选) + 详情(证据临时URL) + 裁定(成立/不成立; 成立预览"扣 N 分 / 第 M 次 / 满阈值停用")
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:600">爽约申诉</span>
      <el-radio-group v-model="statusFilter" size="small" @change="onFilter">
        <el-radio-button label="">全部 ({{ totalAll }})</el-radio-button>
        <el-radio-button label="received">待举证 ({{ counts.received }})</el-radio-button>
        <el-radio-button label="defense">举证中 ({{ counts.defense }})</el-radio-button>
        <el-radio-button label="decided">已裁定 ({{ counts.decided }})</el-radio-button>
        <el-radio-button label="withdrawn">已撤回 ({{ counts.withdrawn }})</el-radio-button>
      </el-radio-group>
      <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
      <span v-if="cfg" style="color:#909399;font-size:12px">
        规则：裁定成立扣 {{ cfg.score_deduct }} 分 · 滚动 {{ cfg.count_window_days }} 天内累计 {{ cfg.suspend_threshold }} 次停用 {{ cfg.suspend_days }} 天
      </span>
    </div>

    <!-- 列表 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column label="订单号" width="190">
        <template #default="{row}"><code style="font-size:11px">{{ row.order_no || row.order_id }}</code></template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{row}">
          <el-tag :type="statusType(row)" size="small">{{ statusLabel(row) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="申诉方" width="150">
        <template #default="{row}">
          <el-tag size="small" effect="plain">{{ row.reporter_role === 'partner' ? '耍伴' : '发单人' }}</el-tag>
          <code style="font-size:11px;margin-left:4px">{{ (row.reporter_openid || '').slice(-8) }}</code>
        </template>
      </el-table-column>
      <el-table-column label="被诉方" width="150">
        <template #default="{row}">
          <el-tag size="small" effect="plain" type="danger">{{ row.target_role === 'partner' ? '耍伴' : '发单人' }}</el-tag>
          <code style="font-size:11px;margin-left:4px">{{ (row.target_openid || '').slice(-8) }}</code>
        </template>
      </el-table-column>
      <el-table-column label="申诉原因" min-width="200" show-overflow-tooltip>
        <template #default="{row}">{{ (row.reason_type ? '【' + row.reason_type + '】' : '') + (row.reason || '') }}</template>
      </el-table-column>
      <el-table-column label="举证" width="110">
        <template #default="{row}">
          <span v-if="row.defense_reason">已举证{{ row.defense_overdue ? '(逾期)' : '' }}</span>
          <span v-else style="color:#909399">未举证</span>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{row}">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-button v-if="row.status !== 'decided' && row.status !== 'withdrawn'" size="small" type="primary" @click="openDetail(row)">裁定</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 详情 + 裁定 -->
    <el-dialog v-model="detailVisible" title="爽约申诉详情" width="720px">
      <div v-if="detail" v-loading="detailLoading">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="订单号">{{ detail.order_no || detail.order_id }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(detail)" size="small">{{ statusLabel(detail) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="申诉方">{{ detail.reporter_nickname || '' }}({{ (detail.reporter_openid || '').slice(-8) }}) · {{ detail.reporter_role === 'partner' ? '耍伴' : '发单人' }}</el-descriptions-item>
          <el-descriptions-item label="被诉方">{{ detail.target_nickname || '' }}({{ (detail.target_openid || '').slice(-8) }}) · {{ detail.target_role === 'partner' ? '耍伴' : '发单人' }}</el-descriptions-item>
          <el-descriptions-item label="申诉原因" :span="2">{{ (detail.reason_type ? '【' + detail.reason_type + '】' : '') + (detail.reason || '') }}</el-descriptions-item>
          <el-descriptions-item label="举证说明" :span="2">
            <span v-if="detail.defense_reason">{{ detail.defense_reason }}{{ detail.defense_overdue ? '（逾期提交）' : '' }}</span>
            <span v-else style="color:#909399">未举证（逾期不自动关闭，可径行裁定）</span>
          </el-descriptions-item>
        </el-descriptions>

        <div style="margin-top:12px" v-if="(detail.evidence || []).length">
          <div style="font-weight:600;margin-bottom:6px">申诉证据</div>
          <el-image v-for="e in detail.evidence" :key="e.file_id" :src="e.url" fit="cover"
            style="width:96px;height:96px;margin-right:8px;border-radius:4px" :preview-src-list="detail.evidence.map(x => x.url)" />
        </div>
        <div style="margin-top:12px" v-if="(detail.defense_evidence || []).length">
          <div style="font-weight:600;margin-bottom:6px">答辩证据</div>
          <el-image v-for="e in detail.defense_evidence" :key="e.file_id" :src="e.url" fit="cover"
            style="width:96px;height:96px;margin-right:8px;border-radius:4px" :preview-src-list="detail.defense_evidence.map(x => x.url)" />
        </div>

        <!-- 裁定区 -->
        <div v-if="detail.status !== 'decided' && detail.status !== 'withdrawn'" style="margin-top:16px;border-top:1px solid #ebeef5;padding-top:12px">
          <div style="font-weight:600;margin-bottom:8px">裁定</div>
          <el-alert v-if="cfg" type="warning" :closable="false" show-icon style="margin-bottom:8px"
            :title="`若裁定成立将执行：扣 ${cfg.score_deduct} 分（第 N 次；滚动 ${cfg.count_window_days} 天内累计满 ${cfg.suspend_threshold} 次则账号停用 ${cfg.suspend_days} 天）`" />
          <el-form label-position="top">
            <el-form-item label="裁定说明" required>
              <el-input v-model="note" type="textarea" :rows="3" placeholder="请填写裁定依据（必填，将记录到申诉与审计）" />
            </el-form-item>
          </el-form>
          <el-button :loading="submitting" @click="doDecide('rejected')">裁定：不成立</el-button>
          <el-button type="danger" :loading="submitting" @click="doDecide('upheld')">裁定：成立并处罚</el-button>
        </div>
        <div v-else-if="detail.status === 'withdrawn'" style="margin-top:12px;color:#909399">
          <b>已撤回：</b>申诉人于 {{ formatTime(detail.withdrawn_at) }} 自行撤回（未裁定，无处罚）
        </div>
        <div v-else style="margin-top:12px;color:#606266">
          <b>裁定结果：</b>{{ detail.verdict === 'upheld' ? '成立' : '不成立' }}
          <span v-if="detail.decided_reason">（{{ detail.decided_reason }}）</span>
          <span v-if="detail.penalty_applied">
            · 扣 {{ Math.abs(detail.penalty_applied.score_delta || 0) }} 分
            <span v-if="detail.penalty_applied.suspend_until"> · 停用至 {{ formatTime(detail.penalty_applied.suspend_until) }}</span>
          </span>
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const totalAll = ref(0);
const counts = ref({ received: 0, defense: 0, decided: 0, withdrawn: 0 });
const page = ref(1); const size = ref(15);
const statusFilter = ref('');
const loading = ref(false);
const cfg = ref(null);

const detailVisible = ref(false); const detail = ref(null); const detailLoading = ref(false);
const note = ref(''); const submitting = ref(false);

function statusLabel(row) {
  if (row.status === 'decided') return row.verdict === 'upheld' ? '已裁定·成立' : '已裁定·不成立';
  if (row.status === 'withdrawn') return '已撤回';
  if (row.status === 'defense') return '举证中';
  return '待举证';
}
function statusType(row) {
  if (row.status === 'decided') return row.verdict === 'upheld' ? 'danger' : 'info';
  if (row.status === 'withdrawn') return 'info';
  return row.status === 'defense' ? 'warning' : 'primary';
}

async function load() {
  loading.value = true;
  const r = await call('no_show_report_list', {
    page: page.value, size: size.value, status: statusFilter.value || undefined
  });
  loading.value = false;
  if (r.ok) {
    list.value = r.data.list || [];
    total.value = r.data.total || 0;
    counts.value = r.data.counts || { received: 0, defense: 0, decided: 0, withdrawn: 0 };
    totalAll.value = (counts.value.received || 0) + (counts.value.defense || 0) + (counts.value.decided || 0) + (counts.value.withdrawn || 0);
  } else {
    ElMessage.error(r.msg || r.code || '加载失败');
  }
}

async function loadCfg() {
  const r = await call('config_get');
  if (r.ok && r.data && r.data.operations) {
    const o = r.data.operations;
    cfg.value = {
      score_deduct: o.no_show_score_deduct,
      suspend_threshold: o.no_show_suspend_threshold,
      suspend_days: o.no_show_suspend_days,
      count_window_days: o.no_show_count_window_days
    };
  }
}

function onFilter() { page.value = 1; load(); }

async function openDetail(row) {
  detailVisible.value = true;
  detail.value = null; note.value = '';
  detailLoading.value = true;
  const r = await call('no_show_report_list', { report_id: row.report_id });
  detailLoading.value = false;
  if (r.ok && r.data && r.data.report) {
    detail.value = r.data.report;
  } else {
    ElMessage.error(r.msg || r.code || '详情加载失败');
    detailVisible.value = false;
  }
}

async function doDecide(verdict) {
  if (!note.value.trim()) { ElMessage.warning('请填写裁定说明'); return; }
  submitting.value = true;
  const r = await call('no_show_decide', {
    report_id: detail.value.report_id, verdict, note: note.value.trim()
  });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data.idempotent ? '该申诉已裁定过（幂等返回）' : '裁定完成');
    detailVisible.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '裁定失败');
  }
}

onMounted(() => { load(); loadCfg(); });
</script>