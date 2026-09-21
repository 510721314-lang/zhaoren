// views/Demand.vue · 需求广场 CP1 只读骨架
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
        <template #default="{row}">{{ row.status ?? '-' }}</template>
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
import { fenToYuan, formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const kw = ref('');

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (kw.value) params.keyword = kw.value;
  const r = await call('demand_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
