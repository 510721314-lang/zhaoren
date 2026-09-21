// views/Report.vue · 举报处理 CP1 只读骨架
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-select v-model="status" placeholder="全部处理状态" clearable style="width:160px">
        <el-option label="待处理" value="pending" />
        <el-option label="已处理" value="resolved" />
        <el-option label="已忽略" value="ignored" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="report_id" label="举报ID" width="180">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.report_id }}</span></template>
      </el-table-column>
      <el-table-column prop="order_no" label="订单号" width="180">
        <template #default="{row}"><code style="font-size:11px">{{ row.order_no }}</code></template>
      </el-table-column>
      <el-table-column prop="type" label="举报类型" width="120" />
      <el-table-column label="举报人" width="160">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.reporter_openid?.slice(-12) }}</span></template>
      </el-table-column>
      <el-table-column label="处理状态" width="100">
        <template #default="{row}">
          <el-tag :type="reportStatusType(row.status)" size="small">{{ reportStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{row}">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const status = ref('');

function reportStatusText(s) {
  const m = { pending: '待处理', resolved: '已处理', ignored: '已忽略' };
  return m[s] || s || '-';
}
function reportStatusType(s) {
  const m = { pending: 'warning', resolved: 'success', ignored: 'info' };
  return m[s] || 'info';
}

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (status.value) params.status = status.value;
  const r = await call('report_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
