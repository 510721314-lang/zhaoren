// views/Conversation.vue · 会话监管 P1 二期占位（只读调取 IM 消息，供纠纷仲裁）
<template>
  <div>
    <!-- 占位提示 -->
    <el-empty
      description="会话监管 P1 二期能力（im_message_admin_list），按 order_id 只读调取 IM 消息，供纠纷仲裁，不留存导出"
    />

    <!-- 近期 event 占位表格 -->
    <h3 style="margin-top:16px;margin-bottom:12px;font-size:15px">近期 Event（event_list 占位）</h3>
    <el-table :data="list" v-loading="loading" border stripe size="small">
      <el-table-column prop="event_id" label="event_id" width="180">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.event_id }}</span></template>
      </el-table-column>
      <el-table-column prop="type" label="type" width="140" />
      <el-table-column prop="target_openid" label="target_openid" width="180">
        <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.target_openid?.slice(-12) }}</span></template>
      </el-table-column>
      <el-table-column prop="content_preview" label="content_preview" min-width="200" show-overflow-tooltip />
      <el-table-column label="created_at" width="170">
        <template #default="{row}">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
    </el-table>

    <el-pagination style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size"
      :total="total" :page-sizes="[10,20,50]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(10);
const loading = ref(false);

async function load() {
  loading.value = true;
  const r = await call('event_list', { page: page.value, size: size.value });
  loading.value = false;
  if (r.ok) {
    list.value = r.data?.list ?? r.data ?? [];
    total.value = r.data?.total ?? list.value.length;
  }
}

onMounted(load);
</script>
