// views/Config.vue · config_get + config_set 运营配置页
<template>
  <div>
    <el-button type="primary" size="small" @click="load" :loading="loading">刷新</el-button>
    <el-button type="success" size="small" @click="save" :loading="saving">保存变更</el-button>
    <div v-if="data">
      <el-collapse v-model="activeNames" style="margin-top:16px">
        <!-- 平台开关 -->
        <el-collapse-item title="① 平台开关" name="switch">
          <el-form :model="patch" label-width="160px">
            <el-form-item label="当前环境"><el-input v-model="patch.env" /></el-form-item>
            <el-form-item label="平台费率(万分)"><el-input-number v-model="patch.platform_fee_rate_fen" :min="0" :max="10000" /></el-form-item>
            <el-form-item label="支付可见"><el-switch v-model="patch.payment_visible" /></el-form-item>
            <el-form-item label="自动审核耍伴"><el-switch v-model="patch.auto_approve_partner" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 订单时效 -->
        <el-collapse-item title="② 订单时效(分钟)" name="time">
          <el-form :model="patch" label-width="180px">
            <el-form-item label="S0 待支付超时"><el-input-number v-model="patch.s0_timeout_min" :min="1" :max="1440" /></el-form-item>
            <el-form-item label="S1 待确认超时"><el-input-number v-model="patch.s1_timeout_min" :min="1" :max="1440" /></el-form-item>
            <el-form-item label="评价窗口(小时)"><el-input-number v-model="patch.eval_window_h" :min="1" :max="720" /></el-form-item>
            <el-form-item label="默认评价星"><el-input-number v-model="patch.default_star" :min="1" :max="5" /></el-form-item>
            <el-form-item label="里程碑确认(分钟)"><el-input-number v-model="patch.milestone_confirm_min" :min="1" :max="1440" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 距离与青少年 -->
        <el-collapse-item title="③ 距离/青少年/费率" name="dist">
          <el-form :model="patch" label-width="200px">
            <el-form-item label="发布距离上限(km)"><el-input-number v-model="patch.publish_distance_max_km" :min="1" :max="500" /></el-form-item>
            <el-form-item label="接单距离上限(km)"><el-input-number v-model="patch.take_distance_max_km" :min="1" :max="500" /></el-form-item>
            <el-form-item label="青少年单笔上限(fen)"><el-input-number v-model="patch.youth_limit_fen" :min="1000" :max="100000" /></el-form-item>
            <el-form-item label="时薪区间下限(fen)"><el-input-number v-model="patch.rate_min_fen" :min="0" :max="100000" /></el-form-item>
            <el-form-item label="时薪区间上限(fen)"><el-input-number v-model="patch.rate_max_fen" :min="0" :max="100000" /></el-form-item>
            <el-form-item label="耍伴默认时薪(fen)"><el-input-number v-model="patch.scene_default_rate_fen" :min="0" :max="100000" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 改期规则 -->
        <el-collapse-item title="④ 改期规则" name="modify">
          <el-form :model="patch.modify_config" label-width="180px">
            <el-form-item label="改期前最少 lead 小时"><el-input-number v-model="patch.modify_config.minLeadHours" :min="0" :max="72" /></el-form-item>
            <el-form-item label="最大改期次数"><el-input-number v-model="patch.modify_config.maxTimes" :min="0" :max="10" /></el-form-item>
            <el-form-item label="最大跨度(小时)"><el-input-number v-model="patch.modify_config.maxSpanH" :min="1" :max="720" /></el-form-item>
            <el-form-item label="改期确认窗口(小时)"><el-input-number v-model="patch.modify_config.confirmHours" :min="1" :max="168" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 保险与极速提现 -->
        <el-collapse-item title="⑤ 保险/极速提现(fen)" name="insurance">
          <el-form :model="patch" label-width="220px">
            <el-form-item label="意外险保额"><el-input-number v-model="patch.insurance_coverage_accident_fen" :min="0" :max="1000000000" /></el-form-item>
            <el-form-item label="财产险保额"><el-input-number v-model="patch.insurance_coverage_property_fen" :min="0" :max="1000000000" /></el-form-item>
            <el-form-item label="极速提现单笔上限"><el-input-number v-model="patch.fast_withdraw_per_order_max_fen" :min="0" :max="1000000" /></el-form-item>
            <el-form-item label="极速提现日上限"><el-input-number v-model="patch.fast_withdraw_per_day_max_fen" :min="0" :max="10000000" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 夜间红线 -->
        <el-collapse-item title="⑥ 夜间红线" name="redline">
          <el-form :model="patch" label-width="180px">
            <el-form-item label="关闭时间(分钟,0=全天)"><el-input-number v-model="patch.time_redline_close_min" :min="0" :max="1440" /></el-form-item>
            <el-form-item label="开放时间(分钟)"><el-input-number v-model="patch.time_redline_open_min" :min="0" :max="1440" /></el-form-item>
          </el-form>
          <p style="color:#909399;font-size:12px">换算: close_min=1440→24:00, 360→06:00; close_min=0 表示全天开放</p>
        </el-collapse-item>
      </el-collapse>
    </div>
    <el-empty v-else description="加载中..." />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';

const data = ref(null);
const patch = reactive({});
const activeNames = ref(['switch', 'time']);
const loading = ref(false);
const saving = ref(false);

async function load() {
  loading.value = true;
  const r = await call('config_get');
  loading.value = false;
  if (!r.ok) { ElMessage.error(r.msg || r.code); return; }
  data.value = r.data;
  // 初始化 patch 对象 (复制可编辑字段, 深拷贝 modify_config)
  Object.keys(patch).forEach(k => delete patch[k]);
  [
    'env', 'platform_fee_rate_fen', 'payment_visible', 'auto_approve_partner',
    's0_timeout_min', 's1_timeout_min', 'eval_window_h', 'default_star', 'milestone_confirm_min',
    'publish_distance_max_km', 'take_distance_max_km', 'youth_limit_fen',
    'rate_min_fen', 'rate_max_fen', 'scene_default_rate_fen',
    'insurance_coverage_accident_fen', 'insurance_coverage_property_fen',
    'fast_withdraw_per_order_max_fen', 'fast_withdraw_per_day_max_fen',
    'time_redline_close_min', 'time_redline_open_min'
  ].forEach(k => { if (r.data[k] !== undefined) patch[k] = r.data[k]; });
  patch.modify_config = { ...(r.data.modify_config || {}) };
}

async function save() {
  const diff = {};
  const orig = data.value;
  for (const k of Object.keys(patch)) {
    if (k === 'modify_config') continue;
    if (patch[k] !== orig[k]) diff[k] = patch[k];
  }
  const mcDiff = {};
  for (const k of Object.keys(patch.modify_config)) {
    if (JSON.stringify(patch.modify_config[k]) !== JSON.stringify((orig.modify_config || {})[k])) mcDiff[k] = patch.modify_config[k];
  }
  if (Object.keys(mcDiff).length) diff.modify_config = mcDiff;
  if (!Object.keys(diff).length) { ElMessage.info('没有变更'); return; }

  try {
    await ElMessageBox.confirm('确认保存变更? admin_config 将被更新', '二次确认', { type: 'warning' });
  } catch { return; }

  saving.value = true;
  const r = await call('config_set', diff);
  saving.value = false;
  if (r.ok) { ElMessage.success('保存成功'); await load(); }
  else ElMessage.error(r.msg || r.code);
}

onMounted(load);
</script>
