<template>
  <div>
    <el-alert type="info" :closable="false" style="margin-bottom:12px">
      科目元数据（名称/通过线/前置/启停）在此维护；题目请到「题库管理」维护。科目新增与删除暂未开放。
    </el-alert>
    <div style="margin-bottom:12px;display:flex;gap:8px">
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="list" border stripe size="small" style="width:100%">
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
      <el-table-column label="题量（已发布/总数）" width="150">
        <template #default="{ row }">{{ row.published_count }} / {{ row.question_count }}</template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" min-width="160">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" @click="toggleEnabled(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dlg.visible" :title="`编辑科目 · ${dlg.code}`" width="560px">
      <el-form label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="dlg.title" :maxlength="20" show-word-limit style="width:280px" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="dlg.desc" :maxlength="100" show-word-limit style="width:420px" />
        </el-form-item>
        <el-form-item label="通过线" required>
          <el-input-number v-model="dlg.pass_line" :min="0" :max="100" :step="1" />
        </el-form-item>
        <el-form-item label="前置科目">
          <el-select v-model="dlg.requires" multiple placeholder="无前置则可直接考" style="width:280px">
            <el-option v-for="s in list" :key="s.code" :label="s.title" :value="s.code" :disabled="s.code === dlg.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="dlg.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../../api/admin.js';

const list = ref([]);
const loading = ref(false);
const dlg = reactive({
  visible: false, saving: false, code: '', title: '', desc: '', pass_line: 100, requires: [], enabled: true
});

async function load() {
  loading.value = true;
  const r = await call('exam_subject_overview');
  loading.value = false;
  if (r.ok && r.data) list.value = r.data.list || [];
  else ElMessage.error(r.msg || r.code || '加载失败');
}

function openEdit(row) {
  Object.assign(dlg, {
    visible: true, saving: false, code: row.code, title: row.title, desc: row.desc || '',
    pass_line: row.pass_line, requires: (row.requires || []).slice(), enabled: !!row.enabled
  });
}

async function submit(payload) {
  const r = await call('exam_subject_meta_update', payload);
  if (r.ok) { ElMessage.success('已保存'); await load(); }
  else ElMessage.error(r.msg || r.code || '保存失败');
  return r.ok;
}

async function save() {
  if (!dlg.title.trim()) { ElMessage.warning('名称必填'); return; }
  dlg.saving = true;
  const ok = await submit({
    code: dlg.code, title: dlg.title.trim(), desc: dlg.desc, pass_line: dlg.pass_line,
    requires: dlg.requires, enabled: dlg.enabled
  });
  dlg.saving = false;
  if (ok) dlg.visible = false;
}

async function toggleEnabled(row) {
  await submit({
    code: row.code, title: row.title, desc: row.desc, pass_line: row.pass_line,
    requires: row.requires || [], enabled: !row.enabled
  });
}

onMounted(load);
</script>
