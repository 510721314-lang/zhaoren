// views/Partners.vue · 耍伴管理 CP2 写操作接通 (停止/恢复接单)
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
      <el-table-column label="状态" width="100">
        <template #default="{row}">
          <el-tag :type="partnerStatusType(row.status)" size="small">{{ partnerStatusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="接单状态" width="100">
        <template #default="{row}">
          <el-tag v-if="row.status === 'approved'" :type="row.accept_switch ? 'success' : 'info'" size="small">
            {{ row.accept_switch ? '接单中' : '已暂停' }}
          </el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="申请时间" width="160">
        <template #default="{row}">{{ formatTime(row.applied_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{row}">
          <template v-if="row.status === 'approved'">
            <el-button v-if="row.accept_switch" size="small" type="warning" :loading="busy === row.openid"
              @click="openOffline(row)">停止接单</el-button>
            <el-button v-else size="small" type="success" :loading="busy === row.openid"
              @click="doOnline(row)">恢复接单</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 停止接单原因弹窗 -->
    <el-dialog v-model="offlineDialog" title="停止接单" width="480px">
      <el-form label-position="top">
        <el-form-item label="耍伴">
          <span>{{ offlineTarget?.nickname || offlineTarget?.openid }}</span>
        </el-form-item>
        <el-form-item label="停止原因">
          <el-input v-model="offlineReason" type="textarea" :rows="3"
            placeholder="可选, 填写后记录到审计日志" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="offlineDialog = false">取消</el-button>
        <el-button type="warning" :loading="submitting" @click="doOffline">确认停止</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const kw = ref('');
const busy = ref('');

// 停止接单弹窗
const offlineDialog = ref(false);
const offlineTarget = ref(null);
const offlineReason = ref('');
const submitting = ref(false);

function partnerStatusLabel(s) {
  const m = { pending_review: '待审核', approved: '已通过', rejected: '已拒绝', offline: '离线', banned: '封禁' };
  return m[s] || s || '-';
}

function partnerStatusType(s) {
  const m = { pending_review: 'warning', approved: 'success', rejected: 'danger', offline: 'info', banned: 'danger' };
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

function openOffline(row) {
  offlineTarget.value = row;
  offlineReason.value = '';
  offlineDialog.value = true;
}

async function doOffline() {
  submitting.value = true;
  const target = offlineTarget.value;
  const r = await call('partner_offline', {
    target_openid: target.openid,
    reason: offlineReason.value.trim() || undefined
  });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data?.msg || '已停止接单');
    offlineDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

async function doOnline(row) {
  try {
    await ElMessageBox.confirm(
      `确认恢复耍伴「${row.nickname || row.openid}」的接单状态?`,
      '操作确认', { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'success' }
    );
  } catch (_) { return; }
  busy.value = row.openid;
  const r = await call('partner_online', { target_openid: row.openid });
  busy.value = '';
  if (r.ok) {
    ElMessage.success(r.data?.msg || '已恢复接单');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

onMounted(load);
</script>
