// views/Notice.vue · 通知群发（商用前占位，仅 super_admin）
<template>
  <div>
    <el-empty
      description="通知群发商用前接通（仅 super_admin，分人群 system_notice → 预览 → 频控 → 审计 → 发送记录）"
    />
  </div>
</template>

<script setup>
import { call } from '../api/admin.js';
</script>
