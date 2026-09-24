// views/Audit.vue · 行为审计(证据链查询 + 篡改校验)
// 数据来源: admin-action audit_query(过滤/分页) + audit_verify(单用户证据链重算校验)
<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">行为审计</h3>
      <el-button :loading="loading" @click="load(1)">刷新</el-button>
    </div>

    <!-- 查询条件 -->
    <el-card style="margin-bottom:16px">
      <el-form inline label-width="80px">
        <el-form-item label="openid">
          <el-input v-model="q.openid" placeholder="openid 过滤(可空)" clearable style="width:240px" @keyup.enter="load(1)" />
        </el-form-item>
        <el-form-item label="动作">
          <el-input v-model="q.action_name" placeholder="如 config_set / notice_send" clearable style="width:180px" @keyup.enter="load(1)" />
        </el-form-item>
        <el-form-item label="类目">
          <el-select v-model="q.category" clearable placeholder="全部" style="width:120px">
            <el-option label="认证" value="auth" />
            <el-option label="业务" value="business" />
            <el-option label="安全" value="security" />
          </el-select>
        </el-form-item>
        <el-form-item label="结果">
          <el-select v-model="q.result" clearable placeholder="全部" style="width:100px">
            <el-option label="成功" value="ok" />
            <el-option label="拒绝" value="denied" />
            <el-option label="失败" value="fail" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="load(1)">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 审计记录表 -->
    <el-table :data="list" v-loading="loading" border stripe size="small" row-key="_id">
      <el-table-column type="expand">
        <template #default="{row}">
          <div style="padding:8px 16px;background:#fafafa;font-size:12px;word-break:break-all">
            <div><b>detail:</b> <code>{{ fmtDetail(row.detail) }}</code></div>
            <div v-if="row.client_ip || row.device"><b>来源:</b> IP {{ row.client_ip }} · {{ row.device }}</div>
            <div v-if="row.prev_hash"><b>prev_hash:</b> <code style="font-size:11px">{{ row.prev_hash }}</code></div>
            <div v-if="row.chain_hash"><b>chain_hash:</b> <code style="font-size:11px">{{ row.chain_hash }}</code></div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="160">
        <template #default="{row}">{{ fmtTime(row.at) }}</template>
      </el-table-column>
      <el-table-column label="openid" width="170">
        <template #default="{row}"><code style="font-size:11px">{{ row.openid }}</code></template>
      </el-table-column>
      <el-table-column label="角色" width="70">
        <template #default="{row}">{{ roleText(row.role) }}</template>
      </el-table-column>
      <el-table-column label="动作" width="140">
        <template #default="{row}"><code style="font-size:11px">{{ row.action }}</code></template>
      </el-table-column>
      <el-table-column label="对象" width="110">
        <template #default="{row}">{{ row.target_type || '-' }}</template>
      </el-table-column>
      <el-table-column label="结果" width="80">
        <template #default="{row}">
          <el-tag :type="row.result === 'ok' ? 'success' : row.result === 'denied' ? 'warning' : 'danger'" size="small">
            {{ resultText(row.result) }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center">
      <el-pagination
        background
        layout="prev, pager, next, total"
        :total="total"
        :page-size="size"
        :current-page="page"
        @current-change="load"
      />
      <el-button v-if="q.openid" type="primary" plain :loading="verifyLoading" @click="verify">
        校验 {{ q.openid }} 证据链
      </el-button>
    </div>

    <!-- 证据链校验结果 -->
    <el-dialog v-model="verifyDialog" title="证据链校验" width="560px">
      <template v-if="verifyResult">
        <el-result
          v-if="verifyResult.verdict === 'ok'"
          icon="success"
          title="链完整"
          :sub-title="`共 ${verifyResult.total} 条 · ${fmtTime(verifyResult.first_ts)} ~ ${fmtTime(verifyResult.last_ts)}`"
        />
        <template v-else>
          <el-result v-if="verifyResult.verdict === 'tampered'" icon="error" title="检测到篡改" :sub-title="`记录索引 ${verifyResult.broken?.index} · ${verifyResult.broken?.action} @ ${fmtTime(verifyResult.broken?.at)}`" />
          <el-result v-else icon="warning" title="存在分叉噪声" :sub-title="`${verifyResult.noise?.length || 0} 条前后哈希断链(并发/同毫秒写入噪声, 内容未被篡改)`" />
          <div v-if="verifyResult.noise?.length" style="max-height:200px;overflow:auto">
            <div v-for="(n,i) in verifyResult.noise" :key="i" style="font-size:12px;padding:4px 0">
              #{{ n.index }} {{ n.action }} @ {{ fmtTime(n.at) }} · {{ n.reason }}
            </div>
          </div>
        </template>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(15);
const loading = ref(false);
const verifyLoading = ref(false);
const verifyDialog = ref(false);
const verifyResult = ref(null);
const q = reactive({ openid: '', action_name: '', category: '', result: '' });

const ROLE_MAP = { admin: '管理员', user: '用户', partner: '耍伴' };
function roleText(r) { return ROLE_MAP[r] || r || '-'; }
const RESULT_MAP = { ok: '成功', denied: '拒绝', fail: '失败' };
function resultText(r) { return RESULT_MAP[r] || r || '-'; }

// 安全序列化 detail(防 JSON 循环引用: 历史脏数据或 Proxy 结构会抛错)
function fmtDetail(detail) {
  if (detail === null || detail === undefined) return '{}';
  if (typeof detail !== 'object') return String(detail);
  const seen = new WeakSet();
  try {
    return JSON.stringify(detail, (k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
  } catch (e) {
    try { return JSON.stringify(String(detail)); } catch { return '[unserializable]'; }
  }
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

async function load(p = 1) {
  loading.value = true;
  const params = { page: p, size };
  if (q.openid.trim()) params.openid = q.openid.trim();
  if (q.action_name.trim()) params.action_name = q.action_name.trim();
  if (q.category) params.category = q.category;
  if (q.result) params.result = q.result;
  const r = await call('audit_query', params);
  loading.value = false;
  if (r.ok && r.data) {
    list.value = r.data.list || [];
    total.value = r.data.total || 0;
    page.value = r.data.page || p;
    size.value = r.data.size || 15;
  } else {
    ElMessage.error(r.msg || '加载失败');
  }
}

async function verify() {
  if (!q.openid.trim()) return ElMessage.warning('请先填写 openid');
  verifyLoading.value = true;
  const r = await call('audit_verify', { openid: q.openid.trim() });
  verifyLoading.value = false;
  if (r.ok && r.data) {
    verifyResult.value = r.data;
    verifyDialog.value = true;
  } else {
    ElMessage.error(r.msg || '校验失败');
  }
}

onMounted(() => load(1));
</script>
