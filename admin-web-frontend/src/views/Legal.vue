// views/Legal.vue · 法律合规独立模块
// 数据来源: admin-action config_get → legal 块
// 写操作用 config_set 的 legal_disclaimer_text / legal_service_agreement / legal_privacy_policy / legal_scene_disclaimers
// TODO: 暂缓上线, 暂不做完整 UI; 先做基本 textarea 编辑 + 场景免责声明列表
<template>
  <div>
    <h3 style="margin:0 0 16px">法律合规 <el-tag type="warning" size="small">骨架</el-tag></h3>
    <el-alert type="warning" :closable="false" style="margin-bottom:16px">
      法律文件支持后台编辑。修改后小程序下次启动自动拉取最新版本（通过 home-action config_get 接口）。文案改动属于重大变更，建议双人复核后发布。
    </el-alert>

    <el-form v-if="data" label-width="140px" label-position="right">
      <el-card style="margin-bottom:16px">
        <template #header><b>通用免责声明</b></template>
        <el-alert type="info" :closable="false" style="margin-bottom:12px">
          用户发布/接单前弹出的通用免责声明。最多 8000 字。
        </el-alert>
        <el-form-item label="免责声明">
          <el-input v-model="patch.legal_disclaimer_text" type="textarea" :rows="8" :maxlength="8000" show-word-limit placeholder="请输入通用免责声明" />
        </el-form-item>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header><b>服务协议</b></template>
        <el-form-item label="服务协议全文">
          <el-input v-model="patch.legal_service_agreement" type="textarea" :rows="12" :maxlength="20000" show-word-limit placeholder="请输入服务协议全文" />
        </el-form-item>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header><b>隐私政策</b></template>
        <el-form-item label="隐私政策全文">
          <el-input v-model="patch.legal_privacy_policy" type="textarea" :rows="12" :maxlength="20000" show-word-limit placeholder="请输入隐私政策全文" />
        </el-form-item>
      </el-card>

      <el-card style="margin-bottom:16px">
        <template #header>
          <b>场景专属免责声明</b>
          <el-button size="small" type="primary" plain style="margin-left:12px" @click="addSceneDisclaimer">+ 新增场景</el-button>
        </template>
        <el-alert type="info" :closable="false" style="margin-bottom:12px">
          每个场景可以有独立的免责声明（如代驾场景需特别强调酒驾后果）。选择场景后填写文案，最多 4000 字/场景。
        </el-alert>
        <div v-for="(item, idx) in sceneDisclaimers" :key="idx" style="border:1px solid #ebeef5;border-radius:8px;padding:12px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
            <el-select v-model="item.scene" placeholder="选择场景" style="width:160px">
              <el-option v-for="s in sceneOptions" :key="s.code" :label="s.name" :value="s.code" />
            </el-select>
            <el-button type="danger" size="small" plain @click="removeSceneDisclaimer(idx)">删除</el-button>
          </div>
          <el-input v-model="item.text" type="textarea" :rows="4" :maxlength="4000" show-word-limit :placeholder="`${item.scene || '该场景'} 免责声明`" />
        </div>
        <el-empty v-if="sceneDisclaimers.length === 0" description="暂无场景专属免责声明" :image-size="80" />
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
const patch = reactive({ legal_disclaimer_text: '', legal_service_agreement: '', legal_privacy_policy: '' });
const sceneDisclaimers = ref([]);  // [{scene, text}]
const sceneOptions = ref([]);       // 场景列表
const saving = ref(false);

function addSceneDisclaimer() {
  sceneDisclaimers.value.push({ scene: '', text: '' });
}
function removeSceneDisclaimer(idx) {
  sceneDisclaimers.value.splice(idx, 1);
}

async function load() {
  const r = await call('config_get');
  if (r.ok && r.data) {
    data.value = r.data;
    // 顶层场景列表用于下拉
    sceneOptions.value = r.data.scene_list || [];
    // legal 块
    const lg = r.data.legal || {};
    patch.legal_disclaimer_text = lg.disclaimer_text || '';
    patch.legal_service_agreement = lg.service_agreement || '';
    patch.legal_privacy_policy = lg.privacy_policy || '';
    // 场景专属免责声明 → 转为数组
    sceneDisclaimers.value = Object.entries(lg.scene_disclaimers || {}).map(([scene, text]) => ({ scene, text }));
  } else {
    ElMessage.error(r.msg || '加载失败');
  }
}

async function save() {
  saving.value = true;
  // 场景免责声明转回 {scene_code: text}
  const sceneMap = {};
  for (const { scene, text } of sceneDisclaimers.value) {
    if (scene && text) sceneMap[scene] = text;
  }
  const payload = {
    legal_disclaimer_text: patch.legal_disclaimer_text,
    legal_service_agreement: patch.legal_service_agreement,
    legal_privacy_policy: patch.legal_privacy_policy,
    legal_scene_disclaimers: sceneMap
  };
  const r = await call('config_set', payload);
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
