// views/Demand.vue · 需求广场 CP2 写操作接通 (下架)
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-input v-model="kw" placeholder="需求号 / openid" clearable style="width:240px" @keyup.enter="load" />
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="demand_no" label="需求号" width="200">
        <template #default="{row}"><code style="font-size:11px">{{ row.demand_no }}</code></template>
      </el-table-column>
      <el-table-column label="创建人" width="160">
        <template #default="{row}">{{ row.creator_name || '-' }}</template>
      </el-table-column>
      <el-table-column label="OpenID" width="160">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.creator_openid?.slice(-12) }}</span></template>
      </el-table-column>
      <el-table-column prop="scene" label="场景" width="80" />
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{row}">
          <el-tag :type="demandStatusType(row.status)" size="small">{{ demandStatusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="100">
        <template #default="{row}">¥{{ fenToYuan(row.total_fen) }}</template>
      </el-table-column>
      <el-table-column label="开始时间" width="160">
        <template #default="{row}">{{ row.start_time ? formatTime(row.start_time) : '-' }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{row}">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{row}">
          <el-button v-if="row.status === 'matching'" size="small" type="danger"
            :loading="busy === row._id" @click="openOffline(row)">下架</el-button>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 下架原因弹窗 -->
    <el-dialog v-model="offlineDialog" title="下架需求" width="480px">
      <el-form label-position="top">
        <el-form-item label="目标需求">
          <span>{{ offlineTarget?.demand_no }}</span>
        </el-form-item>
        <el-form-item label="下架原因" required>
          <el-input v-model="offlineNote" type="textarea" :rows="3"
            placeholder="请填写下架原因, 此操作不可逆, 将记录到审计日志" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="offlineDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="doOffline">确认下架</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';
import { fenToYuan, formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const kw = ref('');
const busy = ref('');

// 下架弹窗
const offlineDialog = ref(false);
const offlineTarget = ref(null);
const offlineNote = ref('');
const submitting = ref(false);

function demandStatusLabel(s) {
  const m = { matching: '匹配中', matched: '已匹配', cancelled: '已取消', expired: '已过期', offline: '已下架' };
  return m[s] || s || '-';
}

function demandStatusType(s) {
  const m = { matching: 'success', matched: 'primary', cancelled: 'info', expired: 'info', offline: 'danger' };
  return m[s] || 'info';
}

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (kw.value) params.keyword = kw.value;
  const r = await call('demand_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

function openOffline(row) {
  offlineTarget.value = row;
  offlineNote.value = '';
  offlineDialog.value = true;
}

async function doOffline() {
  if (!offlineNote.value.trim()) {
    ElMessage.warning('请填写下架原因');
    return;
  }
  submitting.value = true;
  const target = offlineTarget.value;
  const r = await call('demand_offline', { demand_id: target._id, note: offlineNote.value.trim() });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data?.msg || '已下架');
    offlineDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

onMounted(load);
</script>
