// views/Insurance.vue · 保险记录
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-input v-model="orderId" placeholder="订单ID" clearable style="width:220px" />
      <el-input v-model="openid" placeholder="用户 OpenID" clearable style="width:240px" @keyup.enter="load" />
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="policy_no" label="保单号" width="200">
        <template #default="{row}"><code style="font-size:11px">{{ row.policy_no }}</code></template>
      </el-table-column>
      <el-table-column prop="order_id" label="订单ID" width="180">
        <template #default="{row}"><code style="font-size:11px">{{ row.order_id }}</code></template>
      </el-table-column>
      <el-table-column prop="openid" label="用户 OpenID" width="180">
        <template #default="{row}"><code style="font-size:11px">{{ row.openid }}</code></template>
      </el-table-column>
      <el-table-column prop="scene_code" label="场景" width="100" />
      <el-table-column label="状态" width="90">
        <template #default="{row}">
          <el-tag :type="row.status === 'active' ? 'success' : row.status === 'expired' ? 'info' : 'warning'" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="保额 (¥)" width="100">
        <template #default="{row}">{{ fenToYuan(row.coverage_accident_fen) }}</template>
      </el-table-column>
      <el-table-column label="保费 (¥)" width="100">
        <template #default="{row}">{{ fenToYuan(row.premium_fen) }}</template>
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
const loading = ref(false); const orderId = ref(''); const openid = ref('');

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (orderId.value) params.order_id = orderId.value;
  if (openid.value) params.target_openid = openid.value;
  const r = await call('insurance_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
