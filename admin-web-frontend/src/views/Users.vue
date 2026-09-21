// views/Users.vue · 用户管理 CP1 只读闭环
<template>
  <div>
    <!-- 工具栏 -->
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <el-input v-model="kw" placeholder="openid / 昵称" clearable style="width:240px" @keyup.enter="load" />
      <el-select v-model="isPartner" placeholder="全部角色" clearable style="width:140px">
        <el-option label="仅耍伴" :value="true" />
      </el-select>
      <el-select v-model="stFilter" placeholder="全部状态" clearable style="width:140px">
        <el-option label="正常" value="normal" />
        <el-option label="冻结" value="frozen" />
        <el-option label="封禁" value="banned" />
      </el-select>
      <el-button type="primary" :loading="loading" @click="load">搜索</el-button>
    </div>

    <!-- 表格 -->
    <el-table :data="list" v-loading="loading" border stripe size="small" @row-click="onRow" highlight-current-row>
      <el-table-column prop="openid" label="OpenID" width="200">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.openid?.slice(-12) }}</span></template>
      </el-table-column>
      <el-table-column prop="nickname" label="昵称" min-width="140" show-overflow-tooltip />
      <el-table-column label="角色" width="110">
        <template #default="{row}">{{ roleTag(row.roles) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{row}"><el-tag :type="statusTag(row.status).type" size="small">{{ statusTag(row.status).text }}</el-tag></template>
      </el-table-column>
      <el-table-column label="实名" width="70">
        <template #default="{row}"><el-tag v-if="row.is_realname_done" type="success" size="small">已</el-tag><span v-else>-</span></template>
      </el-table-column>
      <el-table-column prop="user_credit_score" label="信用分" width="80" sortable />
      <el-table-column prop="phone" label="手机号" width="120" />
      <el-table-column label="注册时间" width="160">
        <template #default="{row}">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 详情抽屉 -->
    <el-drawer v-model="showDetail" title="用户详情" size="640px">
      <div v-if="detail" style="margin-bottom:16px">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="OpenID"><code>{{ detail.user.openid }}</code></el-descriptions-item>
          <el-descriptions-item label="昵称">{{ detail.user.nickname }}</el-descriptions-item>
          <el-descriptions-item label="角色">{{ roleTag(detail.user.roles) }}</el-descriptions-item>
          <el-descriptions-item label="信用分">{{ detail.user.user_credit_score }}</el-descriptions-item>
          <el-descriptions-item label="实名状态">{{ detail.user.is_realname_done ? '已认证' : '未认证' }}</el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ formatTime(detail.user.created_at) }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.contact" label="紧急联系人">{{ detail.contact.name }} / {{ detail.contact.phone }}</el-descriptions-item>
        </el-descriptions>
      </div>
      <h4 style="margin-top:16px">信用流水 <el-button size="small" text @click="loadLogs">刷新</el-button></h4>
      <el-table :data="logs" v-loading="logsLoading" border size="small">
        <el-table-column label="时间" width="160"><template #default="{row}">{{ formatTime(row.created_at) }}</template></el-table-column>
        <el-table-column prop="type" label="类型" width="100" />
        <el-table-column label="变动" width="80">
          <template #default="{row}"><span :style="{color: row.delta > 0 ? '#67C23A' : '#F56C6C'}">{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}</span></template>
        </el-table-column>
        <el-table-column prop="score" label="后分" width="80" />
        <el-table-column prop="reason" label="原因" show-overflow-tooltip />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { call } from '../api/admin.js';
import { fenToYuan, formatTime, roleTag, statusTag } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const kw = ref(''); const isPartner = ref(null); const stFilter = ref('');

const showDetail = ref(false); const detail = ref(null);
const logs = ref([]); const logsLoading = ref(false);

async function load() {
  loading.value = true;
  const params = { page: page.value, size: size.value };
  if (kw.value) params.keyword = kw.value;
  if (isPartner.value !== null) params.is_partner = isPartner.value;
  if (stFilter.value) params.status = stFilter.value;
  const r = await call('user_list', params);
  loading.value = false;
  if (r.ok) { list.value = r.data.list; total.value = r.data.total; }
}

async function onRow(row) {
  showDetail.value = true;
  const r = await call('user_detail', { target_openid: row.openid });
  if (r.ok) detail.value = r.data; else detail.value = null;
  await loadLogs(row.openid);
}

async function loadLogs(openid) {
  logsLoading.value = true;
  const r = await call('credit_log_list', { target_openid: openid || detail.value?.user?.openid, page: 1, size: 20 });
  logsLoading.value = false;
  if (r.ok) logs.value = r.data.list; else logs.value = [];
}

onMounted(load);
</script>
