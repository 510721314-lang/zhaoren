// views/Operations.vue · 运营配置独立模块
// 数据来源: admin-action config_get → operations 聚合块
// 写操作用 config_set 的 intFields / 各白名单字段
// TODO: 暂缓上线, 暂不做完整 UI; 先做基本可编辑表单, 后续补场景服务项/屏蔽词/城市增删
<template>
  <div>
    <h3 style="margin:0 0 16px">运营配置 <el-tag type="warning" size="small">骨架</el-tag></h3>
    <el-alert type="warning" :closable="false" style="margin-bottom:16px">
      运营配置已独立为模块。完整 UI（场景服务项增删/屏蔽词/城市开通）后续补。当前先让所有阈值可改。
    </el-alert>

    <el-form v-if="data" label-width="200px" label-position="right">
      <el-card style="margin-bottom:16px">
        <template #header><b>距离与限额</b></template>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="发布距离上限(km)"><el-input-number v-model="patch.publish_distance_max_km" :min="1" :max="500" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="接单距离上限(km)"><el-input-number v-model="patch.take_distance_max_km" :min="1" :max="500" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="青年最低预算(分)"><el-input-number v-model="patch.youth_limit_fen" :min="1000" :max="100000" /></el-form-item></el-col>
        </el-row>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header><b>订单超时</b></template>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="S0 待确认(分钟)"><el-input-number v-model="patch.s0_timeout_min" :min="1" :max="1440" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="S1 待确认(分钟)"><el-input-number v-model="patch.s1_timeout_min" :min="1" :max="1440" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="中断超时(小时)"><el-input-number v-model="patch.interrupt_timeout_h" :min="1" :max="168" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="评价窗口(小时)"><el-input-number v-model="patch.eval_window_h" :min="1" :max="720" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="里程碑确认(分钟)"><el-input-number v-model="patch.milestone_confirm_min" :min="1" :max="1440" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="默认星级"><el-input-number v-model="patch.default_star" :min="1" :max="5" /></el-form-item></el-col>
        </el-row>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header><b>时间红线</b></template>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="接单截止(分钟,0=00:00)"><el-input-number v-model="patch.time_redline_close_min" :min="0" :max="1440" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="接单开放(分钟,0=00:00)"><el-input-number v-model="patch.time_redline_open_min" :min="0" :max="1440" /></el-form-item></el-col>
        </el-row>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header><b>信用阈值</b></template>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="最低接单刷分"><el-input-number v-model="patch.min_credit_take_order" :min="0" :max="1000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="最低发单刷分"><el-input-number v-model="patch.min_credit_place_order" :min="0" :max="1000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="冻结线"><el-input-number v-model="patch.credit_freeze_line" :min="0" :max="1000" /></el-form-item></el-col>
        </el-row>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header><b>费率</b></template>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="最低时薪(分)"><el-input-number v-model="patch.rate_min_fen" :min="0" :max="100000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="最高时薪(分)"><el-input-number v-model="patch.rate_max_fen" :min="0" :max="100000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="场景默认时薪(分)"><el-input-number v-model="patch.scene_default_rate_fen" :min="0" :max="100000" /></el-form-item></el-col>
        </el-row>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header><b>保险与提现</b></template>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="意外险保额(分)"><el-input-number v-model="patch.insurance_coverage_accident_fen" :min="0" :max="1000000000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="财产险保额(分)"><el-input-number v-model="patch.insurance_coverage_property_fen" :min="0" :max="1000000000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="极速提现单笔上限(分)"><el-input-number v-model="patch.fast_withdraw_per_order_max_fen" :min="0" :max="1000000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="极速提现日上限(分)"><el-input-number v-model="patch.fast_withdraw_per_day_max_fen" :min="0" :max="10000000" /></el-form-item></el-col>
        </el-row>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header><b>开关</b></template>
        <el-row :gutter="16">
          <el-col :span="8"><el-form-item label="自动通过耍伴申请"><el-switch v-model="patch.auto_approve_partner" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="显示支付入口"><el-switch v-model="patch.payment_visible" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="平台抽成(万分比)"><el-input-number v-model="patch.platform_fee_rate_fen" :min="0" :max="10000" /></el-form-item></el-col>
        </el-row>
      </el-card>

      <div style="text-align:right">
        <el-button @click="load">重置</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';

const data = ref(null);
const patch = reactive({});
const saving = ref(false);

async function load() {
  const r = await call('config_get');
  if (r.ok && r.data) {
    data.value = r.data;
    // operations 块 + 顶层平台费率/开关
    const ops = r.data.operations || {};
    Object.assign(patch, ops);
    if (r.data.platform_fee_rate_fen !== undefined) patch.platform_fee_rate_fen = r.data.platform_fee_rate_fen;
    if (r.data.auto_approve_partner !== undefined) patch.auto_approve_partner = r.data.auto_approve_partner;
    if (r.data.payment_visible !== undefined) patch.payment_visible = r.data.payment_visible;
  } else {
    ElMessage.error(r.msg || '加载失败');
  }
}

async function save() {
  // 运营配置: 直接把 patch 传给 config_set, 后端白名单自动过滤合法字段
  saving.value = true;
  const r = await call('config_set', patch);
  saving.value = false;
  if (r.ok) {
    ElMessage.success('已保存');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '保存失败');
  }
}

onMounted(load);
</script>
