// views/Accounts.vue · 后台账号管理(RBAC S1, 仅 R1 超管)
// 列表/创建/启用禁用; 角色: R1超管 / R2审核 / R3运营
<template>
  <div>
    <el-card shadow="never">
      <el-form inline @submit.prevent>
        <el-form-item label="登录名">
          <el-input v-model="form.account" placeholder="3-20位字母/数字/下划线" maxlength="20" style="width:200px" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" placeholder="至少8位" show-password style="width:160px" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width:110px">
            <el-option label="R1 超管" value="R1" />
            <el-option label="R2 审核" value="R2" />
            <el-option label="R3 运营" value="R3" />
          </el-select>
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="form.display_name" maxlength="30" style="width:140px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="creating" @click="create">创建账号</el-button>
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" style="margin-bottom:12px">
        最小权限: R2 审核可处理审核/举报/IM 监管; R3 运营可查用户/订单/配置/活动; 导出/配置写入/提现审批仅 R1。提现审批需两个不同账号双人复核。
      </el-alert>
    </el-card>

    <el-table :data="list" v-loading="loading" border stripe size="small" style="margin-top:12px">
      <el-table-column prop="account" label="登录名" width="160" />
      <el-table-column label="角色" width="120">
        <template #default="{row}">
          <el-tag :type="row.role==='R1'?'danger':row.role==='R2'?'warning':'primary'" size="small">
            {{ {R1:'超管',R2:'审核',R3:'运营'}[row.role] || row.role }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="display_name" label="姓名" width="160" />
      <el-table-column label="状态" width="100">
        <template #default="{row}">
          <el-tag :type="row.status==='active'?'success':'info'" size="small">{{ row.status==='active'?'启用':'禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" min-width="170">
        <template #default="{row}">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{row}">
          <el-button size="small" :type="row.status==='active'?'danger':'success'" plain @click="toggle(row)">
            {{ row.status==='active' ? '禁用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]);
const loading = ref(false);
const creating = ref(false);
const form = ref({ account: '', password: '', role: 'R3', display_name: '' });

async function load() {
  loading.value = true;
  const r = await call('admin_account_list');
  loading.value = false;
  if (r.ok) list.value = r.data?.list || [];
  else ElMessage.error(r.msg || r.code);
}

async function create() {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.value.account)) return ElMessage.warning('登录名格式不符');
  if (!form.value.password || form.value.password.length < 8) return ElMessage.warning('密码至少8位');
  creating.value = true;
  const r = await call('admin_account_create', { ...form.value });
  creating.value = false;
  if (r.ok) {
    ElMessage.success('已创建');
    form.value = { account: '', password: '', role: 'R3', display_name: '' };
    await load();
  } else ElMessage.error(r.msg || r.code);
}

async function toggle(row) {
  const r = await call('admin_account_set_status', { account: row.account, status: row.status === 'active' ? 'disabled' : 'active' });
  if (r.ok) { ElMessage.success('已更新'); await load(); }
  else ElMessage.error(r.msg || r.code);
}

onMounted(load);
</script>