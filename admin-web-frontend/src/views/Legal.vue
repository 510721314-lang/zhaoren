<template>
  <div>
    <h3 style="margin:0 0 16px">法律合规</h3>
    <el-alert type="warning" :closable="false" style="margin-bottom:16px">
      协议文本采用<b>版本化发布</b>：发布后生成新版本并回写配置，实名签署链路立即生效新文本。历史版本永久留档，可一键回滚。
    </el-alert>

    <!-- ① 版本化发布区 -->
    <el-card style="margin-bottom:16px">
      <template #header>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <b>协议文档库</b>
          <el-button v-if="!loading && versions.length === 0" size="small" type="primary" plain :loading="seeding" @click="seed">
            初始化版本库（迁移存量文案）
          </el-button>
        </div>
      </template>

      <el-table :data="docRows" v-loading="loading" style="width:100%">
        <el-table-column prop="label" label="文档" width="180" />
        <el-table-column label="当前版本" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.version" type="success" size="small">v{{ row.version }}</el-tag>
            <span v-else style="color:#909399">未发布</span>
          </template>
        </el-table-column>
        <el-table-column label="生效时间" width="180">
          <template #default="{ row }">{{ row.effective_at ? fmt(row.effective_at) : '—' }}</template>
        </el-table-column>
        <el-table-column label="更新人" width="140">
          <template #default="{ row }">{{ row.created_by || '—' }}</template>
        </el-table-column>
        <el-table-column label="字数" width="90">
          <template #default="{ row }">{{ row.content ? row.content.length : 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="260">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="openEdit(row)">编辑并发布</el-button>
            <el-button size="small" plain @click="openHistory(row)">版本历史</el-button>
            <el-button v-if="row.version" size="small" text type="primary" @click="preview(row)">预览</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!loading && versions.length === 0" style="color:#909399;font-size:13px;margin-top:8px">
        尚无版本记录。点击右上角「初始化版本库」把当前配置里的文案迁移为 v1（幂等，可重复执行）。
      </div>
    </el-card>

    <!-- ② 场景专属免责声明（沿用 config_set 直改，不进版本库） -->
    <el-card style="margin-bottom:16px">
      <template #header>
        <b>场景专属免责声明</b>
        <el-button size="small" type="primary" plain style="margin-left:12px" @click="addSceneDisclaimer">+ 新增场景</el-button>
      </template>
      <el-alert type="info" :closable="false" style="margin-bottom:12px">
        每个场景独立的免责声明（发布页按场景展示，云端 SSOT 优先）。最多 4000 字/场景。
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
      <div style="text-align:right;margin-top:8px">
        <el-button @click="load">重置</el-button>
        <el-button type="primary" :loading="savingScene" @click="saveScene">保存场景免责</el-button>
      </div>
    </el-card>

    <!-- ③ 紧急热修通道（直改配置，不产生版本） -->
    <el-collapse style="margin-bottom:16px">
      <el-collapse-item name="hotfix">
        <template #title>
          <span style="color:#e6a23c;font-weight:600">紧急热修通道（直改配置，不产生版本，建议仅在事故时使用）</span>
        </template>
        <el-alert type="warning" :closable="false" style="margin-bottom:12px">
          此处修改直接覆盖 <code>admin_config.legal_*</code>，<b>不生成版本记录</b>。法律文案变更请优先走上方「编辑并发布」，以便留存版本与审计链。
        </el-alert>
        <el-form v-if="data" label-width="140px" label-position="right">
          <el-form-item label="通用免责声明">
            <el-input v-model="patch.legal_disclaimer_text" type="textarea" :rows="6" :maxlength="8000" show-word-limit />
          </el-form-item>
          <el-form-item label="服务协议">
            <el-input v-model="patch.legal_service_agreement" type="textarea" :rows="8" :maxlength="20000" show-word-limit />
          </el-form-item>
          <el-form-item label="隐私政策">
            <el-input v-model="patch.legal_privacy_policy" type="textarea" :rows="8" :maxlength="20000" show-word-limit />
          </el-form-item>
          <el-form-item label="费用自理承诺书">
            <el-input v-model="patch.legal_aa_promise" type="textarea" :rows="6" :maxlength="8000" show-word-limit />
          </el-form-item>
          <el-form-item label="宠物照料授权书">
            <el-input v-model="patch.legal_pet_authorization" type="textarea" :rows="6" :maxlength="8000" show-word-limit />
          </el-form-item>
          <div style="text-align:right">
            <el-button type="warning" :loading="savingHotfix" @click="saveHotfix">直接覆盖保存</el-button>
          </div>
        </el-form>
      </el-collapse-item>
    </el-collapse>

    <!-- 编辑/发布弹窗 -->
    <el-dialog v-model="editVisible" :title="`编辑并发布 · ${editRow.label || ''}`" width="760px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="标题（可选）">
          <el-input v-model="editForm.title" maxlength="60" show-word-limit placeholder="如：服务协议 v2 修订版" />
        </el-form-item>
        <el-form-item label="正文">
          <el-input v-model="editForm.content" type="textarea" :rows="16" :maxlength="editRow.maxLen" show-word-limit />
        </el-form-item>
        <el-form-item label="变更说明">
          <el-input v-model="editForm.remark" maxlength="100" show-word-limit placeholder="记录本次修改原因，便于日后追溯" />
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false">
        发布后将生成 <b>v{{ (editRow.version || 0) + 1 }}</b>，旧版本自动归档保留；同时回写配置使实名签署链路立即生效。
      </el-alert>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="publishing" @click="publish">确认发布 v{{ (editRow.version || 0) + 1 }}</el-button>
      </template>
    </el-dialog>

    <!-- 版本历史弹窗 -->
    <el-dialog v-model="historyVisible" :title="`版本历史 · ${historyRow.label || ''}`" width="820px" destroy-on-close>
      <el-table :data="historyList" style="width:100%">
        <el-table-column prop="version" label="版本" width="80">
          <template #default="{ row }">v{{ row.version }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">
              {{ row.status === 'published' ? '生效中' : '已归档' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column prop="created_by" label="操作人" width="130" />
        <el-table-column prop="remark" label="说明" min-width="160" />
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="previewVersion(row)">查看</el-button>
            <el-button
              v-if="row.status !== 'published'"
              size="small" text type="warning"
              :loading="rolling" @click="rollback(row)">回滚到此版</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="historyList.length === 0" description="暂无历史版本" :image-size="80" />
    </el-dialog>

    <!-- 预览弹窗 -->
    <el-dialog v-model="previewVisible" :title="previewTitle" width="720px">
      <pre style="white-space:pre-wrap;word-break:break-all;max-height:520px;overflow:auto;background:#fafafa;padding:12px;border-radius:6px;font-size:13px;line-height:1.7">{{ previewText }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';

// 文档类型元信息（与云端 DOC_TYPES 对齐）
const DOC_META = [
  { doc_type: 'service_agreement', label: '服务协议', maxLen: 20000 },
  { doc_type: 'privacy_policy', label: '隐私政策', maxLen: 20000 },
  { doc_type: 'disclaimer', label: '通用免责声明', maxLen: 8000 },
  { doc_type: 'aa_promise', label: '费用自理承诺书', maxLen: 8000 },
  { doc_type: 'pet_authorization', label: '宠物照料授权书', maxLen: 8000 }
];

const data = ref(null);
const versions = ref([]);          // legal_doc 全量版本
const loading = ref(false);
const seeding = ref(false);
const publishing = ref(false);
const rolling = ref(false);

// 场景免责（沿用 config_set）
const sceneDisclaimers = ref([]);
const sceneOptions = ref([]);
const savingScene = ref(false);

// 热修通道
const patch = reactive({
  legal_disclaimer_text: '', legal_service_agreement: '', legal_privacy_policy: '',
  legal_aa_promise: '', legal_pet_authorization: ''
});
const savingHotfix = ref(false);

// 弹窗
const editVisible = ref(false);
const editRow = reactive({ doc_type: '', label: '', version: 0, maxLen: 8000 });
const editForm = reactive({ title: '', content: '', remark: '' });

const historyVisible = ref(false);
const historyRow = reactive({ doc_type: '', label: '' });
const historyList = ref([]);

const previewVisible = ref(false);
const previewTitle = ref('');
const previewText = ref('');

const docRows = ref([]);

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 组装表格行：每类文档取 published 版本；无则显示未发布
function rebuildRows() {
  docRows.value = DOC_META.map((m) => {
    const list = versions.value.filter((v) => v.doc_type === m.doc_type);
    const pub = list.find((v) => v.status === 'published') || null;
    return {
      doc_type: m.doc_type,
      label: m.label,
      maxLen: m.maxLen,
      version: pub ? pub.version : 0,
      effective_at: pub ? pub.effective_at : 0,
      created_by: pub ? pub.created_by : '',
      content: pub ? pub.content : '',
      versions: list
    };
  });
}

async function load() {
  loading.value = true;
  const [rc, rl] = await Promise.all([call('config_get'), call('legal_doc_list')]);
  loading.value = false;

  if (rc.ok && rc.data) {
    data.value = rc.data;
    sceneOptions.value = rc.data.scene_list || [];
    const lg = rc.data.legal || {};
    patch.legal_disclaimer_text = lg.disclaimer_text || '';
    patch.legal_service_agreement = lg.service_agreement || '';
    patch.legal_privacy_policy = lg.privacy_policy || '';
    patch.legal_aa_promise = lg.aa_promise || '';
    patch.legal_pet_authorization = lg.pet_authorization || '';
    sceneDisclaimers.value = Object.entries(lg.scene_disclaimers || {}).map(([scene, text]) => ({ scene, text }));
  } else {
    ElMessage.error(rc.msg || '配置加载失败');
  }

  if (rl.ok && rl.data) {
    versions.value = rl.data.list || [];
  } else {
    // 版本库尚不可用时降级：仅热修通道可用
    versions.value = [];
    ElMessage.warning(rl.msg || '版本库加载失败（可先使用紧急热修通道）');
  }
  rebuildRows();
}

// 存量迁移：把配置里的现有文案补成 v1
async function seed() {
  seeding.value = true;
  const r = await call('legal_doc_seed', {});
  seeding.value = false;
  if (r.ok) {
    const seeded = (r.data && r.data.seeded) || [];
    ElMessage.success(seeded.length ? `已初始化 ${seeded.map((x) => `${x.doc_type} v${x.version}`).join('、')}` : '无可初始化文档（可能已存在版本或文案为空）');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '初始化失败');
  }
}

function openEdit(row) {
  editRow.doc_type = row.doc_type;
  editRow.label = row.label;
  editRow.version = row.version || 0;
  editRow.maxLen = row.maxLen;
  editForm.title = '';
  // 默认载入当前生效文案；未发布则回落到热修区内容
  editForm.content = row.content || hotfixField(row.doc_type) || '';
  editForm.remark = '';
  editVisible.value = true;
}

function hotfixField(docType) {
  const map = {
    service_agreement: patch.legal_service_agreement,
    privacy_policy: patch.legal_privacy_policy,
    disclaimer: patch.legal_disclaimer_text,
    aa_promise: patch.legal_aa_promise,
    pet_authorization: patch.legal_pet_authorization
  };
  return map[docType] || '';
}

async function publish() {
  if (!editForm.content.trim()) {
    ElMessage.warning('正文不能为空');
    return;
  }
  publishing.value = true;
  const r = await call('legal_doc_publish', {
    doc_type: editRow.doc_type,
    content: editForm.content,
    title: editForm.title,
    remark: editForm.remark
  });
  publishing.value = false;
  if (r.ok) {
    ElMessage.success(`已发布 v${r.data.version}`);
    editVisible.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '发布失败');
  }
}

function openHistory(row) {
  historyRow.doc_type = row.doc_type;
  historyRow.label = row.label;
  historyList.value = (row.versions || []).slice().sort((a, b) => b.version - a.version);
  historyVisible.value = true;
}

async function rollback(row) {
  try {
    await ElMessageBox.confirm(
      `将以 v${row.version} 的内容生成一个新版本并设为生效，当前版本将归档。是否继续？`,
      '确认回滚',
      { type: 'warning', confirmButtonText: '回滚', cancelButtonText: '取消' }
    );
  } catch (e) { return; }
  rolling.value = true;
  const r = await call('legal_doc_rollback', { doc_type: historyRow.doc_type, version: row.version });
  rolling.value = false;
  if (r.ok) {
    ElMessage.success(`已回滚，新版本 v${r.data.version}`);
    historyVisible.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '回滚失败');
  }
}

function preview(row) {
  previewTitle.value = `${row.label} · v${row.version}（生效中）`;
  previewText.value = row.content || '';
  previewVisible.value = true;
}

function previewVersion(row) {
  previewTitle.value = `${historyRow.label} · v${row.version}`;
  previewText.value = row.content || '';
  previewVisible.value = true;
}

// 场景免责保存（沿用 config_set）
function addSceneDisclaimer() {
  sceneDisclaimers.value.push({ scene: '', text: '' });
}
function removeSceneDisclaimer(idx) {
  sceneDisclaimers.value.splice(idx, 1);
}

async function saveScene() {
  const sceneMap = {};
  for (const { scene, text } of sceneDisclaimers.value) {
    if (scene && text) sceneMap[scene] = text;
  }
  savingScene.value = true;
  const r = await call('config_set', { legal_scene_disclaimers: sceneMap });
  savingScene.value = false;
  if (r.ok) {
    ElMessage.success('场景免责已保存');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '保存失败');
  }
}

// 紧急热修保存（直改配置，不产生版本）
async function saveHotfix() {
  savingHotfix.value = true;
  const r = await call('config_set', {
    legal_disclaimer_text: patch.legal_disclaimer_text,
    legal_service_agreement: patch.legal_service_agreement,
    legal_privacy_policy: patch.legal_privacy_policy,
    legal_aa_promise: patch.legal_aa_promise,
    legal_pet_authorization: patch.legal_pet_authorization
  });
  savingHotfix.value = false;
  if (r.ok) {
    ElMessage.success('已直接覆盖保存（未产生版本记录）');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '保存失败');
  }
}

onMounted(load);
</script>
