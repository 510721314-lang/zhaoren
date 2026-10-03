// views/Exam.vue · 认证考试管理系统
// 数据源: admin-action exam_* (exam_bank 独立集合, 答案 answer_idx 不随 admin_config 导出)
// 功能: 科目列表(增减/启停/通过线/前置科目) + 题库编辑(单选题目, 每题 2-6 选项) + 一键初始化题库
<template>
  <div>
    <h3 style="margin:0 0 16px">认证考试管理</h3>
    <el-alert type="warning" :closable="false" style="margin-bottom:16px">
      考试科目/通过规则/题库由运营配置，修改后小程序端 ≤5 分钟生效（云端 5 分钟缓存）。题目答案仅云端保存，不对耍伴端下发。
    </el-alert>

    <div style="margin-bottom:12px;display:flex;align-items:center;gap:12px">
      <el-button type="primary" @click="openCreate">+ 新增考试科目</el-button>
      <el-button type="warning" plain :loading="seeding" @click="seed">一键初始化题库（base/W1）</el-button>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table :data="list" border stripe size="small" style="width:100%">
      <el-table-column prop="code" label="科目 code" width="110" />
      <el-table-column prop="title" label="名称" width="160" />
      <el-table-column label="通过线" width="90">
        <template #default="{ row }">{{ row.pass_line }} 分</template>
      </el-table-column>
      <el-table-column label="前置科目" width="150">
        <template #default="{ row }">
          <el-tag v-for="r in row.requires" :key="r" size="small" style="margin-right:4px">{{ r }}</el-tag>
          <span v-if="!row.requires || row.requires.length === 0" style="color:#999">无</span>
        </template>
      </el-table-column>
      <el-table-column prop="question_count" label="题数" width="70" />
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" min-width="200">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row.code)">编辑题库</el-button>
          <el-button size="small" @click="toggleEnabled(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
          <el-button size="small" type="danger" plain @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 编辑弹窗: 基础信息 + 前置科目 + 题目动态行 -->
    <el-dialog v-model="dlg.visible" :title="dlg.isCreate ? '新增考试科目' : `编辑科目 · ${dlg.code}`" width="720px" top="6vh">
      <el-form label-width="90px" label-position="right">
        <el-form-item label="科目 code" v-if="dlg.isCreate">
          <el-input v-model="dlg.code" placeholder="如 W2 / 新科目唯一标识(字母数字下划线, 1-20位)" style="width:280px" />
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="dlg.title" placeholder="如：耍伴基础考试" :maxlength="20" show-word-limit style="width:280px" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="dlg.desc" placeholder="科目说明(展示给耍伴端)" :maxlength="100" show-word-limit style="width:420px" />
        </el-form-item>
        <el-form-item label="通过线" required>
          <el-input-number v-model="dlg.pass_line" :min="0" :max="100" :step="1" />
          <span style="margin-left:8px;color:#999">达到该分数视为通过（百分制）</span>
        </el-form-item>
        <el-form-item label="前置科目">
          <el-select v-model="dlg.requires" multiple placeholder="无前置则可直接考" style="width:280px">
            <el-option v-for="s in list" :key="s.code" :label="s.title" :value="s.code" :disabled="s.code === dlg.code" />
          </el-select>
          <span style="margin-left:8px;color:#999">需先通过前置科目方可参加本科目考试</span>
        </el-form-item>

        <el-divider content-position="left">题库（单选）</el-divider>
        <el-alert type="info" :closable="false" style="margin-bottom:12px">
          每题 1 个题干 + 2-6 个选项，标记正确答案。每科目 ≤60 题（网关体积限制）。
        </el-alert>
        <div v-for="(q, qi) in dlg.questions" :key="qi" style="border:1px solid #ebeef5;border-radius:8px;padding:12px;margin-bottom:12px">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <el-tag size="small" style="margin-top:6px">{{ qi + 1 }}</el-tag>
            <el-input v-model="q.question" type="textarea" :rows="1" :maxlength="500" show-word-limit :placeholder="`第 ${qi + 1} 题题干`" />
            <el-button type="danger" size="small" plain style="flex:none" @click="removeQuestion(qi)">删除</el-button>
          </div>
          <div style="margin-top:8px">
            <div v-for="(opt, oi) in q.options" :key="oi" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <el-radio v-model="q.answer_idx" :value="oi" size="small">答案</el-radio>
              <el-input v-model="q.options[oi]" :maxlength="50" :placeholder="`选项 ${String.fromCharCode(65 + oi)}`" style="flex:1" />
              <el-button size="small" text type="danger" @click="removeOption(q, oi)">✕</el-button>
            </div>
            <el-button size="small" plain @click="addOption(q)" v-if="q.options.length < 6">+ 添加选项</el-button>
          </div>
        </div>
        <el-button type="primary" plain @click="addQuestion">+ 新增题目</el-button>
      </el-form>

      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';

const list = ref([]);
const seeding = ref(false);

const dlg = reactive({
  visible: false, isCreate: false, code: '', title: '', desc: '', pass_line: 100,
  requires: [], questions: [], saving: false
});

function blankQuestion() { return { question: '', options: ['', '', '', ''], answer_idx: 0 }; }

async function load() {
  const r = await call('exam_subject_list');
  if (r.ok && r.data) list.value = r.data.list || [];
  else ElMessage.error(r.msg || r.code || '加载失败');
}

function openCreate() {
  Object.assign(dlg, { visible: true, isCreate: true, code: '', title: '', desc: '', pass_line: 100, requires: [], questions: [blankQuestion()] });
}

async function openEdit(code) {
  const r = await call('exam_subject_detail', { code });
  if (!r.ok || !r.data) { ElMessage.error(r.msg || '加载失败'); return; }
  const s = r.data.subject;
  Object.assign(dlg, {
    visible: true, isCreate: false, code: s.code, title: s.title, desc: s.desc || '',
    pass_line: s.pass_line, requires: s.requires || [], questions: (r.data.questions || []).map((q) => ({
      question: q.question, options: q.options.slice(), answer_idx: q.answer_idx
    })), saving: false
  });
  if (dlg.questions.length === 0) dlg.questions = [blankQuestion()];
}

function addQuestion() { dlg.questions.push(blankQuestion()); }
function removeQuestion(i) { dlg.questions.splice(i, 1); }
function addOption(q) { if (q.options.length < 6) q.options.push(''); }
function removeOption(q, oi) {
  if (q.options.length <= 2) { ElMessage.warning('至少保留 2 个选项'); return; }
  q.options.splice(oi, 1);
  if (q.answer_idx > oi) q.answer_idx -= 1;
  else if (q.answer_idx === oi) q.answer_idx = 0;
}

async function save() {
  const code = dlg.code.trim();
  const title = dlg.title.trim();
  if (!code || !title) { ElMessage.warning('科目 code 和名称必填'); return; }
  if (!dlg.questions.some((q) => q.question.trim())) { ElMessage.warning('至少需 1 道有效题目'); return; }
  dlg.saving = true;
  const payload = {
    code, title, desc: dlg.desc, pass_line: dlg.pass_line,
    requires: dlg.requires, enabled: true,
    questions: dlg.questions.map((q) => ({ question: q.question, options: q.options, answer_idx: q.answer_idx }))
  };
  const r = dlg.isCreate ? await call('exam_subject_create', payload) : await call('exam_subject_update', payload);
  dlg.saving = false;
  if (r.ok) { ElMessage.success('已保存'); dlg.visible = false; await load(); }
  else ElMessage.error(r.msg || r.code || '保存失败');
}

async function toggleEnabled(row) {
  const r = await call('exam_subject_update', {
    code: row.code, title: row.title, desc: row.desc, pass_line: row.pass_line,
    requires: row.requires, enabled: !row.enabled,
    questions: await fetchQuestionsFor(row.code)
  });
  if (r.ok) { ElMessage.success(row.enabled ? '已停用' : '已启用'); await load(); }
  else ElMessage.error(r.msg || '操作失败');
}
async function fetchQuestionsFor(code) {
  const r = await call('exam_subject_detail', { code });
  return (r.ok && r.data && r.data.questions) || [];
}

async function remove(row) {
  try { await ElMessageBox.confirm(`确认删除考试科目「${row.title}」？被其它科目前置引用的科目不可删除。`, '删除确认', { type: 'warning' }); } catch { return; }
  const r = await call('exam_subject_delete', { code: row.code });
  if (r.ok) { ElMessage.success('已删除'); await load(); }
  else ElMessage.error(r.msg || '删除失败');
}

async function seed() {
  seeding.value = true;
  const r = await call('exam_bank_seed');
  seeding.value = false;
  if (r.ok) { ElMessage.success(`初始化完成: 新建 ${(r.data && r.data.created || []).join('、') || '无'} / 已存在跳过 ${(r.data && r.data.skipped || []).join('、') || '无'}`); await load(); }
  else ElMessage.error(r.msg || '初始化失败');
}

onMounted(load);
</script>
