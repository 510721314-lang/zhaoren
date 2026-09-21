// views/Dashboard.vue · 工作台
<template>
  <div>
    <!-- 概览统计 -->
    <el-row v-loading="overviewLoading" :gutter="16">
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="今日订单" :value="overview?.today_order_count ?? 0" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="今日 GMV (¥)" :value="(overview?.today_gmv_fen ?? 0) / 100" :precision="2" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="今日新增用户" :value="overview?.today_new_user_count ?? 0" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="待处理纠纷" :value="overview?.pending_dispute_count ?? 0" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 下方两栏 -->
    <el-row :gutter="16" style="margin-top:16px">
      <!-- 左: 提现挂起超 24h -->
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600">⚠ 提现挂起 (processing 超 24h)</span>
              <el-tag v-if="stuckWdList.length" type="danger" size="small">{{ stuckWdList.length }} 笔</el-tag>
              <el-tag v-else type="success" size="small">正常</el-tag>
            </div>
          </template>
          <el-table :data="stuckWdList" v-loading="wdLoading" border size="small" max-height="320">
            <el-table-column prop="withdraw_no" label="单号" width="180">
              <template #default="{row}"><code style="font-size:11px">{{ row.withdraw_no }}</code></template>
            </el-table-column>
            <el-table-column label="用户" width="120">
              <template #default="{row}"><code style="font-size:11px">{{ row.openid?.slice(-10) }}</code></template>
            </el-table-column>
            <el-table-column label="金额" width="90">
              <template #default="{row}">¥{{ fenToYuan(row.amount_fen) }}</template>
            </el-table-column>
            <el-table-column label="挂起时长" width="110">
              <template #default="{row}">{{ stuckHours(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="申请时间" width="150">
              <template #default="{row}">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <!-- 右: 最新举报 -->
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600">最新举报</span>
            </div>
          </template>
          <el-table :data="reportList" v-loading="reportLoading" border size="small" max-height="320">
            <el-table-column prop="report_id" label="ID" width="150">
              <template #default="{row}"><code style="font-size:11px">{{ row.report_id }}</code></template>
            </el-table-column>
            <el-table-column prop="type" label="类型" width="100" />
            <el-table-column label="状态" width="90">
              <template #default="{row}">
                <el-tag :type="row.status === 'resolved' ? 'success' : 'warning'" size="small">
                  {{ row.status === 'resolved' ? '已处理' : '处理中' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" show-overflow-tooltip />
            <el-table-column label="时间" width="150">
              <template #default="{row}">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { call } from '../api/admin.js';
import { fenToYuan, formatTime } from '../utils/format.js';

// Overview
const overview = ref(null);
const overviewLoading = ref(false);

// Withdraw stuck list
const wdLoading = ref(false);
const wdRawList = ref([]);

// Report list
const reportLoading = ref(false);
const reportList = ref([]);

const stuckWdList = computed(() => {
  const THRESHOLD = 24 * 3600 * 1000;
  return wdRawList.value.filter(
    (w) => w.status === 'processing' && w.created_at && Date.now() - Number(w.created_at) > THRESHOLD
  );
});

function stuckHours(createdAt) {
  if (!createdAt) return '-';
  const hours = (Date.now() - Number(createdAt)) / 3600000;
  return `${hours.toFixed(1)}h`;
}

async function loadOverview() {
  overviewLoading.value = true;
  const r = await call('dashboard');
  overviewLoading.value = false;
  if (r.ok) overview.value = r.data;
}

async function loadWithdraw() {
  wdLoading.value = true;
  const r = await call('withdraw_list', { status: 'processing', page: 1, size: 50 });
  wdLoading.value = false;
  if (r.ok) wdRawList.value = r.data.list || [];
}

async function loadReports() {
  reportLoading.value = true;
  const r = await call('report_list', { page: 1, size: 5 });
  reportLoading.value = false;
  if (r.ok) reportList.value = r.data.list || [];
}

async function load() {
  await Promise.all([loadOverview(), loadWithdraw(), loadReports()]);
}

onMounted(load);
</script>
