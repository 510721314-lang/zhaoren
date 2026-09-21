// views/Dispute.vue · 纠纷处理 CP2 写操作接通 (开案/裁决)
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:600">纠纷处理</span>
      <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="order_no" label="订单号" width="200">
        <template #default="{row}"><code style="font-size:11px">{{ row.order_no }}</code></template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{row}">
          <el-tag :type="disputeStatusType(row.status)" size="small">{{ disputeStatusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="scene" label="场景" width="80" />
      <el-table-column label="用户" width="130">
        <template #default="{row}"><code style="font-size:11px">{{ row.user_openid?.slice(-8) }}</code></template>
      </el-table-column>
      <el-table-column label="耍伴" width="130">
        <template #default="{row}"><code style="font-size:11px">{{ row.partner_openid?.slice(-8) }}</code></template>
      </el-table-column>
      <el-table-column label="金额" width="100">
        <template #default="{row}">¥{{ fenToYuan(row.total_fen) }}</template>
      </el-table-column>
      <el-table-column prop="dispute_reason" label="纠纷原因" min-width="160" show-overflow-tooltip />
      <el-table-column prop="admin_note" label="处置备注" min-width="160" show-overflow-tooltip />
      <el-table-column label="更新时间" width="160">
        <template #default="{row}">{{ formatTime(row.updated_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{row}">
          <el-button v-if="row.status === 'S10'" size="small" type="warning"
            :loading="busy === row.order_id" @click="openHandle(row, 'open')">开案</el-button>
          <template v-if="row.status === 'S10.5'">
            <el-button size="small" type="danger" :loading="busy === row.order_id"
              @click="openHandle(row, 'refund')">退款</el-button>
            <el-button size="small" type="success" :loading="busy === row.order_id"
              @click="openHandle(row, 'complete')">完成</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 处置弹窗 -->
    <el-dialog v-model="handleDialog" :title="handleTitle" width="480px">
      <el-form label-position="top">
        <el-form-item label="目标订单">
          <span>{{ handleTarget?.order_no }}</span>
        </el-form-item>
        <el-form-item label="处置说明" required>
          <el-input v-model="handleNote" type="textarea" :rows="3"
            :placeholder="handlePlaceholder" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="handleDialog = false">取消</el-button>
        <el-button :type="handleBtnType" :loading="submitting" @click="doHandle">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';
import { fenToYuan, formatTime } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false);
const busy = ref('');

// 处置弹窗
const handleDialog = ref(false);
const handleTarget = ref(null);
const handleDecision = ref(''); // open / refund / complete
const handleNote = ref('');
const submitting = ref(false);

const handleTitle = computed(() => {
  const m = { open: '登记争议', refund: '裁决退款', complete: '裁决完成' };
  return m[handleDecision.value] || '处置';
});

const handlePlaceholder = computed(() => {
  const m = {
    open: '请填写争议登记说明, 仅 S10 已关闭订单可登记, 将转 S10.5 处理中',
    refund: '请填写退款裁决说明, 将订单置为 S7 已退款',
    complete: '请填写完成裁决说明, 保留订单 S5 已完成状态'
  };
  return m[handleDecision.value] || '请填写处置说明';
});

const handleBtnType = computed(() => {
  const m = { open: 'warning', refund: 'danger', complete: 'success' };
  return m[handleDecision.value] || 'primary';
});

function disputeStatusLabel(s) {
  const m = { 'S10': '已关闭', 'S10.5': '争议处理中', 'S7': '已退款', 'S5': '已完成' };
  return m[s] || s || '-';
}

function disputeStatusType(s) {
  const m = { 'S10': 'info', 'S10.5': 'warning', 'S7': 'danger', 'S5': 'success' };
  return m[s] || 'info';
}

async function load() {
  loading.value = true;
  const r = await call('dispute_list', { page: page.value, size: size.value });
  loading.value = false;
  if (r.ok) {
    list.value = r.data.list || [];
    total.value = r.data.total || list.value.length;
  }
}

function openHandle(row, decision) {
  handleTarget.value = row;
  handleDecision.value = decision;
  handleNote.value = '';
  handleDialog.value = true;
}

async function doHandle() {
  if (!handleNote.value.trim()) {
    ElMessage.warning('请填写处置说明');
    return;
  }
  submitting.value = true;
  const target = handleTarget.value;
  const r = await call('dispute_handle', {
    order_id: target.order_id,
    decision: handleDecision.value,
    note: handleNote.value.trim()
  });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data?.msg || '处置成功');
    handleDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

onMounted(load);
</script>
