// views/Notice.vue · 通知群发(分人群 system_notice 广播 → 用户消息中心)
// 后端: admin-action notice_send(群发 >1 人 10 分钟内限 1 次, 发送记录走审计日志);
// 历史记录复用 event_list type=notice_send。
<template>
  <div>
    <h3 style="margin:0 0 16px">通知群发</h3>
    <el-alert type="info" :closable="false" style="margin-bottom:16px">
      群发消息会写入用户消息中心（system_notice）。群发（&gt;1 人）10 分钟内仅可发送 1 次，发送记录自动写入审计日志。
    </el-alert>

    <el-card style="margin-bottom:16px">
      <template #header><b>发送通知</b></template>
      <el-form label-width="100px" label-position="right" style="max-width:680px">
        <el-form-item label="发送对象" required>
          <el-radio-group v-model="audience">
            <el-radio value="all">全部用户</el-radio>
            <el-radio value="partner">仅耍伴</el-radio>
            <el-radio value="user">仅普通用户</el-radio>
            <el-radio value="one">指定用户</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="audience === 'one'" label="目标 openid" required>
          <el-input v-model="targetOpenid" placeholder="用户 openid" style="width:380px" />
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="title" maxlength="30" show-word-limit placeholder="30 字以内，如：平台维护通知" style="width:380px" />
        </el-form-item>
        <el-form-item label="内容" required>
          <el-input v-model="body" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="500 字以内" style="width:520px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="sending" @click="send">发送</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card>
      <template #header>
        <b>发送记录</b>
        <el-button size="small" style="margin-left:8px" @click="loadHistory">刷新</el-button>
      </template>
      <el-table :data="history" v-loading="histLoading" border stripe size="small">
        <el-table-column label="时间" width="160">
          <template #default="{row}">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作者" width="210">
          <template #default="{row}"><code style="font-size:11px">{{ row.openid }}</code></template>
        </el-table-column>
        <el-table-column label="标题" min-width="150" show-overflow-tooltip>
          <template #default="{row}">{{ row.payload?.title }}</template>
        </el-table-column>
        <el-table-column label="对象 / 人数" width="150">
          <template #default="{row}">{{ audienceLabel(row.payload?.audience) }} · {{ row.payload?.count }} 人</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!histLoading && !history.length" description="暂无发送记录" :image-size="80" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const audience = ref('all');
const targetOpenid = ref('');
const title = ref('');
const body = ref('');
const sending = ref(false);
const history = ref([]); const histLoading = ref(false);

const AUDIENCE_LABEL = { all: '全部用户', partner: '仅耍伴', user: '仅普通用户', one: '指定用户' };
function audienceLabel(a) { return AUDIENCE_LABEL[a] || a || '-'; }

async function send() {
  if (!title.value.trim()) return ElMessage.warning('请填写标题');
  if (!body.value.trim()) return ElMessage.warning('请填写内容');
  if (audience.value === 'one' && !targetOpenid.value.trim()) return ElMessage.warning('请填写目标 openid');
  try {
    await ElMessageBox.confirm(
      `将向「${audienceLabel(audience.value)}」发送通知：\n【${title.value.trim()}】\n${body.value.trim()}\n\n确认发送？`,
      '发送确认',
      { confirmButtonText: '确认发送', cancelButtonText: '取消', type: 'warning' }
    );
  } catch { return; }
  sending.value = true;
  const r = await call('notice_send', {
    audience: audience.value,
    target_openid: targetOpenid.value.trim(),
    title: title.value.trim(),
    body: body.value.trim()
  });
  sending.value = false;
  if (r.ok && r.data) {
    ElMessage.success(`已发送 ${r.data.sent} / ${r.data.total_targets} 人`);
    title.value = ''; body.value = ''; targetOpenid.value = '';
    await loadHistory();
  } else {
    ElMessage.error(r.msg || r.code || '发送失败');
  }
}

async function loadHistory() {
  histLoading.value = true;
  const r = await call('event_list', { type: 'notice_send', page: 1, size: 20 });
  histLoading.value = false;
  if (r.ok && r.data) {
    history.value = r.data.list || [];
  }
}

onMounted(loadHistory);
</script>
