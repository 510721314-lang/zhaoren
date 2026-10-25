<template>
  <div v-loading="loading">
    <h3 style="margin:0 0 16px">法律合规</h3>
    <el-alert type="warning" :closable="false" style="margin-bottom:16px">
      协议文本采用<b>版本化发布</b>：每条文档/每个场景各自独立「重置 / 保存」，保存即生成新版本并回写配置。
      历史版本永久留档、可一键回滚。
    </el-alert>

    <!-- ① 五类法律文档 -->
    <el-card style="margin-bottom:16px">
      <template #header>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <b>协议文档库</b>
          <el-button v-if="versions.length === 0" size="small" type="primary" plain :loading="seeding" @click="seed">
            初始化版本库（迁移存量文案）
          </el-button>
        </div>
      </template>

      <el-table :data="docRows" style="width:100%">
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
            <el-button size="small" type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" plain @click="openHistory(row.doc_type, '', row.label)">版本历史</el-button>
            <el-button v-if="row.version" size="small" text type="primary" @click="preview(row.label + ' · v' + row.version, row.content)">预览</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="versions.length === 0" style="color:#909399;font-size:13px;margin-top:8px">
        尚无版本记录。点击右上角「初始化版本库」把当前配置文案迁移为 v1（幂等，可重复执行）。
      </div>
    </el-card>

    <!-- ② 场景专属免责声明（每条独立版本线） -->
    <el-card style="margin-bottom:16px">
      <template #header>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <b>场景专属免责声明</b>
          <el-tooltip
            :disabled="availableScenes.length > 0"
            placement="top"
            :content="allScenesConfigured
              ? '全部 ' + (sceneOptions || []).length + ' 个场景均已配置免责声明；如需重新起一条，请先在该行点「删除（停用）」'
              : '新增行已占用剩余可选场景，先取消一行再新增'">
            <span>
              <el-button
                size="small" type="primary" plain
                :disabled="availableScenes.length === 0"
                @click="addSceneRow">+ 新增场景</el-button>
            </span>
          </el-tooltip>
        </div>
      </template>
      <el-alert type="info" :closable="false" style="margin-bottom:12px">
        「新增场景」仅列出<b>尚未配置</b>免责声明的场景；已配置行的场景固定不可改（如需换场景请删除后重新新增）。单场景最多 4000 字。
      </el-alert>
      <!-- 2026-10-25 反馈修复: 满态原因由「灰色小字」改为醒目提示条 + 说明出路；条件改为「配置数==场景数」防误报 -->
      <el-alert v-if="allScenesConfigured" type="success" :closable="false" show-icon style="margin-bottom:10px">
        <template #title>
          全部 {{ (sceneOptions || []).length }} 个场景均已配置免责声明
        </template>
        <div style="font-size:13px;line-height:1.7">
          因此「新增场景」不可用（这是正常的满态，不是故障）。<br>
          ① 要<b>修改已有场景</b>文案：直接在该行编辑后点「保存」；<br>
          ② 要<b>重新起一条</b>记录：先在该行点「停用」，该场景随即回到可选列表。
        </div>
      </el-alert>
      <el-alert v-else-if="(sceneOptions || []).length === 0" type="warning" :closable="false" show-icon style="margin-bottom:10px">
        <template #title>当前没有任何场景</template>
        <div style="font-size:13px">请先到「运营配置」创建场景，再回来配置场景免责声明。</div>
      </el-alert>
      <div v-else-if="availableScenes.length === 0" style="color:#909399;font-size:13px;margin-bottom:8px">
        新增行已占用剩余可选场景，请先取消其中一行。
      </div>

      <div v-for="(row, idx) in sceneRows" :key="row.code || ('new-' + idx)"
           style="border:1px solid #ebeef5;border-radius:8px;padding:12px;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <!-- 已配置：只读标签；新增行：下拉（仅未配置项） -->
          <template v-if="row.isNew">
            <el-select v-model="row.code" placeholder="选择场景（仅显示未配置项）" style="width:220px" @change="onNewRowCodeChange(row)">
              <el-option v-for="s in availableScenesFor(row)" :key="s.code" :label="s.name + '（' + s.code + '）'" :value="s.code" />
            </el-select>
          </template>
          <template v-else>
            <el-tag size="default" type="info">{{ row.name }}（{{ row.code }}）</el-tag>
            <el-tag v-if="!row.online" size="small" type="warning">已下线场景</el-tag>
            <el-tag v-if="row.version" size="small" type="success">v{{ row.version }}</el-tag>
          </template>

          <div style="margin-left:auto;display:flex;gap:8px">
            <el-button v-if="!row.isNew" size="small" text type="primary" @click="openHistory('scene_disclaimer', row.code, row.name + '（' + row.code + '）')">版本历史</el-button>
            <el-button size="small" :disabled="!rowDirty(row)" @click="resetSceneRow(row)">重置</el-button>
            <el-button size="small" type="primary" :loading="row.saving"
                       :disabled="!row.text.trim() || !rowDirty(row) || (row.isNew && !row.code)"
                       @click="saveSceneRow(row)">保存</el-button>
            <el-button size="small" type="danger" plain :loading="row.saving" @click="removeSceneRow(row)">{{ row.isNew ? '取消' : '停用' }}</el-button>
          </div>
        </div>
        <el-input v-model="row.text" type="textarea" :rows="4" :maxlength="4000" show-word-limit
                  :placeholder="row.isNew ? '选择场景后填写免责声明' : '该场景的免责声明'" />
      </div>

      <el-empty v-if="sceneRows.length === 0" description="暂无场景专属免责声明" :image-size="80" />
    </el-card>

    <!-- ③ 紧急热修通道（直改配置，不产生版本） -->
    <el-collapse style="margin-bottom:16px">
      <el-collapse-item name="hotfix">
        <template #title>
          <span style="color:#e6a23c;font-weight:600">紧急热修通道（直改配置，不产生版本，建议仅在事故时使用）</span>
        </template>
        <el-alert type="warning" :closable="false" style="margin-bottom:12px">
          此处修改直接覆盖 <code>admin_config.legal_*</code>，<b>不生成版本记录</b>。法律文案变更请优先走上方版本化发布，以便留存版本与审计链。
        </el-alert>
        <el-form v-if="cfgData" label-width="140px" label-position="right">
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

    <!-- 文档编辑弹窗（每文档独立：重置 / 保存） -->
    <el-dialog v-model="editVisible" :title="`编辑 · ${editRow.label || ''}`" width="760px" destroy-on-close>
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
        保存后生成 <b>v{{ (editRow.version || 0) + 1 }}</b> 并立即生效；旧版本自动归档保留。
      </el-alert>
      <template #footer>
        <el-button @click="resetDocEdit">重置</el-button>
        <el-button type="primary" :loading="publishing" :disabled="!editForm.content.trim()" @click="saveDocEdit">
          保存 v{{ (editRow.version || 0) + 1 }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 版本历史弹窗 -->
    <el-dialog v-model="historyVisible" :title="`版本历史 · ${historyRow.label || ''}`" width="820px" destroy-on-close>
      <el-table :data="historyList" style="width:100%">
        <el-table-column label="版本" width="80">
          <template #default="{ row }">v{{ row.version }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'published' ? 'success' : (row.status === 'retired' ? 'danger' : 'info')" size="small">
              {{ row.status === 'published' ? '生效中' : (row.status === 'retired' ? '已停用' : '已归档') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column prop="created_by" label="操作人" width="130" />
        <el-table-column prop="remark" label="说明" min-width="160" />
        <el-table-column label="操作" width="170">
          <template #default="{ row }">
            <el-button size="small" text type="primary" :disabled="!row.content" @click="preview('v' + row.version, row.content)">查看</el-button>
            <el-button v-if="row.status !== 'published' && row.content" size="small" text type="warning" :loading="rolling" @click="rollback(row)">回滚到此版</el-button>
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
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';

// 文档类型元信息（与云端 DOC_TYPES 的非场景部分对齐）
const DOC_META = [
  { doc_type: 'service_agreement', label: '服务协议', maxLen: 20000 },
  { doc_type: 'privacy_policy', label: '隐私政策', maxLen: 20000 },
  { doc_type: 'disclaimer', label: '通用免责声明', maxLen: 8000 },
  { doc_type: 'aa_promise', label: '费用自理承诺书', maxLen: 8000 },
  { doc_type: 'pet_authorization', label: '宠物照料授权书', maxLen: 8000 }
];

const cfgData = ref(null);
const versions = ref([]);            // legal_doc 全量版本（含 scene_disclaimer）
const loading = ref(false);
const seeding = ref(false);
const publishing = ref(false);
const rolling = ref(false);

const docRows = ref([]);
const sceneRows = ref([]);           // [{code,name,online,text,orig,version,isNew,saving}]
const sceneOptions = ref([]);        // config.scene_list

const patch = reactive({
  legal_disclaimer_text: '', legal_service_agreement: '', legal_privacy_policy: '',
  legal_aa_promise: '', legal_pet_authorization: ''
});
// 2026-10-25 评审 P1 修复: 记录热修区加载时的基线，用于判断「热修区是否有未保存改动」
const hotfixOrig = reactive({
  legal_disclaimer_text: '', legal_service_agreement: '', legal_privacy_policy: '',
  legal_aa_promise: '', legal_pet_authorization: ''
});
function hotfixDirty() {
  return Object.keys(patch).some((k) => String(patch[k] || '') !== String(hotfixOrig[k] || ''));
}
const savingHotfix = ref(false);

const editVisible = ref(false);
const editRow = reactive({ doc_type: '', label: '', version: 0, maxLen: 8000 });
const editForm = reactive({ title: '', content: '', remark: '', orig: '' });

const historyVisible = ref(false);
const historyRow = reactive({ doc_type: '', scope: '', label: '' });
const historyList = ref([]);

const previewVisible = ref(false);
const previewTitle = ref('');
const previewText = ref('');

function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 已配置场景 code（用于 R1 下拉过滤） ──
const configuredSceneCodes = computed(() =>
  sceneRows.value.filter((r) => !r.isNew && r.code).map((r) => r.code));
const pendingSceneCodes = computed(() =>
  sceneRows.value.filter((r) => r.isNew && r.code).map((r) => r.code));

// 全局可新增候选（不含任何已配置/已选中项）
const availableScenes = computed(() =>
  (sceneOptions.value || []).filter((s) =>
    !configuredSceneCodes.value.includes(s.code) && !pendingSceneCodes.value.includes(s.code)));

// 满态判定（2026-10-25 反馈修复）：用「已配置数 >= 场景总数」判定，避免「新增行占满候选」时误报为全部已配置
const allScenesConfigured = computed(() => {
  const total = (sceneOptions.value || []).length;
  return total > 0 && configuredSceneCodes.value.length >= total;
});

// 单行可用候选（排除本行已选，避免与其他新增行重复）
function availableScenesFor(row) {
  return (sceneOptions.value || []).filter((s) =>
    !configuredSceneCodes.value.includes(s.code) &&
    (!row.code || s.code === row.code) &&
    !sceneRows.value.some((x) => x !== row && x.isNew && x.code === s.code));
}

function rowDirty(row) {
  return String(row.text || '') !== String(row.orig || '');
}

// ── 构建表格行 ──
function rebuildDocs() {
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
      content: pub ? pub.content : ''
    };
  });
}

function rebuildScenes() {
  const map = (cfgData.value && cfgData.value.legal && cfgData.value.legal.scene_disclaimers) || {};
  const list = sceneOptions.value || [];
  // 新增中的空行（未保存草稿）保留
  const pending = sceneRows.value.filter((r) => r.isNew);
  // 2026-10-25 评审 P1 修复: 保存后 load() 重建时，**其它行未保存的改动不得被覆盖**（验收 A13）。
  // 口径: text 保留脏值、orig 刷新为最新线上值 → 该行仍判脏、保存按钮仍亮，但基准不残留旧线上值。
  const prev = new Map(sceneRows.value.filter((r) => !r.isNew && r.code).map((r) => [r.code, r]));
  const rows = Object.keys(map).map((code) => {
    const s = list.find((x) => x.code === code);
    const vs = versions.value.filter((v) => v.doc_type === 'scene_disclaimer' && v.scope === code);
    const pub = vs.find((v) => v.status === 'published') || null;
    const fresh = map[code] || '';
    const old = prev.get(code);
    const keepText = (old && rowDirty(old)) ? old.text : fresh;
    return {
      code,
      name: s ? s.name : '已下线场景',
      online: !!s,
      text: keepText,
      orig: fresh,
      version: pub ? pub.version : 0,
      isNew: false,
      saving: false
    };
  });
  sceneRows.value = rows.concat(pending);
}

async function load() {
  loading.value = true;
  const [rc, rl] = await Promise.all([call('config_get'), call('legal_doc_list')]);
  loading.value = false;

  if (rc.ok && rc.data) {
    cfgData.value = rc.data;
    sceneOptions.value = rc.data.scene_list || [];
    const lg = rc.data.legal || {};
    patch.legal_disclaimer_text = lg.disclaimer_text || '';
    patch.legal_service_agreement = lg.service_agreement || '';
    patch.legal_privacy_policy = lg.privacy_policy || '';
    patch.legal_aa_promise = lg.aa_promise || '';
    patch.legal_pet_authorization = lg.pet_authorization || '';
    Object.keys(hotfixOrig).forEach((k) => { hotfixOrig[k] = patch[k]; });
  } else {
    ElMessage.error(rc.msg || '配置加载失败');
  }
  if (rl.ok && rl.data) {
    versions.value = rl.data.list || [];
  } else {
    versions.value = [];
    ElMessage.warning(rl.msg || '版本库加载失败（可先用紧急热修通道）');
  }
  rebuildDocs();
  rebuildScenes();
}

// ── 存量迁移 ──
async function seed() {
  seeding.value = true;
  const r = await call('legal_doc_seed', {});
  seeding.value = false;
  if (r.ok) {
    const s = (r.data && r.data.seeded) || [];
    ElMessage.success(s.length ? `已初始化 ${s.length} 项` : '无可初始化文档');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '初始化失败');
  }
}

// ── 五类文档：编辑弹窗（重置 / 保存） ──
function openEdit(row) {
  editRow.doc_type = row.doc_type;
  editRow.label = row.label;
  editRow.version = row.version || 0;
  editRow.maxLen = row.maxLen;
  editForm.title = '';
  editForm.content = row.content || fieldFallback(row.doc_type);
  editForm.orig = editForm.content;
  editForm.remark = '';
  editVisible.value = true;
}

function fieldFallback(docType) {
  const m = {
    service_agreement: patch.legal_service_agreement,
    privacy_policy: patch.legal_privacy_policy,
    disclaimer: patch.legal_disclaimer_text,
    aa_promise: patch.legal_aa_promise,
    pet_authorization: patch.legal_pet_authorization
  };
  return m[docType] || '';
}

// 重置：丢弃改动，回填当前生效内容（零网络请求）
function resetDocEdit() {
  editForm.content = editForm.orig;
  editForm.title = '';
  editForm.remark = '';
  ElMessage.info('已重置为当前生效内容');
}

async function saveDocEdit() {
  if (!editForm.content.trim()) { ElMessage.warning('正文不能为空'); return; }
  try {
    await ElMessageBox.confirm(
      `将生成 v${(editRow.version || 0) + 1} 并立即生效，旧版本自动归档。是否继续？`,
      '确认保存',
      { type: 'warning', confirmButtonText: '保存并生效', cancelButtonText: '取消' }
    );
  } catch (e) { return; }
  publishing.value = true;
  const r = await call('legal_doc_publish', {
    doc_type: editRow.doc_type,
    content: editForm.content,
    title: editForm.title,
    remark: editForm.remark
  });
  publishing.value = false;
  if (r.ok) {
    ElMessage.success(`已保存 v${r.data.version}`);
    editVisible.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '保存失败');
  }
}

// ── 场景行：新增 / 重置 / 保存 / 删除 ──
function addSceneRow() {
  sceneRows.value.push({ code: '', name: '', online: true, text: '', orig: '', version: 0, isNew: true, saving: false });
}

function onNewRowCodeChange(row) {
  const s = (sceneOptions.value || []).find((x) => x.code === row.code);
  row.name = s ? s.name : row.code;
}

function resetSceneRow(row) {
  row.text = row.orig;
  ElMessage.info('已重置为该场景当前生效内容');
}

async function saveSceneRow(row) {
  if (!row.code) { ElMessage.warning('请先选择场景'); return; }
  if (!row.text.trim()) { ElMessage.warning('免责声明不能为空'); return; }
  try {
    await ElMessageBox.confirm(
      `将为场景「${row.name || row.code}」生成新版本并立即生效。是否继续？`,
      '确认保存',
      { type: 'warning', confirmButtonText: '保存并生效', cancelButtonText: '取消' }
    );
  } catch (e) { return; }
  row.saving = true;
  const r = await call('legal_doc_publish', {
    doc_type: 'scene_disclaimer',
    scope: row.code,
    content: row.text,
    remark: row.isNew ? '新增场景免责' : ''
  });
  row.saving = false;
  if (r.ok) {
    ElMessage.success(`已保存 v${r.data.version}`);
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '保存失败');
  }
}

async function removeSceneRow(row) {
  if (row.isNew) {
    sceneRows.value = sceneRows.value.filter((x) => x !== row);
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将停用场景「${row.name || row.code}」的免责声明：写入一个「已停用」版本并从配置移除（历史保留，可回滚恢复）。是否继续？`,
      '确认停用',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }
    );
  } catch (e) { return; }
  row.saving = true;
  const r = await call('legal_doc_retire', { doc_type: 'scene_disclaimer', scope: row.code, remark: '后台停用' });
  row.saving = false;
  if (r.ok) {
    ElMessage.success('已停用');
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '停用失败');
  }
}

// ── 版本历史（文档 / 场景共用） ──
function openHistory(docType, scope, label) {
  historyRow.doc_type = docType;
  historyRow.scope = scope || '';
  historyRow.label = label;
  historyList.value = versions.value
    .filter((v) => v.doc_type === docType && String(v.scope || '') === String(scope || ''))
    .slice().sort((a, b) => b.version - a.version);
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
  const payload = { doc_type: historyRow.doc_type, version: row.version };
  if (historyRow.scope) payload.scope = historyRow.scope;
  const r = await call('legal_doc_rollback', payload);
  rolling.value = false;
  if (r.ok) {
    ElMessage.success(`已回滚，新版本 v${r.data.version}`);
    historyVisible.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '回滚失败');
  }
}

function preview(title, text) {
  previewTitle.value = title;
  previewText.value = text || '';
  previewVisible.value = true;
}

// ── 紧急热修（整块覆盖，不产生版本） ──
async function saveHotfix() {
  try {
    await ElMessageBox.confirm('直接覆盖配置且不生成版本记录，确定继续？', '紧急热修', { type: 'warning' });
  } catch (e) { return; }
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

// R3-4：有未保存改动时离开需确认
// 2026-10-25 评审 P1 修复: 覆盖范围扩至「场景行 / 文档弹窗正文+标题+变更说明 / 热修区」，
// 并补 beforeunload（刷新、关闭标签页）——原实现只有路由守卫，F5 会静默丢改动。
const hasUnsaved = computed(() => {
  if (sceneRows.value.some((r) => rowDirty(r))) return true;
  if (editVisible.value && (editForm.content !== editForm.orig
    || String(editForm.title || '').trim() !== ''
    || String(editForm.remark || '').trim() !== '')) return true;
  return hotfixDirty();
});

onBeforeRouteLeave(() => {
  if (!hasUnsaved.value) return true;
  return window.confirm('存在未保存的修改，确定离开？');
});

function onBeforeUnload(e) {
  if (!hasUnsaved.value) return;
  e.preventDefault();
  e.returnValue = '';   // 部分浏览器需设置该字段才弹原生确认
}

onMounted(() => {
  load();
  window.addEventListener('beforeunload', onBeforeUnload);
});
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload));

</script>
