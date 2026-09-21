// views/Users.vue · 用户管理 CP2 写操作接通 (冻结/解冻/封禁/解封/信用调整/V3 处罚)
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
        <el-option label="暂停" value="suspended" />
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
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{row}">
          <el-button v-if="row.status === 'normal'" size="small" type="warning"
            :loading="busy === row.openid" @click.stop="openSimple(row, 'freeze')">冻结</el-button>
          <el-button v-if="row.status === 'frozen'" size="small" type="success"
            :loading="busy === row.openid" @click.stop="doUnfreeze(row)">解冻</el-button>
          <el-button v-if="row.status !== 'banned'" size="small" type="danger"
            :loading="busy === row.openid" @click.stop="openSimple(row, 'ban')">封禁</el-button>
          <el-button v-if="row.status === 'banned'" size="small" type="success"
            :loading="busy === row.openid" @click.stop="doUnban(row)">解封</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[15,30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />

    <!-- 详情抽屉 -->
    <el-drawer v-model="showDetail" title="用户详情" size="640px">
      <div v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="OpenID"><code>{{ detail.user.openid }}</code></el-descriptions-item>
          <el-descriptions-item label="昵称">{{ detail.user.nickname }}</el-descriptions-item>
          <el-descriptions-item label="角色">{{ roleTag(detail.user.roles) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTag(detail.user.status).type" size="small">{{ statusTag(detail.user.status).text }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="用户信用分">{{ detail.user.user_credit_score }}</el-descriptions-item>
          <el-descriptions-item label="耍伴信用分">{{ detail.user.partner_credit_score }}</el-descriptions-item>
          <el-descriptions-item label="实名状态">{{ detail.user.is_realname_done ? '已认证' : '未认证' }}</el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ formatTime(detail.user.created_at) }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.emergency_contact" label="紧急联系人" :span="2">
            {{ detail.emergency_contact.name }} / {{ detail.emergency_contact.phone }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.user.banned_reason" label="封禁原因" :span="2">
            {{ detail.user.banned_reason }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 管理操作区 -->
        <h4 style="margin-top:20px;margin-bottom:8px">账户操作</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <el-button size="small" type="primary" plain @click="openCredit(detail.user)">信用调整</el-button>
          <el-button size="small" type="danger" plain @click="openPenalty(detail.user)">V3 处罚</el-button>
          <el-button v-if="detail.user.status === 'normal'" size="small" type="warning" plain
            @click="openSimple(detail.user, 'freeze')">冻结</el-button>
          <el-button v-if="detail.user.status === 'frozen'" size="small" type="success" plain
            @click="doUnfreeze(detail.user)">解冻</el-button>
          <el-button v-if="detail.user.status !== 'banned'" size="small" type="danger" plain
            @click="openSimple(detail.user, 'ban')">封禁</el-button>
          <el-button v-if="detail.user.status === 'banned'" size="small" type="success" plain
            @click="doUnban(detail.user)">解封</el-button>
        </div>

        <h4 style="margin-top:20px">信用流水 <el-button size="small" text @click="loadLogs(detail.user.openid)">刷新</el-button></h4>
        <el-table :data="logs" v-loading="logsLoading" border size="small">
          <el-table-column label="时间" width="160"><template #default="{row}">{{ formatTime(row.created_at) }}</template></el-table-column>
          <el-table-column prop="type" label="类型" width="100" />
          <el-table-column label="变动" width="80">
            <template #default="{row}"><span :style="{color: row.delta > 0 ? '#67C23A' : '#F56C6C'}">{{ row.delta > 0 ? '+' : '' }}{{ row.delta }}</span></template>
          </el-table-column>
          <el-table-column prop="score" label="后分" width="80" />
          <el-table-column prop="reason" label="原因" show-overflow-tooltip />
        </el-table>
      </div>
    </el-drawer>

    <!-- 通用原因弹窗 (冻结/封禁) -->
    <el-dialog v-model="simpleDialog" :title="simpleTitle" width="480px">
      <el-form label-position="top">
        <el-form-item label="目标用户">
          <span>{{ simpleTarget?.nickname || simpleTarget?.openid?.slice(-12) }}</span>
        </el-form-item>
        <el-form-item label="原因" :required="simpleReasonRequired">
          <el-input v-model="simpleReason" type="textarea" :rows="3"
            :placeholder="simpleType === 'ban' ? '请填写封禁原因(必填)' : '可选, 填写后记录到审计日志'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="simpleDialog = false">取消</el-button>
        <el-button :type="simpleType === 'ban' ? 'danger' : 'warning'" :loading="submitting" @click="doSimple">确认</el-button>
      </template>
    </el-dialog>

    <!-- 信用调整弹窗 -->
    <el-dialog v-model="creditDialog" title="信用分调整" width="500px">
      <el-form label-position="top" :model="creditForm">
        <el-form-item label="目标用户">
          <span>{{ creditTarget?.nickname || creditTarget?.openid?.slice(-12) }}</span>
          <span style="margin-left:12px;color:#909399">当前: {{ creditTarget?.user_credit_score ?? '-' }} / {{ creditTarget?.partner_credit_score ?? '-' }}</span>
        </el-form-item>
        <el-form-item label="调整类型" required>
          <el-radio-group v-model="creditForm.score_type">
            <el-radio value="user">用户信用分</el-radio>
            <el-radio value="partner">耍伴信用分</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="调整分值" required>
          <el-input-number v-model="creditForm.delta" :min="-100" :max="100" :step="1" />
          <span style="margin-left:8px;color:#909399">非零整数, 范围 -100 ~ +100</span>
        </el-form-item>
        <el-form-item label="调整原因" required>
          <el-input v-model="creditForm.reason" type="textarea" :rows="3" placeholder="请填写调整原因, 记录到审计日志" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="creditDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="doCredit">确认调整</el-button>
      </template>
    </el-dialog>

    <!-- V3 处罚弹窗 -->
    <el-dialog v-model="penaltyDialog" title="V3 分级处罚" width="500px">
      <el-form label-position="top" :model="penaltyForm">
        <el-form-item label="目标用户">
          <span>{{ penaltyTarget?.nickname || penaltyTarget?.openid?.slice(-12) }}</span>
        </el-form-item>
        <el-form-item label="处罚级别" required>
          <el-select v-model="penaltyForm.level" placeholder="选择级别" style="width:100%">
            <el-option label="警告(仅记录)" value="warning" />
            <el-option label="暂停 7 天" value="suspend_7d" />
            <el-option label="永久封号" value="ban" />
          </el-select>
        </el-form-item>
        <el-form-item label="处罚原因" required>
          <el-input v-model="penaltyForm.reason" type="textarea" :rows="3" placeholder="请填写处罚原因, 记录到审计日志" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="penaltyDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="doPenalty">确认处罚</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime, roleTag, statusTag } from '../utils/format.js';

const list = ref([]); const total = ref(0); const page = ref(1); const size = ref(15);
const loading = ref(false); const kw = ref(''); const isPartner = ref(null); const stFilter = ref('');

const showDetail = ref(false); const detail = ref(null);
const logs = ref([]); const logsLoading = ref(false);
const busy = ref('');
const submitting = ref(false);

// 简单动作弹窗 (freeze/ban)
const simpleDialog = ref(false);
const simpleType = ref(''); // 'freeze' | 'ban'
const simpleTarget = ref(null);
const simpleReason = ref('');

// 信用调整弹窗
const creditDialog = ref(false);
const creditTarget = ref(null);
const creditForm = ref({ score_type: 'user', delta: 0, reason: '' });

// V3 处罚弹窗
const penaltyDialog = ref(false);
const penaltyTarget = ref(null);
const penaltyForm = ref({ level: 'warning', reason: '' });

const simpleTitle = computed(() => simpleType.value === 'ban' ? '封禁用户' : '冻结用户');
const simpleReasonRequired = computed(() => simpleType.value === 'ban');

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

// 通用原因弹窗
function openSimple(user, type) {
  simpleTarget.value = user;
  simpleType.value = type;
  simpleReason.value = '';
  simpleDialog.value = true;
}

async function doSimple() {
  if (simpleReasonRequired.value && !simpleReason.value.trim()) {
    ElMessage.warning('请填写原因');
    return;
  }
  submitting.value = true;
  const target = simpleTarget.value;
  const action = simpleType.value === 'ban' ? 'user_ban' : 'user_freeze';
  const r = await call(action, {
    target_openid: target.openid,
    reason: simpleReason.value.trim() || undefined
  });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data?.msg || '操作成功');
    simpleDialog.value = false;
    await load();
    if (detail.value?.user?.openid === target.openid) await refreshDetail(target.openid);
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

async function doUnfreeze(user) {
  try {
    await ElMessageBox.confirm(`确认解冻用户「${user.nickname || user.openid?.slice(-12)}」?`, '操作确认',
      { confirmButtonText: '确认解冻', cancelButtonText: '取消', type: 'success' });
  } catch (_) { return; }
  busy.value = user.openid;
  const r = await call('user_unfreeze', { target_openid: user.openid });
  busy.value = '';
  if (r.ok) {
    ElMessage.success('已解冻');
    await load();
    if (detail.value?.user?.openid === user.openid) await refreshDetail(user.openid);
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

async function doUnban(user) {
  try {
    await ElMessageBox.confirm(`确认解封用户「${user.nickname || user.openid?.slice(-12)}」?`, '操作确认',
      { confirmButtonText: '确认解封', cancelButtonText: '取消', type: 'success' });
  } catch (_) { return; }
  busy.value = user.openid;
  const r = await call('user_unban', { target_openid: user.openid });
  busy.value = '';
  if (r.ok) {
    ElMessage.success('已解封');
    await load();
    if (detail.value?.user?.openid === user.openid) await refreshDetail(user.openid);
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

// 信用调整
function openCredit(user) {
  creditTarget.value = user;
  creditForm.value = { score_type: 'user', delta: 0, reason: '' };
  creditDialog.value = true;
}

async function doCredit() {
  if (!creditForm.value.delta || creditForm.value.delta === 0) {
    ElMessage.warning('调整分值须为非零整数');
    return;
  }
  if (!creditForm.value.reason.trim()) {
    ElMessage.warning('请填写调整原因');
    return;
  }
  submitting.value = true;
  const target = creditTarget.value;
  const r = await call('user_credit_adjust', {
    target_openid: target.openid,
    score_type: creditForm.value.score_type,
    delta: creditForm.value.delta,
    reason: creditForm.value.reason.trim()
  });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data?.msg || '调整成功');
    creditDialog.value = false;
    await load();
    if (detail.value?.user?.openid === target.openid) await refreshDetail(target.openid);
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

// V3 处罚
function openPenalty(user) {
  penaltyTarget.value = user;
  penaltyForm.value = { level: 'warning', reason: '' };
  penaltyDialog.value = true;
}

async function doPenalty() {
  if (!penaltyForm.value.reason.trim()) {
    ElMessage.warning('请填写处罚原因');
    return;
  }
  submitting.value = true;
  const target = penaltyTarget.value;
  const r = await call('penalty', {
    target_openid: target.openid,
    level: penaltyForm.value.level,
    reason: penaltyForm.value.reason.trim()
  });
  submitting.value = false;
  if (r.ok) {
    ElMessage.success(r.data?.msg || '处罚已执行');
    penaltyDialog.value = false;
    await load();
    if (detail.value?.user?.openid === target.openid) await refreshDetail(target.openid);
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}

async function refreshDetail(openid) {
  const r = await call('user_detail', { target_openid: openid });
  if (r.ok) detail.value = r.data;
  await loadLogs(openid);
}

onMounted(load);
</script>
