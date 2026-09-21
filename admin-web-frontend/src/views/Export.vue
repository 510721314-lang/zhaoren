// views/Export.vue · 导出任务 / 下载中心（商用前占位）
<template>
  <div>
    <el-empty
      description="导出任务商用前接通（异步 export_task_create → 生成 → 云存储时效链接 → 脱敏审批）"
    />
  </div>
</template>

<script setup>
import { call } from '../api/admin.js';
</script>
