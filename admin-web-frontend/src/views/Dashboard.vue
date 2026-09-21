// views/Dashboard.vue · 工作台
// 三个 action 并行加载：dashboard / withdraw_list / report_list
// dashboard action 可能因 CloudBase HTTP trigger 3s 硬限超时 → try-catch 降级
<template>
  <div>
    <!-- CloudBase HTTP trigger 超时降级提示 -->
    <el-alert
      v-if="dashboardTimeout"
      type="error"
      :closable="false"
      show-icon
      title="dashboard 超时"
      description="CloudBase HTTP trigger 超时 3s，请升级套餐。其余模块已正常加载。"
      style="margin-bottom:12px"
    />

    <!-- 概览统计（根 metrics 字段） -->
    <el-row v-loading="overviewLoading" :gutter="16">
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="注册用户" :value="metrics?.user_count ?? 0" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="耍伴" :value="metrics?.partner_count ?? 0" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="今日需求" :value="metrics?.today_demand_count ?? 0" />
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="履约中订单" :value="metrics?.active_order_count ?? 0" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top:16px">
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="待审核耍伴" :value="metrics?.pending_review_count ?? 0">
            <template #suffix>
              <el-tag size="small" type="warning" effect="plain">审核</el-tag>
            </template>
          </el-statistic>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="待处理纠纷" :value="metrics?.dispute_count ?? 0">
            <template #suffix>
              <el-tag size="small" type="danger" effect="plain">纠纷</el-tag>
            </template>
          </el-statistic>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover">
          <el-statistic title="累计 GMV (¥)" :value="fenToYuan(metrics?.gmv_fen)" :precision="2" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 任务 / 财务 / 趋势 -->
    <el-row :gutter="16" style="margin-top:16px">
      <!-- Todo -->
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600">📋 待办</span>
            </div>
          </template>
          <div v-if="todo" style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between">
              <span>待审核耍伴</span>
              <el-tag :type="todo.pending_review > 0 ? 'warning' : 'info'" size="small">{{ todo.pending_review ?? 0 }}</el-tag>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>待处理纠纷</span>
              <el-tag :type="todo.dispute > 0 ? 'danger' : 'info'" size="small">{{ todo.dispute ?? 0 }}</el-tag>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>活跃举报</span>
              <el-tag :type="todo.report_active > 0 ? 'warning' : 'info'" size="small">{{ todo.report_active ?? 0 }}</el-tag>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>支付超时订单</span>
              <el-tag :type="todo.pay_expired > 0 ? 'danger' : 'info'" size="small">{{ todo.pay_expired ?? 0 }}</el-tag>
            </div>
          </div>
          <div v-else style="color:#999">暂无数据</div>
        </el-card>
      </el-col>

      <!-- Finance -->
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600">💰 财务</span>
            </div>
          </template>
          <div v-if="finance" style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between">
              <span>GMV</span>
              <span style="font-weight:600">¥{{ fenToYuan(finance.gmv_fen) }}</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>退款</span>
              <span style="color:#e6a23c">¥{{ fenToYuan(finance.refund_fen) }}</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>小费</span>
              <span style="color:#67c23a">¥{{ fenToYuan(finance.tip_fen) }}</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>平台费</span>
              <span>¥{{ fenToYuan(finance.fee_fen) }}</span>
            </div>
          </div>
          <div v-else style="color:#999">暂无数据</div>
        </el-card>
      </el-col>

      <!-- Trend -->
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600">📈 最近 7 天</span>
            </div>
          </template>
          <div v-if="trend && trend.days?.length" style="display:flex;flex-direction:column;gap:6px;font-size:12px">
            <div style="display:grid;grid-template-columns:70px 1fr 1fr 1fr 1fr;gap:4px;font-weight:600;color:#666;padding-bottom:4px;border-bottom:1px solid #eee">
              <span>日期</span><span>用户</span><span>需求</span><span>订单</span><span>GMV</span>
            </div>
            <div
              v-for="(d, i) in trend.days"
              :key="d"
              style="display:grid;grid-template-columns:70px 1fr 1fr 1fr 1fr;gap:4px"
            >
              <span>{{ d.slice(5) }}</span>
              <span>{{ trend.users?.[i] ?? 0 }}</span>
              <span>{{ trend.demands?.[i] ?? 0 }}</span>
              <span>{{ trend.orders?.[i] ?? 0 }}</span>
              <span>¥{{ fenToYuan(trend.gmv_fen?.[i]) }}</span>
            </div>
          </div>
          <div v-else style="color:#999">暂无数据</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 下方两栏：提现挂起 + 活跃举报 -->
    <el-row :gutter="16" style="margin-top:16px">
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
              <template #default="{ row }"><code style="font-size:11px">{{ row.withdraw_no }}</code></template>
            </el-table-column>
            <el-table-column label="用户" width="120">
              <template #default="{ row }"><code style="font-size:11px">{{ row.openid?.slice(-10) }}</code></template>
            </el-table-column>
            <el-table-column label="金额" width="90">
              <template #default="{ row }">¥{{ fenToYuan(row.amount_fen) }}</template>
            </el-table-column>
            <el-table-column label="挂起时长" width="110">
              <template #default="{ row }">{{ stuckHours(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="申请时间" width="150">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-weight:600">活跃举报</span>
            </div>
          </template>
          <el-table :data="reportList" v-loading="reportLoading" border size="small" max-height="320">
            <el-table-column prop="report_id" label="ID" width="150">
              <template #default="{ row }"><code style="font-size:11px">{{ row.report_id }}</code></template>
            </el-table-column>
            <el-table-column prop="type" label="类型" width="100" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'resolved' ? 'success' : 'warning'" size="small">
                  {{ row.status === 'resolved' ? '已处理' : '处理中' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" show-overflow-tooltip />
            <el-table-column label="时间" width="150">
              <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';
import { fenToYuan, formatTime } from '../utils/format.js';

// dashboard 原始数据
const dashboardData = ref(null);
const overviewLoading = ref(false);
const dashboardTimeout = ref(false);

// 派生区块
const metrics = computed(() => dashboardData.value || null);
const todo = computed(() => dashboardData.value?.todo || null);
const finance = computed(() => dashboardData.value?.finance || null);
const trend = computed(() => dashboardData.value?.trend || null);

// Withdraw
const wdLoading = ref(false);
const wdRawList = ref([]);

// Report
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

async function loadDashboard() {
  overviewLoading.value = true;
  dashboardTimeout.value = false;
  try {
    const r = await call('dashboard');
    if (r.ok) {
      dashboardData.value = r.data;
    } else {
      // CloudBase HTTP trigger 3s 硬限：超时被 axios 拦截成 timeout
      if (String(r.code || '').includes('timeout') || String(r.msg || '').includes('timeout')) {
        dashboardTimeout.value = true;
      } else {
        ElMessage.warning(r.msg || 'dashboard 加载失败');
      }
    }
  } catch (e) {
    dashboardTimeout.value = true;
  } finally {
    overviewLoading.value = false;
  }
}

async function loadWithdraw() {
  wdLoading.value = true;
  const r = await call('withdraw_list', { status: 'processing', page: 1, size: 50 });
  wdLoading.value = false;
  if (r.ok) wdRawList.value = r.data?.list || [];
}

async function loadReports() {
  reportLoading.value = true;
  const r = await call('report_list', { status: 'active', page: 1, size: 5 });
  reportLoading.value = false;
  if (r.ok) reportList.value = r.data?.list || [];
}

async function load() {
  // 三个 action 并行；dashboard 超时不阻塞另外两个
  await Promise.all([
    loadDashboard().catch(() => {}),
    loadWithdraw().catch(() => {}),
    loadReports().catch(() => {})
  ]);
}

onMounted(load);
</script>
