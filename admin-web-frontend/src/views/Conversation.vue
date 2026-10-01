// views/Conversation.vue · 会话监管（IM 消息只读调取，供纠纷仲裁 / 合规留痕）
// 入口: 顶部订单号 / 会话 ID 搜索 → 展示该会话全部消息(按时间正序) + 会话概要
// 安全: 仅展示昵称/角色/文本, 不暴露完整 openid 与手机号; 不提供导出
<template>
  <div>
    <el-card shadow="never">
      <el-form inline @submit.prevent>
        <el-form-item label="订单号 / 会话ID">
          <el-input v-model="keyword" placeholder="输入 ORD 订单号或会话 ID" clearable style="width:280px"
            @keyup.enter="search" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="search">查询会话</el-button>
        </el-form-item>
      </el-form>

      <el-alert v-if="conv" type="info" :closable="false" style="margin-bottom:12px">
        <template #title>
          会话 {{ conv.conv_id?.slice(-10) }} · 订单 {{ conv.order_no || conv.order_id?.slice(-10) }}
          <el-tag v-if="conv.scene_name" size="small" style="margin-left:8px">{{ conv.scene_name }}</el-tag>
        </template>
      </el-alert>
      <el-empty v-else-if="searched && !loading" description="未找到会话，请核对订单号/会话ID" />
    </el-card>

    <el-card v-if="list.length" shadow="never" style="margin-top:12px">
      <el-table :data="list" v-loading="loading" border stripe size="small">
        <el-table-column prop="created_at" label="时间" width="170">
          <template #default="{row}">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="发送方" width="150">
          <template #default="{row}">
            <el-tag :type="row.from_role === 'partner' ? 'warning' : 'primary'" size="small">
              {{ row.from_role === 'partner' ? '耍伴' : '用户' }}
            </el-tag>
            <span style="margin-left:6px">{{ row.from_nickname || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="内容" min-width="260" show-overflow-tooltip>
          <template #default="{row}">
            <span :class="{ 'im-degraded': row.sec_degraded }">{{ row.text }}</span>
            <el-tag v-if="row.sec_degraded" type="danger" size="small" style="margin-left:6px">未过安检</el-tag>
            <el-tag v-else-if="row.type === 'template'" type="info" size="small" style="margin-left:6px">模板</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
        v-model:current-page="page" v-model:page-size="size"
        :total="total" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next"
        @size-change="load" @current-change="load" />
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const keyword = ref('');
const conv = ref(null);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(20);
const loading = ref(false);
const searched = ref(false);

async function search() {
  const kw = String(keyword.value || '').trim();
  if (!kw) return;
  page.value = 1;
  conv.value = null;
  list.value = [];
  await load(kw);
}

async function load(kwOverride) {
  const kw = kwOverride || String(keyword.value || '').trim();
  if (!kw) return;
  loading.value = true;
  // 会话ID 是 32 位十六进制; 否则当订单号(ORD 开头)处理
  const isConvId = /^[a-f0-9]{32}$/i.test(kw);
  const payload = isConvId
    ? { conv_id: kw, page: page.value, size: size.value }
    : { order_no: kw.toUpperCase(), page: page.value, size: size.value };
  const r = await call('im_message_admin_list', payload);
  loading.value = false;
  searched.value = true;
  if (r.ok) {
    conv.value = r.data?.conv ?? null;
    list.value = r.data?.list ?? [];
    total.value = r.data?.total ?? list.value.length;
  } else {
    conv.value = null;
    list.value = [];
    total.value = 0;
  }
}
</script>

<style scoped>
.im-degraded { color: #d03050; }
</style>
