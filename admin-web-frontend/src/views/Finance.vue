// views/Finance.vue · 财务管理 CP1 只读闭环
// 含: finance_stats 概览 / finance_list 交易流水 / withdraw_list 提现记录 / settlement 占位禁用
<template>
  <div>
    <!-- Tabs: 概览 / 交易流水 / 提现记录 / 结算占位 -->
    <el-tabs v-model="tab">

      <!-- Tab 1: 概览 finance_stats -->
      <el-tab-pane label="财务概览" name="stats">
        <div style="margin-bottom:12px">
          <el-select v-model="days" style="width:140px;margin-right:8px">
            <el-option label="近 7 天" :value="7" />
            <el-option label="近 30 天" :value="30" />
            <el-option label="近 90 天" :value="90" />
          </el-select>
          <el-button :loading="statsLoading" @click="loadStats">刷新</el-button>
        </div>
        <el-row v-if="stats" :gutter="16">
          <el-col :span="6"><el-statistic title="GMV (¥)" :value="stats.total_gmv_fen / 100" :precision="2" /></el-col>
          <el-col :span="6"><el-statistic title="支付订单" :value="stats.order_count" /></el-col>
          <el-col :span="6"><el-statistic title="退款订单" :value="stats.refund_count" /></el-col>
          <el-col :span="6"><el-statistic title="耍伴分账 (¥)" :value="stats.total_partner_income_fen / 100" :precision="2" /></el-col>
        </el-row>
        <p v-if="stats?.trend_truncated" style="color:#E6A23C;font-size:12px;margin-top:8px">日趋势已截断 ({{ stats.trend?.length || 0 }}/5000)</p>
        <el-table v-if="stats?.trend?.length" :data="stats.trend" border size="small" style="margin-top:12px">
          <el-table-column prop="date" label="日期" width="120" />
          <el-table-column label="GMV (¥)" width="130"><template #default="{row}">{{ fenToYuan(row.gmv_fen) }}</template></el-table-column>
          <el-table-column prop="order_count" label="订单" width="80" />
          <el-table-column prop="refund_count" label="退款" width="80" />
          <el-table-column label="耍伴收入 (¥)" width="140"><template #default="{row}">{{ fenToYuan(row.partner_income_fen) }}</template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 2: 交易流水 finance_list -->
      <el-tab-pane label="交易流水" name="tx">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <el-select v-model="txType" placeholder="全部类型" clearable style="width:140px">
            <el-option label="支付" value="pay" />
            <el-option label="退款" value="refund" />
            <el-option label="小费" value="tip" />
            <el-option label="平台费" value="fee" />
          </el-select>
          <el-select v-model="txStatus" placeholder="全部状态" clearable style="width:140px">
            <el-option label="成功" value="success" />
            <el-option label="处理中" value="processing" />
            <el-option label="失败" value="failed" />
          </el-select>
          <el-button type="primary" :loading="txLoading" @click="loadTx">搜索</el-button>
        </div>
        <el-table :data="txList" v-loading="txLoading" border stripe size="small">
          <el-table-column label="类型" width="80"><template #default="{row}">{{ txTypeLabel(row.type) }}</template></el-table-column>
          <el-table-column prop="pay_no" label="流水号" width="200"><template #default="{row}"><code style="font-size:11px">{{ row.pay_no }}</code></template></el-table-column>
          <el-table-column label="金额" width="100"><template #default="{row}">¥{{ fenToYuan(row.amount_fen) }}</template></el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{row}">
              <el-tag :type="row.status==='success'?'success':row.status==='failed'?'danger':'warning'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="order_no" label="订单号" show-overflow-tooltip />
          <el-table-column prop="user_openid" label="用户" width="140"><template #default="{row}"><code style="font-size:11px">{{ row.user_openid?.slice(-10) }}</code></template></el-table-column>
          <el-table-column prop="partner_openid" label="耍伴" width="140"><template #default="{row}"><code style="font-size:11px">{{ row.partner_openid?.slice(-10) }}</code></template></el-table-column>
          <el-table-column label="时间" width="160"><template #default="{row}">{{ formatTime(row.created_at) }}</template></el-table-column>
        </el-table>
        <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
          v-model:current-page="txPage" v-model:page-size="size"
          :total="txTotal" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
          @size-change="loadTx" @current-change="loadTx" />
      </el-tab-pane>

      <!-- Tab 3: 提现记录 withdraw_list -->
      <el-tab-pane label="提现记录" name="wd">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <el-select v-model="wdStatus" placeholder="全部状态" clearable style="width:140px">
            <el-option label="待处理" value="pending" />
            <el-option label="处理中" value="processing" />
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failed" />
            <el-option label="驳回" value="rejected" />
          </el-select>
          <el-button type="primary" :loading="wdLoading" @click="loadWd">搜索</el-button>
        </div>
        <el-alert v-if="stuckCount > 0" :title="`⚠ 有 ${stuckCount} 笔 processing 挂起超 24h`" type="warning" show-icon :closable="false" style="margin-bottom:12px" />
        <el-table :data="wdList" v-loading="wdLoading" border stripe size="small">
          <el-table-column prop="withdraw_no" label="提现单号" width="200"><template #default="{row}"><code style="font-size:11px">{{ row.withdraw_no }}</code></template></el-table-column>
          <el-table-column label="类型" width="100"><template #default="{row}">{{ wdTypeLabel(row.type) }}</template></el-table-column>
          <el-table-column label="金额" width="100"><template #default="{row}">¥{{ fenToYuan(row.amount_fen) }}</template></el-table-column>
          <el-table-column label="状态" width="140">
            <template #default="{row}">
              <el-tag :type="wdStatusType(row.status)" size="small">{{ wdStatusLabel(row.status) }}</el-tag>
              <el-tag v-if="isWithdrawStuck(row)" type="danger" size="small" style="margin-left:4px">挂起</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="openid" label="用户" width="140"><template #default="{row}"><code style="font-size:11px">{{ row.openid?.slice(-10) }}</code></template></el-table-column>
          <el-table-column label="预期到账" width="160"><template #default="{row}">{{ row.expect_arrive_at ? formatTime(row.expect_arrive_at) : '-' }}</template></el-table-column>
          <el-table-column label="实际到账" width="160"><template #default="{row}">{{ row.arrived_at ? formatTime(row.arrived_at) : '-' }}</template></el-table-column>
          <el-table-column label="申请时间" width="160"><template #default="{row}">{{ formatTime(row.created_at) }}</template></el-table-column>
        </el-table>
        <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
          v-model:current-page="wdPage" v-model:page-size="size"
          :total="wdTotal" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
          @size-change="loadWd" @current-change="loadWd" />
      </el-tab-pane>

      <!-- Tab 4: 结算占位 -->
      <el-tab-pane label="结算记录" name="settle">
        <el-empty description="暂未开放：settlement 集合目前无业务写入方，待结算落库批次完成后启用">
          <el-button type="primary" link disabled>coming soon</el-button>
        </el-empty>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { call } from '../api/admin.js';
import { fenToYuan, formatTime, txTypeLabel, wdTypeLabel, wdStatusLabel, isWithdrawStuck } from '../utils/format.js';

const tab = ref('stats');
const size = ref(15);

// Stats
const stats = ref(null); const statsLoading = ref(false); const days = ref(30);

// Tx
const txList = ref([]); const txTotal = ref(0); const txPage = ref(1);
const txLoading = ref(false); const txType = ref(''); const txStatus = ref('');

// Wd
const wdList = ref([]); const wdTotal = ref(0); const wdPage = ref(1);
const wdLoading = ref(false); const wdStatus = ref('');

const stuckCount = computed(() => wdList.value.filter(isWithdrawStuck).length);

function wdStatusType(s) {
  const m = { pending: 'info', processing: 'warning', success: 'success', failed: 'danger', rejected: 'danger' };
  return m[s] || 'info';
}

async function loadStats() {
  statsLoading.value = true;
  const r = await call('finance_stats', { days: days.value });
  statsLoading.value = false;
  if (r.ok) stats.value = r.data; else stats.value = null;
}

async function loadTx() {
  txLoading.value = true;
  const params = { page: txPage.value, size: size.value };
  if (txType.value) params.type = txType.value;
  if (txStatus.value) params.status = txStatus.value;
  const r = await call('finance_list', params);
  txLoading.value = false;
  if (r.ok) { txList.value = r.data.list; txTotal.value = r.data.total; }
}

async function loadWd() {
  wdLoading.value = true;
  const params = { page: wdPage.value, size: size.value };
  if (wdStatus.value) params.status = wdStatus.value;
  const r = await call('withdraw_list', params);
  wdLoading.value = false;
  if (r.ok) { wdList.value = r.data.list; wdTotal.value = r.data.total; }
}

onMounted(async () => {
  await loadStats();
  await loadTx();
  await loadWd();
});
</script>
