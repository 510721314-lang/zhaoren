// views/Config.vue · config_get + config_set 运营配置页
<template>
  <div>
    <el-button type="primary" size="small" @click="load" :loading="loading">刷新</el-button>
    <el-button type="success" size="small" @click="save" :loading="saving">保存变更</el-button>
    <el-tag v-if="data && data.idcard_aes_key_set" type="success" size="small" style="margin-left:8px">证件加密密钥已配置</el-tag>
    <el-tag v-else-if="data" type="warning" size="small" style="margin-left:8px">证件加密密钥未配置</el-tag>
    <div v-if="data">
      <el-collapse v-model="activeNames" style="margin-top:16px">
        <!-- 平台开关 -->
        <el-collapse-item title="① 平台开关" name="switch">
          <el-form :model="patch" label-width="220px">
            <el-form-item label="当前环境(dev/prod)"><el-input v-model="patch.env" placeholder="dev 或 prod" /></el-form-item>
            <el-form-item label="平台费率(万分)"><el-input-number v-model="patch.platform_fee_rate_fen" :min="0" :max="10000" /></el-form-item>
            <el-form-item label="支付入口可见"><el-switch v-model="patch.payment_visible" /></el-form-item>
            <el-form-item label="自动审核耍伴(生产须 false)"><el-switch v-model="patch.auto_approve_partner" /></el-form-item>
            <el-form-item label="四确认前仅允许模板消息"><el-switch v-model="patch.security_only_template_before_confirm" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 订单时效 -->
        <el-collapse-item title="② 订单时效" name="time">
          <el-form :model="patch" label-width="200px">
            <el-form-item label="S0 待支付超时(分钟)"><el-input-number v-model="patch.s0_timeout_min" :min="1" :max="1440" /></el-form-item>
            <el-form-item label="S1 待确认超时(分钟)"><el-input-number v-model="patch.s1_timeout_min" :min="1" :max="1440" /></el-form-item>
            <el-form-item label="履约中断超时(小时)"><el-input-number v-model="patch.interrupt_timeout_h" :min="1" :max="168" /></el-form-item>
            <el-form-item label="评价窗口(小时)"><el-input-number v-model="patch.eval_window_h" :min="1" :max="720" /></el-form-item>
            <el-form-item label="默认评价星"><el-input-number v-model="patch.default_star" :min="1" :max="5" /></el-form-item>
            <el-form-item label="里程碑确认(分钟)"><el-input-number v-model="patch.milestone_confirm_min" :min="1" :max="1440" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 距离与青少年 -->
        <el-collapse-item title="③ 距离/青少年/费率" name="dist">
          <el-form :model="patch" label-width="220px">
            <el-form-item label="发布距离上限(km)"><el-input-number v-model="patch.publish_distance_max_km" :min="1" :max="500" /></el-form-item>
            <el-form-item label="接单距离上限(km)"><el-input-number v-model="patch.take_distance_max_km" :min="1" :max="500" /></el-form-item>
            <el-form-item label="青少年单笔上限(fen)"><el-input-number v-model="patch.youth_limit_fen" :min="1000" :max="100000" /></el-form-item>
            <el-form-item label="时薪区间下限(fen)"><el-input-number v-model="patch.rate_min_fen" :min="0" :max="100000" /></el-form-item>
            <el-form-item label="时薪区间上限(fen)"><el-input-number v-model="patch.rate_max_fen" :min="0" :max="100000" /></el-form-item>
            <el-form-item label="耍伴默认时薪(fen)"><el-input-number v-model="patch.scene_default_rate_fen" :min="0" :max="100000" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 信用分阈值 -->
        <el-collapse-item title="④ 信用分阈值" name="credit">
          <el-form :model="patch" label-width="220px">
            <el-form-item label="接单最低信用分"><el-input-number v-model="patch.min_credit_take_order" :min="0" :max="1000" /></el-form-item>
            <el-form-item label="发单最低信用分"><el-input-number v-model="patch.min_credit_place_order" :min="0" :max="1000" /></el-form-item>
            <el-form-item label="信用冻结线"><el-input-number v-model="patch.credit_freeze_line" :min="0" :max="1000" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 改期规则 -->
        <el-collapse-item title="⑤ 改期规则" name="modify">
          <el-form :model="patch.modify_config" label-width="200px">
            <el-form-item label="改期前最少 lead 小时"><el-input-number v-model="patch.modify_config.minLeadHours" :min="0" :max="72" /></el-form-item>
            <el-form-item label="最大改期次数"><el-input-number v-model="patch.modify_config.maxTimes" :min="0" :max="10" /></el-form-item>
            <el-form-item label="最大跨度(小时)"><el-input-number v-model="patch.modify_config.maxSpanH" :min="1" :max="720" /></el-form-item>
            <el-form-item label="改期确认窗口(小时)"><el-input-number v-model="patch.modify_config.confirmHours" :min="1" :max="168" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 保险与极速提现 -->
        <el-collapse-item title="⑥ 保险/极速提现(fen)" name="insurance">
          <el-form :model="patch" label-width="240px">
            <el-form-item label="意外险保额"><el-input-number v-model="patch.insurance_coverage_accident_fen" :min="0" :max="1000000000" /></el-form-item>
            <el-form-item label="财产险保额"><el-input-number v-model="patch.insurance_coverage_property_fen" :min="0" :max="1000000000" /></el-form-item>
            <el-form-item label="极速提现单笔上限"><el-input-number v-model="patch.fast_withdraw_per_order_max_fen" :min="0" :max="1000000" /></el-form-item>
            <el-form-item label="极速提现日上限"><el-input-number v-model="patch.fast_withdraw_per_day_max_fen" :min="0" :max="10000000" /></el-form-item>
          </el-form>
        </el-collapse-item>
        <!-- 夜间红线 -->
        <el-collapse-item title="⑦ 夜间红线" name="redline">
          <el-form :model="patch" label-width="220px">
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
  // config_get 返回嵌套结构(timeouts/time_redline/limits/insurance/fast_withdraw/security/credits/rate_range),
  // 扁平化后与 config_set 顶层参数名对齐, save() diff 比较才能正确触发
  const d = r.data || {};
  const flat = {
    env: d.env,
    platform_fee_rate_fen: d.platform_fee_rate_fen,
    payment_visible: d.payment_visible,
    auto_approve_partner: d.auto_approve_partner,
    security_only_template_before_confirm: (d.security || {}).security_only_template_before_confirm,
    s0_timeout_min: (d.timeouts || {}).s0_timeout_min,
    s1_timeout_min: (d.timeouts || {}).s1_timeout_min,
    interrupt_timeout_h: (d.timeouts || {}).interrupt_timeout_h,
    eval_window_h: (d.timeouts || {}).eval_window_h,
    default_star: (d.timeouts || {}).default_star,
    milestone_confirm_min: (d.timeouts || {}).milestone_confirm_min,
    time_redline_close_min: (d.time_redline || {}).close_min,
    time_redline_open_min: (d.time_redline || {}).open_min,
    publish_distance_max_km: (d.limits || {}).publish_distance_max_km,
    take_distance_max_km: (d.limits || {}).take_distance_max_km,
    youth_limit_fen: (d.limits || {}).youth_limit_fen,
    insurance_coverage_accident_fen: (d.insurance || {}).coverage_accident_fen,
    insurance_coverage_property_fen: (d.insurance || {}).coverage_property_fen,
    fast_withdraw_per_order_max_fen: (d.fast_withdraw || {}).per_order_max_fen,
    fast_withdraw_per_day_max_fen: (d.fast_withdraw || {}).per_day_max_fen,
    min_credit_take_order: (d.credits || {}).min_credit_take_order,
    min_credit_place_order: (d.credits || {}).min_credit_place_order,
    credit_freeze_line: (d.credits || {}).credit_freeze_line,
    rate_min_fen: (d.rate_range || {}).rate_min_fen,
    rate_max_fen: (d.rate_range || {}).rate_max_fen,
    scene_default_rate_fen: (d.rate_range || {}).scene_default_rate_fen
  };
  // 保留只读 idcard_aes_key_set 用于 UI badge 显示
  flat.idcard_aes_key_set = d.idcard_aes_key_set;
  // modify_config 单独深拷贝, save() mcDiff 比较时 data.value.modify_config 才存在
  flat.modify_config = { ...(d.modify_config || {}) };
  data.value = flat;
  // 重置 patch (排除 idcard_aes_key_set, 此键只读不可写)
  Object.keys(patch).forEach(k => delete patch[k]);
  Object.keys(flat).forEach(k => {
    if (k === 'idcard_aes_key_set' || k === 'modify_config') return; // modify_config 单独处理
    if (flat[k] !== undefined && flat[k] !== null) patch[k] = flat[k];
  });
  patch.modify_config = { ...(d.modify_config || {}) };
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
