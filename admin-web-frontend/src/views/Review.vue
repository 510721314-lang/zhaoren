// views/Review.vue · 耍伴审核 CP1 只读骨架
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-select v-model="status" placeholder="全部审核状态" clearable style="width:160px">
        <el-option label="待审核" value="pending" />
        <el-option label="已通过" value="approved" />
        <el-option label="已驳回" value="rejected" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="openid" label="OpenID" width="200">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.openid?.slice(-12) }}</span></template>
      </el-table-column>
      <el-table-column prop="nickname" label="昵称" min-width="140" show-overflow-tooltip />
      <el-table-column label="实名" width="80">
        <template #default="{row}"><el-tag v-if="row.realname_done" type="success" size="small">已</el-tag><span v-else>-</span></template>
      </el-table-column>
      <el-table-column prop="exam_scores" label="考试分数" width="100">
        <template #default="{row}">{{ row.exam_scores ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="审核状态" width="100">
        <template #default="{row}">
          <el-tag :type="reviewStatusType(row.status)" size="small">{{ reviewStatusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="160">
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

function reviewStatusText(s) {
  const m = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
  return m[s] || s || '-';
}
function reviewStatusType(s) {
  const m = { pending: 'warning', approved: 'success', rejected: 'danger' };
  return m[s] || 'info';
}

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  // 注意：部分后端 action (FAIL 场景) 可能要求参数名为 review_status 而非 status
  if (status.value) params.status = status.value;
  const r = await call('review', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
