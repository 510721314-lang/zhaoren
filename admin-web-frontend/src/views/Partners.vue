// views/Partners.vue · 耍伴管理
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-input v-model="kw" placeholder="openid / 昵称" clearable style="width:240px" @keyup.enter="load" />
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="openid" label="OpenID" width="200">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.openid?.slice(-12) }}</span></template>
      </el-table-column>
      <el-table-column prop="nickname" label="昵称" min-width="140" show-overflow-tooltip />
      <el-table-column prop="exam_scores" label="考试分数" width="110" />
      <el-table-column label="状态" width="90">
        <template #default="{row}">
          <el-tag :type="partnerStatusType(row.status)" size="small">{{ partnerStatusLabel(row.status) }}</el-tag>
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
const loading = ref(false); const kw = ref('');

function partnerStatusLabel(s) {
  const m = { active: '在岗', inactive: '离岗', banned: '封禁', pending: '待审核' };
  return m[s] || s || '-';
}

function partnerStatusType(s) {
  const m = { active: 'success', inactive: 'info', banned: 'danger', pending: 'warning' };
  return m[s] || 'info';
}

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (kw.value) params.keyword = kw.value;
  const r = await call('partner_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
