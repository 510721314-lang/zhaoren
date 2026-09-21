// views/Review.vue · 耍伴审核（写操作：approve / reject）
// 列表来自 partner_list + status=pending_review；写操作用 admin-action 的 review
<template>
  <div>
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:600">待审核耍伴</span>
      <el-tag type="warning" size="small" v-if="total">{{ total }} 条</el-tag>
      <el-button type="primary" plain :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="openid" label="OpenID" width="180">
        <template #default="{ row }">
          <span style="font-family:monospace;font-size:11px">{{ maskOpenid(row.openid) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="昵称" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.user?.nickname || row.nickname || '-' }}</template>
      </el-table-column>
      <el-table-column label="申请时间" width="170">
        <template #default="{ row }">{{ formatTime(row.applied_at || row.created_at) }}</template>
      </el-table-column>
      <el-table-column prop="review_note" label="备注" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">{{ row.review_note || '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="success" :loading="busy === row.openid" @click="doApprove(row)">通过</el-button>
          <el-button size="small" type="danger" :loading="busy === row.openid" @click="openReject(row)">驳回</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page"
      v-model:page-size="size"
      :total="total"
      :page-sizes="[15, 30]"
      layout="total, sizes, prev, pager, next"
      @size-change="load"
      @current-change="load"
    />

    <!-- 驳回弹窗 -->
    <el-dialog v-model="rejectDialog" title="驳回耍伴申请" width="480px">
      <el-form label-position="top">
        <el-form-item label="被驳回耍伴">
          <span>{{ rejectTarget?.user?.nickname || rejectTarget?.nickname || rejectTarget?.openid }}</span>
        </el-form-item>
        <el-form-item label="驳回原因" required>
          <el-input v-model="rejectNote" type="textarea" :rows="3" placeholder="请填写驳回原因，将反馈给用户" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="doReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(15);
const loading = ref(false);
const busy = ref(''); // 当前正在操作的 openid

// 驳回弹窗
const rejectDialog = ref(false);
const rejectNote = ref('');
const rejectTarget = ref(null);
const submitting = ref(false);

function maskOpenid(openid) {
  if (!openid) return '-';
  if (openid.length <= 10) return openid;
  return openid.slice(0, 4) + '****' + openid.slice(-6);
}

async function load() {
  loading.value = true;
  const r = await call('partner_list', {
    page: page.value,
    size: size.value,
    status: 'pending_review'
  });
  loading.value = false;
  if (r.ok) {
    list.value = r.data?.list || [];
    total.value = r.data?.total || 0;
  } else {
    ElMessage.error(r.msg || '加载待审核列表失败');
  }
}

async function doApprove(row) {
  try {
    await ElMessageBox.confirm(
      `确认通过耍伴「${row.user?.nickname || row.nickname || row.openid}」的申请？`,
      '操作确认',
      { confirmButtonText: '确认通过', cancelButtonText: '取消', type: 'success' }
    );
  } catch (_) {
    return;
  }
  busy.value = row.openid;
  const r = await call('review', {
    target_openid: row.openid,
    decision: 'approve',
    note: ''
  });
  busy.value = '';
  if (r.ok) {
    ElMessage.success('已通过');
    await load();
  } else {
    ElMessage.error(r.msg || '操作失败');
  }
}

function openReject(row) {
  rejectTarget.value = row;
  rejectNote.value = '';
  rejectDialog.value = true;
}

async function doReject() {
  if (!rejectNote.value.trim()) {
    ElMessage.warning('请填写驳回原因');
    return;
  }
  submitting.value = true;
  const target = rejectTarget.value;
  const r = await call('review', {
    target_openid: target.openid,
    decision: 'reject',
    note: rejectNote.value.trim()
  });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success('已驳回');
    rejectDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || '操作失败');
  }
}

onMounted(load);
</script>
