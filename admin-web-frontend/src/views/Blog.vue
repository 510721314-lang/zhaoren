// views/Blog.vue · 博客管理 CP1 只读骨架
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="_id" label="ID" width="180">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row._id }}</span></template>
      </el-table-column>
      <el-table-column prop="content" label="内容" min-width="240" show-overflow-tooltip />
      <el-table-column prop="author_nickname" label="作者" width="140" />
      <el-table-column label="状态" width="100">
        <template #default="{row}">
          <el-tag :type="blogStatusType(row.status)" size="small">{{ row.status ?? '-' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{row}">{{ row.created_at ? formatTime(row.created_at) : '-' }}</template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 底部操作提示 -->
    <el-alert style="margin-top:16px" type="info" :closable="false" show-icon
      title="CP2 待接通：下架 / 恢复 / 删除 为写操作，对应 action blog_offline / blog_restore / blog_delete" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false);

function blogStatusType(s) {
  if (s === 'published') return 'success';
  if (s === 'offline') return 'info';
  if (s === 'draft') return 'warning';
  return 'info';
}

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  const r = await call('blog_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

onMounted(load);
</script>
