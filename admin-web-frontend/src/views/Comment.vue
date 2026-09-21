// views/Comment.vue · 评论管理 CP2 写操作接通 (blog_comment_delete)
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
        <template #default="{row}">{{ row.created_at ? formatTime(row.created_at) : '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{row}">
          <el-button v-if="row.status !== 'deleted'"
            size="small" type="danger" :loading="busy === row._id"
            @click="openDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 删除原因弹窗 -->
    <el-dialog v-model="deleteDialog" title="删除评论" width="480px">
      <el-form label-position="top">
        <el-form-item label="目标评论">
          <span>{{ deleteTarget?.content?.slice(0, 40) }}{{ deleteTarget?.content?.length > 40 ? '…' : '' }}</span>
        </el-form-item>
        <el-form-item label="删除原因" required>
          <el-input v-model="deleteNote" type="textarea" :rows="3"
            placeholder="请填写删除原因, 此操作不可逆" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deleteDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="doDelete">确认删除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const blogId = ref('');
const busy = ref('');

// 删除弹窗
const deleteDialog = ref(false);
const deleteTarget = ref(null);
const deleteNote = ref('');
const submitting = ref(false);

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

function openDelete(row) {
  deleteTarget.value = row;
  deleteNote.value = '';
  deleteDialog.value = true;
}

async function doDelete() {
  if (!deleteNote.value.trim()) {
    ElMessage.warning('请填写删除原因');
    return;
  }
  submitting.value = true;
  const target = deleteTarget.value;
  const r = await call('blog_comment_delete', { comment_id: target._id, note: deleteNote.value.trim() });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data?.msg || '已删除');
    deleteDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

onMounted(load);
</script>
