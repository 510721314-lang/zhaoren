// views/PartnerProfileReview.vue · 耍伴资料审核（bio/技能/亮点）
// 列表来自 admin-action partner_profile_pending_list（含当前快照 vs 待审对比）
// 写操作：partner_profile_review（approve 覆盖快照留 prev / reject 留原因 + 通知）
<template>
  <div>
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:600">耍伴资料待审</span>
      <el-tag type="warning" size="small" v-if="total">{{ total }} 条</el-tag>
      <el-button type="primary" plain :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border stripe size="small" row-key="openid">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div style="padding:8px 16px;display:flex;gap:24px;flex-wrap:wrap">
            <!-- 当前已展示快照 -->
            <div style="flex:1;min-width:200px">
              <div style="font-weight:600;margin-bottom:6px;color:#606266">当前已展示（审核通过快照）</div>
              <div style="font-size:13px;color:#666">
                <div v-if="!row.current.bio && !row.current.skills.length && !row.current.highlights.length">（暂无可展示资料）</div>
                <template v-else>
                  <div v-if="row.current.bio"><b>简介：</b>{{ row.current.bio }}</div>
                  <div v-if="row.current.skills.length"><b>技能：</b><el-tag v-for="s in row.current.skills" :key="s" size="small" style="margin-right:6px">{{ s }}</el-tag></div>
                  <div v-if="row.current.highlights.length"><b>亮点：</b><el-tag v-for="h in row.current.highlights" :key="h" size="small" type="success" style="margin-right:6px">{{ h }}</el-tag></div>
                </template>
              </div>
            </div>
            <!-- 待审新内容 -->
            <div style="flex:1;min-width:200px">
              <div style="font-weight:600;margin-bottom:6px;color:#e6a23c">待审新内容</div>
              <div style="font-size:13px;color:#333">
                <div v-if="!row.pending.bio && !row.pending.skills.length && !row.pending.highlights.length">（空）</div>
                <template v-else>
                  <div v-if="row.pending.bio"><b>简介：</b>{{ row.pending.bio }}</div>
                  <div v-if="row.pending.skills.length"><b>技能：</b><el-tag v-for="s in row.pending.skills" :key="s" size="small" style="margin-right:6px">{{ s }}</el-tag></div>
                  <div v-if="row.pending.highlights.length"><b>亮点：</b><el-tag v-for="h in row.pending.highlights" :key="h" size="small" type="success" style="margin-right:6px">{{ h }}</el-tag></div>
                </template>
              </div>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column prop="nickname" label="昵称" min-width="140" show-overflow-tooltip />
      <el-table-column label="OpenID" width="170">
        <template #default="{ row }"><span style="font-family:monospace;font-size:11px">{{ maskOpenid(row.openid) }}</span></template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatTime(row.submitted_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="success" :loading="busy === row.openid" @click="doApprove(row)">通过</el-button>
          <el-button size="small" type="danger" :loading="busy === row.openid" @click="openReject(row)">驳回</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size" :total="total"
      :page-sizes="[15, 30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load"
    />

    <el-dialog v-model="rejectDialog" title="驳回耍伴资料" width="480px">
      <el-form label-position="top">
        <el-form-item label="被驳回耍伴"><span>{{ rejectTarget?.nickname || rejectTarget?.openid }}</span></el-form-item>
        <el-form-item label="驳回原因" required>
          <el-input v-model="rejectNote" type="textarea" :rows="3" placeholder="请填写驳回原因，将反馈给耍伴" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="doReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(15);
const loading = ref(false);
const busy = ref('');
const rejectDialog = ref(false);
const rejectNote = ref('');
const rejectTarget = ref(null);
const submitting = ref(false);

function maskOpenid(openid) {
  if (!openid) return '-';
  if (openid.length <= 10) return openid;
  return openid.slice(0, 4) + '****' + openid.slice(-6);
}

async function load() {
  loading.value = true;
  const r = await call('partner_profile_pending_list', { page: page.value, size: size.value });
  loading.value = false;
  if (r.ok) {
    list.value = r.data?.list || [];
    total.value = r.data?.total || 0;
  } else {
    ElMessage.error(r.msg || '加载待审列表失败');
  }
}

async function doApprove(row) {
  try {
    await ElMessageBox.confirm(
      `确认通过耍伴「${row.nickname || row.openid}」的资料？`,
      '操作确认',
      { confirmButtonText: '确认通过', cancelButtonText: '取消', type: 'success' }
    );
  } catch (_) { return; }
  busy.value = row.openid;
  const r = await call('partner_profile_review', { target_openid: row.openid, pass: true, reason: '' });
  busy.value = '';
  if (r.ok) { ElMessage.success('已通过'); await load(); }
  else ElMessage.error(r.msg || '操作失败');
}

function openReject(row) {
  rejectTarget.value = row;
  rejectNote.value = '';
  rejectDialog.value = true;
}

async function doReject() {
  if (!rejectNote.value.trim()) { ElMessage.warning('请填写驳回原因'); return; }
  submitting.value = true;
  const target = rejectTarget.value;
  const r = await call('partner_profile_review', { target_openid: target.openid, pass: false, reason: rejectNote.value.trim() });
  submitting.value = false;
  if (r.ok) { ElMessage.success('已驳回'); rejectDialog.value = false; await load(); }
  else ElMessage.error(r.msg || '操作失败');
}

onMounted(load);
</script>