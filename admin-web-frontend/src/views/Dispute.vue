// views/Dispute.vue · 纠纷处理
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-select v-model="stFilter" placeholder="全部状态" clearable style="width:140px">
        <el-option label="处理中" value="pending" />
        <el-option label="已处理" value="resolved" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="dispute_id" label="纠纷ID" width="200">
        <template #default="{row}"><code style="font-size:11px">{{ row.dispute_id }}</code></template>
      </el-table-column>
      <el-table-column prop="order_no" label="订单号" width="200">
        <template #default="{row}"><code style="font-size:11px">{{ row.order_no }}</code></template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="120" />
      <el-table-column label="状态" width="90">
        <template #default="{row}">
          <el-tag :type="row.status === 'resolved' ? 'success' : 'warning'" size="small">
            {{ row.status === 'resolved' ? '已处理' : '处理中' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="reason" label="原因" show-overflow-tooltip />
      <el-table-column label="创建时间" width="160">
        <template #default="{row}">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column prop="handler" label="处理人" width="110" />
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
const loading = ref(false); const stFilter = ref('');

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (stFilter.value) params.status = stFilter.value;
  const r = await call('dispute_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
