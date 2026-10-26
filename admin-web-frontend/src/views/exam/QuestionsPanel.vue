<template>
  <div>
    <el-alert type="info" :closable="false" style="margin-bottom:12px">
      题目以 questions 集合为唯一数据源；草稿不会被小程序拉题命中，发布后 ≤5 分钟生效。答案仅后台可见。
    </el-alert>

    <div style="margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px">
      <el-select v-model="filter.subject" placeholder="全部科目" clearable style="width:150px" @change="search">
        <el-option v-for="s in subjects" :key="s.code" :label="`${s.title}（${s.published_count}）`" :value="s.code" />
      </el-select>
      <el-select v-model="filter.status" placeholder="全部状态" clearable style="width:130px" @change="search">
        <el-option label="已发布" value="published" />
        <el-option label="草稿" value="draft" />
      </el-select>
      <el-input v-model="filter.keyword" placeholder="题干/题号/知识点" clearable style="width:230px" @keyup.enter="search" />
      <el-button @click="search">查询</el-button>
      <el-button type="primary" @click="openCreate">+ 新增题目</el-button>
      <el-button type="warning" plain @click="openImport">Markdown 导入</el-button>
      <el-button :disabled="selected.length === 0" @click="bulkStatus('published')">批量发布</el-button>
      <el-button :disabled="selected.length === 0" @click="bulkStatus('draft')">批量下架</el-button>
    </div>

    <el-table
      ref="tableRef" v-loading="loading" :data="list" border stripe size="small" style="width:100%"
      :row-key="rowKey" @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="42" />
      <el-table-column prop="qid" label="题号" width="90" />
      <el-table-column prop="subject" label="科目" width="80" />
      <el-table-column prop="module" label="模块" width="70" />
      <el-table-column label="题型" width="70">
        <template #default="{ row }">{{ row.type === 'multi' ? '多选' : '单选' }}</template>
      </el-table-column>
      <el-table-column prop="stem" label="题干" min-width="260" show-overflow-tooltip />
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">{{ row.status === 'published' ? '已发布' : '草稿' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="score" label="分值" width="60" />
      <el-table-column label="更新时间" width="150">
        <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" plain @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:12px;display:flex;justify-content:flex-end">
      <el-pagination
        v-model:current-page="page" v-model:page-size="size" :total="total"
        :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next"
        @current-change="load" @size-change="load"
      />
    </div>

    <!-- 新增/编辑题目 -->
    <el-dialog v-model="dlg.visible" :title="dlg.isNew ? '新增题目' : `编辑题目 · ${dlg.subject} / ${dlg.qid}`" width="760px" top="5vh">
      <el-form label-width="80px">
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <el-form-item label="科目" required>
            <el-input v-model="dlg.subject" :disabled="!dlg.isNew" style="width:140px" placeholder="base / W1" />
          </el-form-item>
          <el-form-item label="题号" required>
            <el-input v-model="dlg.qid" :disabled="!dlg.isNew" style="width:120px" placeholder="A-01" />
          </el-form-item>
          <el-form-item label="模块">
            <el-input v-model="dlg.module" style="width:100px" placeholder="M1" />
          </el-form-item>
          <el-form-item label="题型">
            <el-select v-model="dlg.type" style="width:110px" @change="onTypeChange">
              <el-option label="单选" value="single" />
              <el-option label="多选" value="multi" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="题干" required>
          <el-input v-model="dlg.stem" type="textarea" :rows="2" :maxlength="500" show-word-limit placeholder="题干 ≤500 字" />
        </el-form-item>
        <el-form-item label="选项" required>
          <div style="width:100%">
            <div v-for="(opt, oi) in dlg.options" :key="oi" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <el-radio v-if="dlg.type === 'single'" v-model="dlg.answer_single" :value="oi" size="small">答案</el-radio>
              <el-checkbox
                v-else :model-value="dlg.answer_multi.includes(oi)" size="small"
                @change="(v) => setMulti(oi, v)"
              >答案</el-checkbox>
              <el-tag size="small" type="info">{{ LETTERS[oi] }}</el-tag>
              <el-input v-model="dlg.options[oi]" :maxlength="50" :placeholder="`选项 ${LETTERS[oi]}`" style="flex:1" />
              <el-button size="small" text type="danger" @click="removeOption(oi)">✕</el-button>
            </div>
            <el-button size="small" plain :disabled="dlg.options.length >= 6" @click="dlg.options.push('')">+ 添加选项</el-button>
          </div>
        </el-form-item>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <el-form-item label="分值">
            <el-input-number v-model="dlg.score" :min="1" :max="100" />
          </el-form-item>
          <el-form-item label="难度">
            <el-select v-model="dlg.difficulty" style="width:110px" clearable placeholder="未标">
              <el-option label="简单" value="easy" />
              <el-option label="中等" value="medium" />
              <el-option label="困难" value="hard" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="dlg.status" style="width:110px">
              <el-option label="草稿" value="draft" />
              <el-option label="已发布" value="published" />
            </el-select>
          </el-form-item>
          <el-form-item label="版本">
            <el-input v-model="dlg.version" style="width:90px" placeholder="V1" />
          </el-form-item>
        </div>
        <el-form-item label="知识点">
          <el-input v-model="dlg.knowledge" :maxlength="50" style="width:320px" />
        </el-form-item>
        <el-form-item label="解析">
          <el-input v-model="dlg.analysis" type="textarea" :rows="2" :maxlength="500" show-word-limit placeholder="成绩单展示用，≤500 字" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- Markdown 导入 -->
    <el-dialog v-model="imp.visible" title="Markdown 批量导入" width="760px" top="5vh">
      <el-alert type="info" :closable="false" style="margin-bottom:10px">
        每道题用 &lt;!-- q:start ... --&gt; 与 &lt;!-- q:end --&gt; 包裹；元信息 key: value；选项以 A. / B. 开头；answer 填 A-F（多选用逗号，如 A,C）。
        单次 ≤200 题，非法条目会逐条回报，合法条目照常落库。
      </el-alert>
      <el-button size="small" plain style="margin-bottom:8px" @click="fillTemplate">填入示例模板</el-button>
      <el-input v-model="imp.text" type="textarea" :rows="14" placeholder="粘贴 Markdown 题目..." />
      <div v-if="imp.result" style="margin-top:10px">
        <el-alert
          :type="imp.result.errors && imp.result.errors.length ? 'warning' : 'success'" :closable="false"
          :title="`共 ${imp.result.total} 题：新增 ${imp.result.created}，更新 ${imp.result.updated}，失败 ${(imp.result.errors || []).length}`"
        />
        <el-table v-if="imp.result.errors && imp.result.errors.length" :data="imp.result.errors" size="small" border style="margin-top:8px;width:100%">
          <el-table-column prop="index" label="序号" width="70" />
          <el-table-column prop="qid" label="题号" width="110" />
          <el-table-column prop="msg" label="原因" />
        </el-table>
      </div>
      <template #footer>
        <el-button @click="imp.visible = false">关闭</el-button>
        <el-button type="primary" :loading="imp.loading" @click="doImport">开始导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../../api/admin.js';

const LETTERS = 'ABCDEF';
const subjects = ref([]);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(20);
const loading = ref(false);
const selected = ref([]);
const tableRef = ref(null);

const filter = reactive({ subject: '', status: '', keyword: '' });
const dlg = reactive({
  visible: false, isNew: true, saving: false,
  subject: 'base', qid: '', module: '', type: 'single', stem: '',
  options: ['', '', '', ''], answer_single: 0, answer_multi: [0],
  score: 1, difficulty: '', knowledge: '', analysis: '', version: 'V1', status: 'draft'
});
const imp = reactive({ visible: false, loading: false, text: '', result: null });

function rowKey(row) { return row.subject + '|' + row.qid; }
function formatTime(ts) { return ts ? new Date(ts).toLocaleString('zh-CN') : '—'; }

async function loadSubjects() {
  const r = await call('exam_subject_overview');
  if (r.ok && r.data) subjects.value = r.data.list || [];
}

function search() { page.value = 1; load(); }

async function load() {
  loading.value = true;
  const r = await call('question_list', {
    subject: filter.subject || undefined, status: filter.status || undefined,
    keyword: filter.keyword || undefined, page: page.value, size: size.value
  });
  loading.value = false;
  if (r.ok && r.data) {
    list.value = r.data.list || [];
    total.value = r.data.total || 0;
  } else {
    ElMessage.error(r.msg || r.code || '加载失败');
  }
}

function onSelectionChange(rows) { selected.value = rows || []; }

function resetDialog() {
  Object.assign(dlg, {
    visible: true, isNew: true, saving: false,
    subject: filter.subject || (subjects.value[0] && subjects.value[0].code) || 'base',
    qid: '', module: '', type: 'single', stem: '',
    options: ['', '', '', ''], answer_single: 0, answer_multi: [0],
    score: 1, difficulty: '', knowledge: '', analysis: '', version: 'V1', status: 'draft'
  });
}

function openCreate() { resetDialog(); }

function openEdit(row) {
  Object.assign(dlg, {
    visible: true, isNew: false, saving: false,
    subject: row.subject, qid: row.qid, module: row.module || '', type: row.type || 'single',
    stem: row.stem || '', options: (row.options || []).slice(),
    answer_single: Array.isArray(row.answer_idx) ? (row.answer_idx[0] || 0) : Number(row.answer_idx) || 0,
    answer_multi: Array.isArray(row.answer_idx) ? row.answer_idx.slice() : [Number(row.answer_idx) || 0],
    score: row.score || 1, difficulty: row.difficulty || '', knowledge: row.knowledge || '',
    analysis: row.analysis || '', version: row.version || 'V1', status: row.status || 'draft'
  });
}

function onTypeChange(t) {
  if (t === 'multi') {
    dlg.answer_multi = [Math.min(dlg.answer_single, dlg.options.length - 1)];
  } else {
    dlg.answer_single = dlg.answer_multi.length ? dlg.answer_multi[0] : 0;
  }
}

function setMulti(oi, checked) {
  const set = new Set(dlg.answer_multi);
  if (checked) set.add(oi); else set.delete(oi);
  dlg.answer_multi = Array.from(set).sort((a, b) => a - b);
}

function removeOption(oi) {
  if (dlg.options.length <= 2) { ElMessage.warning('至少保留 2 个选项'); return; }
  dlg.options.splice(oi, 1);
  if (dlg.answer_single > oi) dlg.answer_single -= 1;
  else if (dlg.answer_single === oi) dlg.answer_single = 0;
  dlg.answer_multi = dlg.answer_multi.filter((x) => x !== oi).map((x) => (x > oi ? x - 1 : x));
  if (!dlg.answer_multi.length) dlg.answer_multi = [0];
  if (dlg.answer_single >= dlg.options.length) dlg.answer_single = 0;
}

async function save() {
  const subject = dlg.subject.trim();
  const qid = dlg.qid.trim();
  if (!subject || !qid) { ElMessage.warning('科目与题号必填'); return; }
  if (!dlg.stem.trim()) { ElMessage.warning('题干必填'); return; }
  if (dlg.options.length < 2 || dlg.options.some((o) => !String(o).trim())) { ElMessage.warning('选项至少 2 项且不能为空'); return; }
  if (dlg.type === 'multi' && dlg.answer_multi.length === 0) { ElMessage.warning('请选择正确答案'); return; }
  const payload = {
    subject, qid, module: dlg.module.trim(), type: dlg.type, stem: dlg.stem.trim(),
    options: dlg.options.map((o) => String(o).trim()),
    answer_idx: dlg.type === 'multi' ? dlg.answer_multi.slice().sort((a, b) => a - b) : dlg.answer_single,
    score: dlg.score, difficulty: dlg.difficulty || '', knowledge: dlg.knowledge.trim(),
    analysis: dlg.analysis.trim(), version: dlg.version.trim() || 'V1', status: dlg.status
  };
  dlg.saving = true;
  const r = await call('question_upsert', payload);
  dlg.saving = false;
  if (r.ok) {
    ElMessage.success(r.data && r.data.created ? '已新增' : '已保存');
    dlg.visible = false;
    await Promise.all([load(), loadSubjects()]);
  } else ElMessage.error(r.msg || r.code || '保存失败');
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除题目 ${row.qid}（${row.stem.slice(0, 20)}...）？`, '删除确认', { type: 'warning' });
  } catch { return; }
  const r = await call('question_delete', { subject: row.subject, qid: row.qid });
  if (r.ok) { ElMessage.success('已删除'); await Promise.all([load(), loadSubjects()]); }
  else ElMessage.error(r.msg || '删除失败');
}

async function bulkStatus(status) {
  if (!selected.value.length) { ElMessage.warning('请先勾选题目'); return; }
  const groups = {};
  for (const row of selected.value) (groups[row.subject] = groups[row.subject] || []).push(row.qid);
  let updated = 0;
  const missing = [];
  for (const [subject, qids] of Object.entries(groups)) {
    const r = await call('question_bulk_status', { subject, qids, status });
    if (!r.ok) { ElMessage.error(r.msg || r.code || '批量操作失败'); return; }
    updated += r.data.updated || 0;
    missing.push(...(r.data.missing || []));
  }
  ElMessage.success(`已更新 ${updated} 题${missing.length ? `，未命中 ${missing.join('、')}` : ''}`);
  await Promise.all([load(), loadSubjects()]);
}

function openImport() {
  imp.visible = true;
  imp.text = '';
  imp.result = null;
}

function fillTemplate() {
  imp.text = [
    '<!-- q:start',
    'subject: base',
    'qid: A-T01',
    'module: M1',
    'answer: A',
    'status: draft',
    'knowledge: 平台定位',
    '-->',
    '题干文本',
    'A. 选项一',
    'B. 选项二',
    'C. 选项三',
    '解析：答案解析文本',
    '<!-- q:end -->'
  ].join('\n');
}

async function doImport() {
  if (!imp.text.trim()) { ElMessage.warning('请粘贴导入内容'); return; }
  imp.loading = true;
  const r = await call('question_import_markdown', { markdown: imp.text });
  imp.loading = false;
  if (!r.ok) { ElMessage.error(r.msg || r.code || '导入失败'); return; }
  imp.result = r.data;
  await Promise.all([load(), loadSubjects()]);
}

onMounted(async () => {
  await loadSubjects();
  await load();
});
</script>
