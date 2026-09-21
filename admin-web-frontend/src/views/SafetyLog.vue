// views/SafetyLog.vue · 安全报备
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-select v-model="kindFilter" placeholder="全部类型" clearable style="width:140px">
        <el-option label="SOS 求救" value="sos" />
        <el-option label="签到报备" value="checkin" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column label="类型" width="100">
        <template #default="{row}">
          <el-tag :type="row.kind === 'sos' ? 'danger' : 'info'" size="small">
            {{ row.kind === 'sos' ? 'SOS' : '签到' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="target_openid" label="目标用户" width="180">
        <template #default="{row}"><code style="font-size:11px">{{ row.target_openid }}</code></template>
      </el-table-column>
      <el-table-column prop="order_id" label="订单ID" width="180">
        <template #default="{row}"><code style="font-size:11px">{{ row.order_id || '-' }}</code></template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{row}">
          <el-tag :type="row.status === 'resolved' ? 'success' : row.status === 'pending' ? 'warning' : 'info'" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="location" label="位置" show-overflow-tooltip />
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
const loading = ref(false); const kindFilter = ref('');

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (kindFilter.value) params.kind = kindFilter.value;
  const r = await call('safety_log_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
