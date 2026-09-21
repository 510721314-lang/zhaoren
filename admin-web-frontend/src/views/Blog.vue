// views/Blog.vue · 博客管理 CP2 写操作接通 (下架/恢复/删除)
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-select v-model="stFilter" placeholder="全部状态" clearable style="width:140px" @change="load">
        <el-option label="正常" value="normal" />
        <el-option label="已下架" value="offline" />
        <el-option label="已删除" value="deleted" />
      </el-select>
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
          <el-tag :type="blogStatusType(row.status)" size="small">{{ blogStatusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{row}">{{ row.created_at ? formatTime(row.created_at) : '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{row}">
          <el-button v-if="row.status !== 'offline' && row.status !== 'deleted'"
            size="small" type="warning" :loading="busy === row._id"
            @click="openAction(row, 'offline')">下架</el-button>
          <el-button v-if="row.status === 'offline'"
            size="small" type="success" :loading="busy === row._id"
            @click="doRestore(row)">恢复</el-button>
          <el-button v-if="row.status !== 'deleted'"
            size="small" type="danger" :loading="busy === row._id"
            @click="openAction(row, 'delete')">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 下架/删除原因弹窗 -->
    <el-dialog v-model="actionDialog" :title="actionTitle" width="480px">
      <el-form label-position="top">
        <el-form-item label="目标动态">
          <span>{{ actionTarget?.content?.slice(0, 40) }}{{ actionTarget?.content?.length > 40 ? '…' : '' }}</span>
        </el-form-item>
        <el-form-item :label="actionType === 'offline' ? '下架原因' : '删除原因'" required>
          <el-input v-model="actionNote" type="textarea" :rows="3"
            :placeholder="actionType === 'offline' ? '请填写下架原因, 将记录到审计日志' : '请填写删除原因, 此操作不可逆'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="actionDialog = false">取消</el-button>
        <el-button :type="actionType === 'offline' ? 'warning' : 'danger'" :loading="submitting" @click="doSubmit">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const stFilter = ref('');
const busy = ref('');

// 下架/删除弹窗
const actionDialog = ref(false);
const actionType = ref(''); // 'offline' | 'delete'
const actionTarget = ref(null);
const actionNote = ref('');
const submitting = ref(false);

const actionTitle = computed(() => actionType.value === 'offline' ? '下架动态' : '删除动态');

function blogStatusType(s) {
  if (s === 'normal') return 'success';
  if (s === 'offline') return 'info';
  if (s === 'draft') return 'warning';
  if (s === 'deleted') return 'danger';
  return 'info';
}
function blogStatusLabel(s) {
  const m = { normal: '正常', offline: '已下架', draft: '草稿', deleted: '已删除' };
  return m[s] || s || '-';
}

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (stFilter.value) params.status = stFilter.value;
  const r = await call('blog_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

function openAction(row, type) {
  actionTarget.value = row;
  actionType.value = type;
  actionNote.value = '';
  actionDialog.value = true;
}

async function doSubmit() {
  if (!actionNote.value.trim()) {
    ElMessage.warning('请填写原因');
    return;
  }
  submitting.value = true;
  const target = actionTarget.value;
  const action = actionType.value === 'offline' ? 'blog_offline' : 'blog_delete';
  const r = await call(action, { post_id: target._id, note: actionNote.value.trim() });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data?.msg || '操作成功');
    actionDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

async function doRestore(row) {
  try {
    await ElMessageBox.confirm(
      `确认恢复动态「${row.content?.slice(0, 20) || row._id}」为正常状态?`,
      '操作确认', { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'success' }
    );
  } catch (_) { return; }
  busy.value = row._id;
  const r = await call('blog_restore', { post_id: row._id });
  busy.value = '';
  if (r.ok) {
    ElMessage.success(r.data?.msg || '已恢复');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

onMounted(load);
</script>
