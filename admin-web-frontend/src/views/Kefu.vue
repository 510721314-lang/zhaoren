// views/Kefu.vue · 客服工作台(会话列表 + 查看消息 + 回复 + 标记处理)
// 数据源: admin-action kefu_conv_list(列表) / im_message_admin_list(消息) / kefu_conv_reply(回复)
// 安全: 仅展示脱敏昵称/角色/文本, 不暴露完整 openid 与手机号
<template>
  <div>
    <el-card shadow="never">
      <el-form inline @submit.prevent>
        <el-form-item label="处理状态">
          <el-select v-model="statusFilter" placeholder="全部" clearable style="width:160px" @change="reload">
            <el-option label="待处理" value="unhandled" />
            <el-option label="已处理" value="handled" />
          </el-select>
        </el-form-item>
        <el-form-item label="订单号">
          <el-input v-model="orderKeyword" placeholder="输入 ORD 订单号筛选" clearable style="width:220px"
            @keyup.enter="reload" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="reload">刷新</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <div style="display:flex;gap:12px;margin-top:12px;align-items:flex-start">
      <!-- 会话列表 -->
      <el-card shadow="never" style="width:360px;flex-shrink:0">
        <div v-for="c in convs" :key="c.conv_id"
          :class="['conv-item', { 'is-active': current?.conv_id === c.conv_id }]"
          @click="openConv(c)">
          <div class="conv-item-head">
            <span class="conv-item-title">{{ c.conv_type === 'kefu' ? '客服会话' : (c.scene_name || '订单会话') }}</span>
            <el-tag :type="c.kefu_status === 'handled' ? 'success' : 'warning'" size="small">
              {{ c.kefu_status === 'handled' ? '已处理' : '待处理' }}
            </el-tag>
          </div>
          <div class="conv-item-sub">{{ c.user_nickname }} ↔ {{ c.partner_nickname || '平台客服' }} · {{ c.order_no || '客服咨询' }}</div>
          <div class="conv-item-last">{{ c.last_msg_text || '(空)' }}</div>
        </div>
        <el-empty v-if="!convs.length && !loading" description="暂无会话" :image-size="60" />
        <el-pagination style="margin-top:8px;justify-content:flex-end;display:flex" small
          v-model:current-page="page" v-model:page-size="size"
          :total="total" :page-sizes="[10,20,50]" layout="total, prev, pager, next"
          @size-change="loadConvs" @current-change="loadConvs" />
      </el-card>

      <!-- 消息 + 回复 -->
      <el-card shadow="never" style="flex:1;min-width:0">
        <template v-if="current">
          <div style="margin-bottom:8px">
            会话 {{ current.conv_id?.slice(-10) }} · 订单 {{ current.order_no || current.order_id?.slice(-10) }}
            <el-button size="small" type="primary" plain style="float:right"
              :disabled="current.kefu_status === 'handled'" @click="markHandled">标记已处理</el-button>
          </div>
          <el-table :data="msgs" v-loading="msgLoading" border stripe size="small">
            <el-table-column prop="created_at" label="时间" width="160">
              <template #default="{row}">{{ formatTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column label="发送方" width="120">
              <template #default="{row}">
                <el-tag :type="row.from_role === 'kefu' ? 'danger' : row.from_role === 'partner' ? 'warning' : 'primary'" size="small">
                  {{ row.from_role === 'kefu' ? '客服' : row.from_role === 'partner' ? '耍伴' : '用户' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="内容" min-width="240">
              <template #default="{row}">
                <div class="msg-cell">
                  <div v-if="row.quote" class="msg-quote">
                    <span class="msg-quote-from">{{ quoteRoleLabel(row.quote.from_role) }}</span>
                    <span class="msg-quote-text">{{ row.quote.text }}</span>
                  </div>
                  <div class="msg-cell-main">
                    <span :class="{ 'im-degraded': row.sec_degraded }">{{ row.text }}</span>
                    <el-tag v-if="row.sec_degraded" type="danger" size="small" style="margin-left:6px">未过安检</el-tag>
                    <el-tag v-else-if="row.type === 'template'" type="info" size="small" style="margin-left:6px">模板</el-tag>
                    <el-button class="msg-quote-btn" type="primary" link size="small" @click="setQuote(row)">引用</el-button>
                  </div>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination style="margin-top:8px;justify-content:flex-end;display:flex" small
            v-model:current-page="msgPage" v-model:page-size="msgSize"
            :total="msgTotal" :page-sizes="[10,20,50]" layout="total, prev, pager, next"
            @size-change="loadMsgs" @current-change="loadMsgs" />

          <div v-if="quoteMsg" class="reply-quote">
            <span class="reply-quote-text">引用 {{ quoteMsg.quoteLabel }}：{{ quoteMsg.text }}</span>
            <el-button type="danger" link size="small" @click="clearQuote">×</el-button>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <el-input v-model="replyText" placeholder="输入回复内容（发送后自动标记已处理）" maxlength="500" show-word-limit clearable
              @keyup.enter="sendReply" />
            <el-button type="primary" :loading="replying" @click="sendReply">回复</el-button>
          </div>
        </template>
        <el-empty v-else description="从左侧选择会话" :image-size="80" />
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const convs = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(20);
const loading = ref(false);
const statusFilter = ref('');
const orderKeyword = ref('');

const current = ref(null);
const msgs = ref([]);
const msgTotal = ref(0);
const msgPage = ref(1);
const msgSize = ref(20);
const msgLoading = ref(false);
const replyText = ref('');
const replying = ref(false);
const quoteMsg = ref(null);

// 角色 → 中文(引用快照/发送方列复用)
function roleLabel(role) {
  return role === 'kefu' ? '客服' : role === 'partner' ? '耍伴' : '用户';
}
function quoteRoleLabel(role) {
  return `[${roleLabel(role)}]`;
}

// 点击消息行「引用」: 记录待引用消息(发送时随 reply 提交)
function setQuote(row) {
  quoteMsg.value = { msg_id: row.msg_id, text: row.text || '', quoteLabel: quoteRoleLabel(row.from_role) };
}
function clearQuote() {
  quoteMsg.value = null;
}

async function loadConvs() {
  loading.value = true;
  const payload = { page: page.value, size: size.value };
  if (statusFilter.value) payload.kefu_status = statusFilter.value;
  const kw = String(orderKeyword.value || '').trim().toUpperCase();
  if (kw) payload.order_no = kw;
  const r = await call('kefu_conv_list', payload);
  loading.value = false;
  if (r.ok) {
    convs.value = r.data?.list ?? [];
    total.value = r.data?.total ?? 0;
  } else {
    ElMessage.error(r.msg || '会话列表加载失败');
  }
}

function reload() {
  page.value = 1;
  current.value = null;
  msgs.value = [];
  loadConvs();
}

async function openConv(c) {
  current.value = c;
  msgPage.value = 1;
  loadMsgs();
}

async function loadMsgs() {
  if (!current.value) return;
  msgLoading.value = true;
  const r = await call('im_message_admin_list', {
    conv_id: current.value.conv_id, page: msgPage.value, size: msgSize.value
  });
  msgLoading.value = false;
  if (r.ok) {
    msgs.value = r.data?.list ?? [];
    msgTotal.value = r.data?.total ?? 0;
  } else {
    ElMessage.error(r.msg || '消息加载失败');
  }
}

async function sendReply() {
  if (!current.value) return;
  const text = String(replyText.value || '').trim();
  if (!text) { ElMessage.warning('请输入回复内容'); return; }
  replying.value = true;
  const payload = { conv_id: current.value.conv_id, text };
  if (quoteMsg.value) payload.quote = { msg_id: quoteMsg.value.msg_id };
  const r = await call('kefu_conv_reply', payload);
  replying.value = false;
  if (r.ok) {
    ElMessage.success('已回复并标记处理');
    replyText.value = '';
    clearQuote();
    // 刷新消息 + 会话状态 + 列表
    await loadMsgs();
    current.value.kefu_status = 'handled';
    await loadConvs();
  } else {
    ElMessage.error(r.msg || '回复失败');
  }
}

async function markHandled() {
  if (!current.value) return;
  const text = '客服已标记该会话处理完毕。';
  const r = await call('kefu_conv_reply', { conv_id: current.value.conv_id, text });
  if (r.ok) {
    ElMessage.success('已标记处理');
    current.value.kefu_status = 'handled';
    await loadMsgs();
    await loadConvs();
  } else {
    ElMessage.error(r.msg || '操作失败');
  }
}

onMounted(loadConvs);
</script>

<style scoped>
.conv-item { padding: 10px 12px; border: 1px solid var(--el-border-color); border-radius: 8px; margin-bottom: 8px; cursor: pointer; }
.conv-item:hover { border-color: var(--el-color-primary); }
.conv-item.is-active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.conv-item-head { display: flex; justify-content: space-between; align-items: center; }
.conv-item-title { font-weight: 600; font-size: 13px; }
.conv-item-sub { margin-top: 4px; font-size: 12px; color: var(--el-text-color-secondary); }
.conv-item-last { margin-top: 4px; font-size: 12px; color: var(--el-text-color-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.im-degraded { color: #d03050; }
.msg-cell { line-height: 1.5; }
.msg-quote { display: flex; gap: 6px; align-items: baseline; background: var(--el-fill-color-light); border-left: 3px solid var(--el-color-primary-light-5); padding: 4px 8px; margin-bottom: 4px; border-radius: 4px; font-size: 12px; color: var(--el-text-color-secondary); }
.msg-quote-from { color: var(--el-color-primary); font-weight: 600; flex-shrink: 0; }
.msg-quote-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg-quote-btn { margin-left: 8px; }
.reply-quote { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: var(--el-color-primary-light-9); border-radius: 4px; padding: 4px 8px; margin-top: 12px; font-size: 12px; color: var(--el-text-color-secondary); }
.reply-quote-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
