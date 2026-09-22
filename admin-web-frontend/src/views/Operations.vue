// views/Operations.vue · 运营配置独立模块(阈值 + 场景管理)
// 数据来源: admin-action config_get → operations 聚合块 + scene_list
// 写操作用 config_set 的各白名单字段 / scene_add / scene_delete / scene_option_add / scene_option_remove
<template>
  <div>
    <h3 style="margin:0 0 16px">运营配置</h3>

    <el-tabs v-model="activeTab">
      <!-- ── Tab 1: 阈值与开关 ── -->
      <el-tab-pane label="阈值与开关" name="thresholds">
        <el-form v-if="data" label-width="200px" label-position="right">
          <el-card style="margin-bottom:16px">
            <template #header><b>距离与限额</b></template>
            <el-row :gutter="16">
              <el-col :span="8"><el-form-item label="发布距离上限(km)"><el-input-number v-model="patch.publish_distance_max_km" :min="1" :max="500" /></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="接单距离上限(km)"><el-input-number v-model="patch.take_distance_max_km" :min="1" :max="500" /></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="青年最低预算(分)"><el-input-number v-model="patch.youth_limit_fen" :min="1000" :max="100000" /></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="耍伴每日接单上限(单)"><el-input-number v-model="patch.partner_daily_take_limit" :min="1" :max="50" /></el-form-item></el-col>
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
      </el-tab-pane>

      <!-- ── Tab 2: 场景管理 ── -->
      <el-tab-pane label="场景管理" name="scenes">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <el-button type="primary" @click="openAddScene">+ 新增场景</el-button>
          <el-tag type="info" size="small">共 {{ sceneList.length }} 个场景 ({{ builtinCount }} 内置 / {{ sceneList.length - builtinCount }} 自定义)</el-tag>
          <el-tag type="warning" size="small">内置场景不可删除, 仅可增删服务项</el-tag>
        </div>

        <el-table :data="sceneList" border stripe size="small">
          <el-table-column prop="code" label="编码" width="80">
            <template #default="{row}">
              <span style="font-family:monospace;font-weight:600">{{ row.code }}</span>
              <el-tag v-if="row.builtin" type="info" size="small" style="margin-left:4px">内置</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" width="140" />
          <el-table-column label="服务项">
            <template #default="{row}">
              <el-tag v-for="opt in row.options" :key="opt" size="small" style="margin-right:4px;margin-bottom:2px">{{ opt }}</el-tag>
              <el-button size="small" text type="primary" @click="openOptAdd(row)">+ 加</el-button>
              <el-button size="small" text type="danger" :disabled="!row.options || row.options.length===0" @click="openOptRemove(row)">- 删</el-button>
            </template>
          </el-table-column>
          <el-table-column label="免责声明类型" width="160">
            <template #default="{row}">{{ disclaimerLabel(row.disclaimer_type) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{row}">
              <el-button size="small" type="danger" plain :disabled="row.builtin" @click="doDeleteScene(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-alert v-if="sceneList.length === 0" type="info" :closable="false" style="margin-top:12px">暂无场景, 请点"+ 新增场景"</el-alert>
      </el-tab-pane>

      <!-- ── Tab 3: 首页活动 ── -->
      <el-tab-pane label="首页活动" name="activities">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <el-button type="primary" :loading="actLoading" @click="loadActivities">刷新</el-button>
          <el-button type="primary" plain @click="openAddActivity">＋ 新增活动</el-button>
          <el-tag type="info" size="small">活动仅在有效期内+状态active时前端可见</el-tag>
        </div>
        <el-table :data="activities" v-loading="actLoading" border stripe size="small">
          <el-table-column prop="id" label="ID" width="140">
            <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.id }}</span></template>
          </el-table-column>
          <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
          <el-table-column label="类型" width="100">
            <template #default="{row}">
              <el-tag size="small">{{ actTypeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{row}">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '显示中' : '隐藏' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="有效期" width="180">
            <template #default="{row}">{{ actTime(row.start_at) }} ~ {{ actTime(row.end_at) }}</template>
          </el-table-column>
          <el-table-column prop="priority" label="优先级" width="70" sortable />
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{row}">
              <el-button size="small" type="primary" text @click="openEditActivity(row)">编辑</el-button>
              <el-button size="small" type="danger" text :loading="actBusy === row.id" @click="doDeleteActivity(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增场景弹窗 -->
    <el-dialog v-model="sceneAddDialog" title="新增场景" width="480px">
      <el-form label-position="top">
        <el-form-item label="场景编码 (W+数字, 如 W12)" required>
          <el-input v-model="newScene.code" placeholder="W12" />
        </el-form-item>
        <el-form-item label="场景名称 (1-12 字)" required>
          <el-input v-model="newScene.name" placeholder="如: 宠物陪伴" />
        </el-form-item>
        <el-form-item label="免责声明类型">
          <el-select v-model="newScene.disclaimer_type" style="width:100%">
            <el-option label="通用声明 general_disclaimer" value="general_disclaimer" />
            <el-option label="就医声明 medical_disclaimer" value="medical_disclaimer" />
            <el-option label="线上声明 online_disclaimer" value="online_disclaimer" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始服务项 (逗号分隔, 最多 8 个)">
          <el-input v-model="newScene.optionsStr" placeholder="如: 遛狗, 喂猫, 就医陪同" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="sceneAddDialog = false">取消</el-button>
        <el-button type="primary" :loading="sceneSaving" @click="doAddScene">确认新增</el-button>
      </template>
    </el-dialog>

    <!-- 服务项增删弹窗 -->
    <el-dialog v-model="optDialog" :title="optIsAdd ? `为 ${optScene?.name} 加服务项` : `从 ${optScene?.name} 删服务项`" width="400px">
      <el-select v-if="optIsAdd" v-model="optValue" filterable allow-create default-first-option placeholder="输入服务项名称 (1-10 字)" style="width:100%">
        <el-option v-for="o in optScene?.options || []" :key="o" :label="o" :value="o" disabled />
      </el-select>
      <el-select v-else v-model="optValue" placeholder="选择要删除的服务项" style="width:100%">
        <el-option v-for="o in optScene?.options || []" :key="o" :label="o" :value="o" />
      </el-select>
      <template #footer>
        <el-button @click="optDialog = false">取消</el-button>
        <el-button type="primary" :loading="sceneSaving" @click="doOptSubmit">确认</el-button>
      </template>
    </el-dialog>

    <!-- 活动编辑弹窗 -->
    <el-dialog v-model="actDialog" :title="actIsEdit ? '编辑活动' : '新增活动'" width="560px">
      <el-form label-position="top">
        <el-row :gutter="12">
          <el-col :span="16"><el-form-item label="活动标题 (1-30 字)" required><el-input v-model="actForm.title" placeholder="如: 国庆搭子总动员" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="活动类型" required>
            <el-select v-model="actForm.type" style="width:100%">
              <el-option label="banner 轮播" value="banner" />
              <el-option label="活动卡片" value="card" />
              <el-option label="两者都有" value="both" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-form-item label="副标题 (≤60 字, 可选)"><el-input v-model="actForm.subtitle" placeholder="如: 假期出行找搭子,最高立减20元" /></el-form-item>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="Banner 图 URL (云存储, banner 类型必填)"><el-input v-model="actForm.banner_image" placeholder="cloud://..." /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="封面图 URL (卡片类型必填)"><el-input v-model="actForm.cover_image" placeholder="cloud://..." /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="点击跳转" required>
            <el-select v-model="actForm.jump_to" style="width:100%">
              <el-option label="跳发布页 (预填场景)" value="demand_publish" />
              <el-option label="跳场景广场" value="scene_list" />
              <el-option label="Webview H5" value="webview" />
              <el-option label="活动详情页 (暂未实现)" value="activity_detail" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="关联场景 (可选, 空=所有场景可见)">
            <el-select v-model="actForm.scene_code" clearable placeholder="不绑定=所有场景可见" style="width:100%">
              <el-option v-for="s in sceneList" :key="s.code" :label="s.name + ' (' + s.code + ')'" :value="s.code" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="优先级 (越大越靠前)"><el-input-number v-model="actForm.priority" :min="0" :max="1000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="状态">
            <el-select v-model="actForm.status" style="width:100%">
              <el-option label="显示" value="active" />
              <el-option label="隐藏" value="draft" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="有效期 (天, 默认30)">
            <el-input-number v-model="actForm.days" :min="1" :max="365" @change="syncActTime" />
          </el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="actDialog = false">取消</el-button>
        <el-button type="primary" :loading="actSaving" @click="doSubmitActivity">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';

const activeTab = ref('thresholds');
const data = ref(null);
const patch = reactive({});
const saving = ref(false);
const sceneSaving = ref(false);

// 活动管理
const activities = ref([]);
const actLoading = ref(false);
const actBusy = ref('');
const actDialog = ref(false);
const actIsEdit = ref(false);
const actSaving = ref(false);
const actForm = reactive({
  id: '', title: '', subtitle: '', banner_image: '', cover_image: '',
  type: 'banner', jump_to: 'demand_publish', jump_param: {},
  scene_code: '', priority: 0, status: 'active', days: 30,
  start_at: 0, end_at: 0
});

function actTypeLabel(t) {
  return { banner: '轮播', card: '卡片', both: '两者' }[t] || t;
}
function actTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function syncActTime() {
  const now = Date.now();
  actForm.start_at = now;
  actForm.end_at = now + (actForm.days || 30) * 86400000;
}

async function loadActivities() {
  actLoading.value = true;
  const r = await call('home_activity_list');
  actLoading.value = false;
  if (r.ok) activities.value = r.data?.list || [];
  else ElMessage.error(r.msg || '加载活动失败');
}

function openAddActivity() {
  actIsEdit.value = false;
  actForm.id = ''; actForm.title = ''; actForm.subtitle = '';
  actForm.banner_image = ''; actForm.cover_image = '';
  actForm.type = 'banner'; actForm.jump_to = 'demand_publish';
  actForm.jump_param = {}; actForm.scene_code = '';
  actForm.priority = 0; actForm.status = 'active'; actForm.days = 30;
  syncActTime();
  actDialog.value = true;
}

function openEditActivity(row) {
  actIsEdit.value = true;
  Object.assign(actForm, { ...row, days: Math.round((row.end_at - row.start_at) / 86400000) || 30 });
  actDialog.value = true;
}

async function doSubmitActivity() {
  if (!actForm.title) { ElMessage.warning('标题必填'); return; }
  if (!actForm.type) { ElMessage.warning('类型必填'); return; }
  actSaving.value = true;
  const payload = {
    title: actForm.title, subtitle: actForm.subtitle,
    banner_image: actForm.banner_image, cover_image: actForm.cover_image,
    type: actForm.type, jump_to: actForm.jump_to,
    jump_param: actForm.jump_param, scene_code: actForm.scene_code,
    start_at: actForm.start_at, end_at: actForm.end_at,
    status: actForm.status, priority: actForm.priority
  };
  const r = actIsEdit.value
    ? await call('home_activity_update', { id: actForm.id, patch: payload })
    : await call('home_activity_create', { activity: payload });
  actSaving.value = false;
  if (r.ok) {
    ElMessage.success(actIsEdit.value ? '已更新' : '已创建');
    actDialog.value = false;
    await loadActivities();
  } else { ElMessage.error(r.msg || r.code || '保存失败'); }
}

async function doDeleteActivity(row) {
  try {
    await ElMessageBox.confirm(`确认删除活动「${row.title}」?`, '删除确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
  } catch (_) { return; }
  actBusy.value = row.id;
  const r = await call('home_activity_delete', { id: row.id });
  actBusy.value = '';
  if (r.ok) { ElMessage.success('已删除'); await loadActivities(); }
  else { ElMessage.error(r.msg || r.code || '删除失败'); }
}

// 场景列表
const sceneList = computed(() => data.value?.scene_list || []);
const builtinCount = computed(() => sceneList.value.filter((s) => s.builtin).length);

// 新增场景弹窗
const sceneAddDialog = ref(false);
const newScene = reactive({ code: '', name: '', disclaimer_type: 'general_disclaimer', optionsStr: '' });

// 服务项弹窗
const optDialog = ref(false);
const optIsAdd = ref(true);
const optScene = ref(null);
const optValue = ref('');

function disclaimerLabel(type) {
  const m = { medical_disclaimer: '就医声明', general_disclaimer: '通用声明', online_disclaimer: '线上声明' };
  return m[type] || type || '通用声明';
}

async function load() {
  const r = await call('config_get');
  if (r.ok && r.data) {
    data.value = r.data;
    const ops = r.data.operations || {};
    Object.keys(patch).forEach((k) => delete patch[k]);
    Object.assign(patch, ops);
    if (r.data.platform_fee_rate_fen !== undefined) patch.platform_fee_rate_fen = r.data.platform_fee_rate_fen;
    if (r.data.auto_approve_partner !== undefined) patch.auto_approve_partner = r.data.auto_approve_partner;
    if (r.data.payment_visible !== undefined) patch.payment_visible = r.data.payment_visible;
  } else {
    ElMessage.error(r.msg || '加载失败');
  }
}

async function save() {
  saving.value = true;
  const r = await call('config_set', patch);
  saving.value = false;
  if (r.ok) { ElMessage.success('已保存'); await load(); }
  else { ElMessage.error(r.msg || r.code || '保存失败'); }
}

// ── 场景新增 ──
function openAddScene() {
  newScene.code = ''; newScene.name = ''; newScene.disclaimer_type = 'general_disclaimer'; newScene.optionsStr = '';
  sceneAddDialog.value = true;
}
async function doAddScene() {
  if (!newScene.code || !newScene.name) { ElMessage.warning('编码和名称必填'); return; }
  sceneSaving.value = true;
  const options = newScene.optionsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const r = await call('config_set', {
    scene_add: { code: newScene.code, name: newScene.name, disclaimer_type: newScene.disclaimer_type, options }
  });
  sceneSaving.value = false;
  if (r.ok) {
    ElMessage.success('场景已新增, 可在"法律合规"页面补充该场景专属免责声明');
    sceneAddDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '新增失败');
  }
}

// ── 场景删除 ──
async function doDeleteScene(row) {
  if (row.builtin) { ElMessage.warning('内置场景不可删除'); return; }
  if (row.options && row.options.length > 0) {
    ElMessage.warning('该场景还有服务项, 请先清空再删除');
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除场景「${row.name} (${row.code})」? 此操作不可恢复。`, '删除确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
  } catch (_) { return; }
  sceneSaving.value = true;
  const r = await call('config_set', { scene_delete: row.code });
  sceneSaving.value = false;
  if (r.ok) { ElMessage.success('已删除'); await load(); }
  else { ElMessage.error(r.msg || r.code || '删除失败'); }
}

// ── 服务项增删 ──
function openOptAdd(row) { optIsAdd.value = true; optScene.value = row; optValue.value = ''; optDialog.value = true; }
function openOptRemove(row) {
  if (!row.options || row.options.length === 0) { ElMessage.warning('该场景无服务项'); return; }
  optIsAdd.value = false; optScene.value = row; optValue.value = ''; optDialog.value = true;
}
async function doOptSubmit() {
  if (!optValue.value || !optScene.value) { ElMessage.warning('请填写服务项'); return; }
  sceneSaving.value = true;
  const payload = optIsAdd.value
    ? { scene_option_add: { scene: optScene.value.code, option: optValue.value } }
    : { scene_option_remove: { scene: optScene.value.code, option: optValue.value } };
  const r = await call('config_set', payload);
  sceneSaving.value = false;
  if (r.ok) {
    ElMessage.success(optIsAdd.value ? '已添加' : '已删除');
    optDialog.value = false;
    await load();
  } else { ElMessage.error(r.msg || r.code || '操作失败'); }
}

onMounted(async () => {
  await load();
  await loadActivities();
});
</script>
