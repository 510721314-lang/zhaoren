// views/Dispute.vue · 纠纷处理 CP2 写操作接通 (开案/裁决) + 全流程留痕详情 (2026-10-10)
// 列表(处理中/已处置/全部) + 详情抽屉(四源合并时间线) + 退款金额可输入(默认全额, ≤ 可退上限)
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:600">纠纷处理</span>
      <el-radio-group v-model="scope" size="small" @change="onScope">
        <el-radio-button label="active">处理中</el-radio-button>
        <el-radio-button label="history">已处置</el-radio-button>
        <el-radio-button label="all">全部</el-radio-button>
      </el-radio-group>
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
      <el-table-column label="已退款" width="100">
        <template #default="{row}">{{ row.refund_fen > 0 ? '¥' + fenToYuan(row.refund_fen) : '-' }}</template>
      </el-table-column>
      <el-table-column prop="complaint_reason" label="纠纷原因" min-width="160" show-overflow-tooltip />
      <el-table-column prop="admin_note" label="处置备注" min-width="160" show-overflow-tooltip />
      <el-table-column label="更新时间" width="160">
        <template #default="{row}">{{ formatTime(row.updated_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
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
        <el-form-item v-if="handleDecision === 'refund'" label="退款金额（元）" required>
          <el-input-number v-model="amountYuan" :min="0.01" :max="refundMaxYuan" :precision="2" :step="1"
            style="width:200px" />
          <span style="margin-left:8px;color:#909399;font-size:12px">可退上限 ¥{{ refundMaxYuan.toFixed(2) }}</span>
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

    <!-- 全流程留痕抽屉 -->
    <el-drawer v-model="detailVisible" title="纠纷处理过程" size="720px">
      <div v-if="detail" v-loading="detailLoading">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="订单号"><code>{{ detail.order.order_no }}</code></el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="disputeStatusType(detail.order.status)" size="small">{{ disputeStatusLabel(detail.order.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="场景">{{ detail.order.scene_name || detail.order.scene }}</el-descriptions-item>
          <el-descriptions-item label="订单金额">¥{{ fenToYuan(detail.order.total_fen) }}</el-descriptions-item>
          <el-descriptions-item label="发单人">{{ nickText(detail.order.user_nick, detail.order.user_openid) }}</el-descriptions-item>
          <el-descriptions-item label="耍伴">{{ nickText(detail.order.partner_nick, detail.order.partner_openid) }}</el-descriptions-item>
          <el-descriptions-item label="已退款" :span="2">
            <span v-if="detail.order.refund_fen > 0">¥{{ fenToYuan(detail.order.refund_fen) }}（流水号 {{ detail.order.refund_no }}）</span>
            <span v-else style="color:#909399">未退款</span>
          </el-descriptions-item>
          <el-descriptions-item label="纠纷原因" :span="2">{{ detail.order.complaint_reason || '—' }}</el-descriptions-item>
          <el-descriptions-item label="处置备注" :span="2">{{ detail.order.admin_note || '—' }}</el-descriptions-item>
          <el-descriptions-item label="争议登记">{{ detail.order.dispute_opened_at ? formatTime(detail.order.dispute_opened_at) : '—' }}</el-descriptions-item>
          <el-descriptions-item label="裁决时间">{{ detail.order.dispute_handled_at ? formatTime(detail.order.dispute_handled_at) : '—' }}</el-descriptions-item>
        </el-descriptions>

        <h4 style="margin-top:16px">处理时间线</h4>
        <el-timeline v-if="(detail.timeline || []).length">
          <el-timeline-item v-for="(t, i) in detail.timeline" :key="i" :timestamp="formatTime(t.ts)" placement="top"
            :type="t.tag === 'money' ? 'success' : t.tag === 'complaint' ? 'danger' : t.tag === 'nosh' ? 'warning' : 'primary'">
            <div><strong>{{ t.title }}</strong></div>
            <div v-if="t.desc" style="color:#606266;font-size:12px">{{ t.desc }}</div>
            <div style="color:#909399;font-size:12px">{{ t.actor_text || '-' }}</div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无过程记录" />

        <h4 style="margin-top:16px">资金流水</h4>
        <el-table :data="detail.transactions" border size="small">
          <el-table-column label="类型" width="80"><template #default="{row}">{{ txTypeLabel(row.type) }}</template></el-table-column>
          <el-table-column label="金额" width="100"><template #default="{row}">¥{{ fenToYuan(row.amount_fen) }}</template></el-table-column>
          <el-table-column prop="status" label="状态" width="80" />
          <el-table-column prop="pay_no" label="流水号" show-overflow-tooltip />
          <el-table-column label="时间" width="160"><template #default="{row}">{{ formatTime(row.created_at) }}</template></el-table-column>
        </el-table>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';
import { fenToYuan, formatTime, yuanToFen, txTypeLabel } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false);
const busy = ref('');
const scope = ref('active');

// 详情抽屉
const detailVisible = ref(false); const detail = ref(null); const detailLoading = ref(false);

// 处置弹窗
const handleDialog = ref(false);
const handleTarget = ref(null);
const handleDecision = ref(''); // open / refund / complete
const handleNote = ref('');
const amountYuan = ref(0);
const submitting = ref(false);

const handleTitle = computed(() => {
  const m = { open: '登记争议', refund: '裁决退款', complete: '裁决完成' };
  return m[handleDecision.value] || '处置';
});

const handlePlaceholder = computed(() => {
  const m = {
    open: '请填写争议登记说明, 仅 S10 已关闭订单可登记, 将转 S10.5 处理中',
    refund: '请填写退款裁决说明, 将订单置为 S7 已退款并写入退款流水/通知双方',
    complete: '请填写完成裁决说明, 保留订单 S5 已完成状态'
  };
  return m[handleDecision.value] || '请填写处置说明';
});

const handleBtnType = computed(() => {
  const m = { open: 'warning', refund: 'danger', complete: 'success' };
  return m[handleDecision.value] || 'primary';
});

// 可退上限(元): 以订单总额为界, 已退部分由后端二次校验
const refundMaxYuan = computed(() => Number(handleTarget.value?.total_fen || 0) / 100);

function disputeStatusLabel(s) {
  const m = { 'S10': '已关闭', 'S10.5': '争议处理中', 'S7': '已退款', 'S5': '已完成' };
  return m[s] || s || '-';
}

function disputeStatusType(s) {
  const m = { 'S10': 'info', 'S10.5': 'warning', 'S7': 'danger', 'S5': 'success' };
  return m[s] || 'info';
}

function nickText(nick, openid) {
  return nick ? `${nick}(${(openid || '').slice(-8)})` : (openid ? openid.slice(-8) : '-');
}

function onScope() { page.value = 1; load(); }

async function load() {
  loading.value = true;
  const r = await call('dispute_list', { page: page.value, size: size.value, scope: scope.value });
  loading.value = false;
  if (r.ok) {
    list.value = r.data.list || [];
    total.value = r.data.total || 0;
  } else {
    ElMessage.error(r.msg || r.code || '加载失败');
  }
}

async function openDetail(row) {
  detailVisible.value = true;
  detail.value = null;
  detailLoading.value = true;
  const r = await call('dispute_detail', { order_id: row.order_id });
  detailLoading.value = false;
  if (r.ok) {
    detail.value = r.data;
  } else {
    ElMessage.error(r.msg || r.code || '详情加载失败');
    detailVisible.value = false;
  }
}

function openHandle(row, decision) {
  handleTarget.value = row;
  handleDecision.value = decision;
  handleNote.value = '';
  amountYuan.value = Number((row.total_fen || 0)) / 100;
  handleDialog.value = true;
}

async function doHandle() {
  if (!handleNote.value.trim()) {
    ElMessage.warning('请填写处置说明');
    return;
  }
  const body = {
    order_id: handleTarget.value.order_id,
    decision: handleDecision.value,
    note: handleNote.value.trim()
  };
  if (handleDecision.value === 'refund') {
    const fen = yuanToFen(amountYuan.value);
    if (fen <= 0) { ElMessage.warning('请填写正确的退款金额'); return; }
    if (fen > Number(handleTarget.value.total_fen || 0)) {
      ElMessage.warning(`退款金额不得超过可退上限 ¥${refundMaxYuan.value.toFixed(2)}`);
      return;
    }
    body.refund_fen = fen;
  }
  submitting.value = true;
  const r = await call('dispute_handle', body);
  submitting.value = false;
  if (r.ok) {
    if (handleDecision.value === 'refund') {
      ElMessage.success(`已退款 ¥${fenToYuan(r.data?.refund_fen)} 并通知双方`);
    } else {
      ElMessage.success(r.data?.msg || '处置成功');
    }
    handleDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

onMounted(load);
</script>
