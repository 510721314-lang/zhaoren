// views/Orders.vue · 订单管理 CP1 只读闭环
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-input v-model="kw" placeholder="openid / order_id / order_no" clearable style="width:260px" @keyup.enter="load" />
      <el-select v-model="stFilter" placeholder="全部状态" clearable style="width:140px">
        <el-option v-for="v in statusOpts" :key="v" :label="statusLabel(v)" :value="v" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small" @row-click="onRow" highlight-current-row>
      <el-table-column prop="order_no" label="订单号" width="200">
        <template #default="{row}"><code style="font-size:11px">{{ row.order_no }}</code></template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{row}"><el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag></template>
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
      <el-table-column label="开始时间" width="160">
        <template #default="{row}">{{ row.start_time ? formatTime(row.start_time) : '-' }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="160">
        <template #default="{row}">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="纠纷" width="70">
        <template #default="{row}"><span v-if="row.help_flag" style="color:#E6A23C">⚠</span><span v-else>-</span></template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 详情抽屉 -->
    <el-drawer v-model="showDetail" title="订单详情" size="680px">
      <div v-if="detail">
        <h4>基本信息</h4>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="订单号"><code>{{ detail.order.order_no }}</code></el-descriptions-item>
          <el-descriptions-item label="状态"><el-tag :type="statusType(detail.order.status)">{{ statusLabel(detail.order.status) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="场景">{{ detail.order.scene }}</el-descriptions-item>
          <el-descriptions-item label="时长">{{ detail.order.duration_h }}h</el-descriptions-item>
          <el-descriptions-item label="总金额">¥{{ fenToYuan(detail.order.total_fen) }}</el-descriptions-item>
          <el-descriptions-item label="用户分账">¥{{ fenToYuan(detail.order.partner_income_fen) }}</el-descriptions-item>
          <el-descriptions-item label="耍伴">{{ detail.order.partner_openid }}</el-descriptions-item>
          <el-descriptions-item label="用户">{{ detail.order.user_openid }}</el-descriptions-item>
          <el-descriptions-item label="开始时间" :span="2">{{ detail.order.start_time ? formatTime(detail.order.start_time) : '-' }}</el-descriptions-item>
          <el-descriptions-item label="服务地址" :span="2">{{ detail.order.location || '-' }}</el-descriptions-item>
        </el-descriptions>

        <h4 style="margin-top:16px">状态变更时间轴</h4>
        <el-timeline>
          <el-timeline-item v-for="(l, i) in detail.status_logs" :key="i" :timestamp="formatTime(l.created_at)" placement="top">
            <div><strong>{{ statusLabel(l.from) }}</strong> → <strong>{{ statusLabel(l.to) }}</strong></div>
            <div style="color:#909399;font-size:12px">{{ l.action || '-' }} · {{ l.actor || '-' }}</div>
          </el-timeline-item>
        </el-timeline>

        <h4 style="margin-top:16px">支付流水</h4>
        <el-table :data="detail.transactions" border size="small">
          <el-table-column prop="type" label="类型" width="80"><template #default="{row}">{{ txTypeLabel(row.type) }}</template></el-table-column>
          <el-table-column label="金额" width="90"><template #default="{row}">¥{{ fenToYuan(row.amount_fen) }}</template></el-table-column>
          <el-table-column prop="status" label="状态" width="80" />
          <el-table-column prop="pay_no" label="流水号" show-overflow-tooltip />
          <el-table-column label="时间" width="160"><template #default="{row}">{{ formatTime(row.created_at) }}</template></el-table-column>
        </el-table>

        <h4 v-if="detail.evaluations?.length" style="margin-top:16px">评价</h4>
        <el-table v-if="detail.evaluations?.length" :data="detail.evaluations" border size="small">
          <el-table-column prop="star" label="星" width="50" />
          <el-table-column prop="content" label="内容" show-overflow-tooltip />
          <el-table-column label="时间" width="160"><template #default="{row}">{{ formatTime(row.created_at) }}</template></el-table-column>
        </el-table>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { call } from '../api/admin.js';
import { fenToYuan, formatTime, statusLabel, txTypeLabel, STATUS_MAP } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const kw = ref(''); const stFilter = ref('');
const showDetail = ref(false); const detail = ref(null);

const statusOpts = Object.keys(STATUS_MAP);

function statusType(s) {
  const red = ['S6','S7']; const warn = ['S2','S3','S3_5','S4']; const succ = ['S5','S8','S9'];
  if (red.includes(s)) return 'danger';
  if (warn.includes(s)) return 'warning';
  if (succ.includes(s)) return 'success';
  return 'info';
}

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (kw.value) params.keyword = kw.value;
  if (stFilter.value) params.status = stFilter.value;
  const r = await call('order_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

async function onRow(row) {
  showDetail.value = true;
  const r = await call('order_detail', { order_id: row.order_id });
  if (r.ok) detail.value = r.data; else detail.value = null;
}

onMounted(load);
</script>
