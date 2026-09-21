// views/Comment.vue · 评论管理 CP1 只读骨架
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-input v-model="blogId" placeholder="按博客 ID 筛选（可选）" clearable style="width:240px" @keyup.enter="load" />
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="_id" label="评论ID" width="180">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row._id }}</span></template>
      </el-table-column>
      <el-table-column label="评论者" width="180">
        <template #default="{row}">
          <div>{{ row.author_nickname || '-' }}</div>
          <div style="font-family:monospace;font-size:10px;color:#999">{{ row.author_openid?.slice(-12) }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="content" label="内容" min-width="260" show-overflow-tooltip />
      <el-table-column label="状态" width="100">
        <template #default="{row}">
          <el-tag :type="commentStatusType(row.status)" size="small">{{ row.status ?? '-' }}</el-tag>
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
const loading = ref(false); const blogId = ref('');

function commentStatusType(s) {
  if (s === 'normal') return 'success';
  if (s === 'hidden') return 'info';
  if (s === 'deleted') return 'danger';
  return 'info';
}

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (blogId.value) params.post_id = blogId.value;
  const r = await call('blog_comment_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
