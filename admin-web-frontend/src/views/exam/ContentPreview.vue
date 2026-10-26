<template>
  <div>
    <el-alert type="info" :closable="false" style="margin-bottom:12px">
      只读预览：内容由 docs/study-content/*.md 经脚本灌入 study_content，后台不提供在线编辑。
    </el-alert>

    <div style="display:flex;gap:16px;align-items:flex-start">
      <div style="width:320px;flex:none;border:1px solid #ebeef5;border-radius:8px;padding:8px;max-height:70vh;overflow:auto">
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <el-select v-model="filter.subject" placeholder="全部科目" clearable size="small" style="width:130px" @change="load">
            <el-option v-for="s in subjects" :key="s.code" :label="s.title" :value="s.code" />
          </el-select>
          <el-select v-model="filter.status" placeholder="全部状态" clearable size="small" style="width:110px" @change="load">
            <el-option label="已发布" value="published" />
            <el-option label="草稿" value="draft" />
          </el-select>
        </div>
        <el-tree
          v-loading="loading" :data="tree" :props="{ label: 'label', children: 'children' }"
          node-key="key" default-expand-all highlight-current :expand-on-click-node="false"
          @node-click="onNodeClick"
        >
          <template #default="{ data }">
            <span style="display:flex;align-items:center;gap:6px;font-size:13px">
              <span>{{ data.label }}</span>
              <el-tag v-if="data.chapter" :type="data.chapter.status === 'published' ? 'success' : 'info'" size="small">
                {{ data.chapter.status === 'published' ? '已发布' : '草稿' }}
              </el-tag>
            </span>
          </template>
        </el-tree>
      </div>

      <div style="flex:1;min-width:0;border:1px solid #ebeef5;border-radius:8px;padding:18px;min-height:300px;max-height:70vh;overflow:auto">
        <template v-if="detail">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <el-tag size="small" type="info">{{ detail.subject }}</el-tag>
            <el-tag size="small" type="info">{{ detail.module_id }} / {{ detail.chapter_id }}</el-tag>
            <el-tag :type="detail.status === 'published' ? 'success' : 'info'" size="small">
              {{ detail.status === 'published' ? '已发布' : '草稿' }}
            </el-tag>
            <span style="color:#999;font-size:12px">更新 {{ formatTime(detail.updated_at) }}</span>
          </div>
          <h2 style="margin:6px 0 14px;font-size:19px">{{ detail.title }}</h2>
          <MarkdownBody :source="detail.body_md" />
        </template>
        <el-empty v-else description="请选择左侧章节查看正文" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../../api/admin.js';
import MarkdownBody from './MarkdownBody.vue';

const subjects = ref([]);
const list = ref([]);
const detail = ref(null);
const loading = ref(false);
const filter = reactive({ subject: '', status: '' });

function formatTime(ts) { return ts ? new Date(ts).toLocaleString('zh-CN') : '—'; }

function moduleOrder(code) {
  const m = String(code || '').match(/\d+/);
  return m ? Number(m[0]) : 999;
}

const tree = computed(() => {
  const subjectMap = {};
  for (const c of list.value) {
    if (!subjectMap[c.subject]) {
      const meta = subjects.value.find((s) => s.code === c.subject);
      subjectMap[c.subject] = { key: 's:' + c.subject, label: meta ? `${meta.title}（${c.subject}）` : c.subject, modules: {} };
    }
    const sm = subjectMap[c.subject];
    if (!sm.modules[c.module_id]) sm.modules[c.module_id] = { key: `m:${c.subject}:${c.module_id}`, label: c.module_id, chapters: [] };
    sm.modules[c.module_id].chapters.push({
      key: `c:${c.subject}:${c.module_id}:${c.chapter_id}`,
      label: c.title || c.chapter_id,
      chapter: c
    });
  }
  return Object.values(subjectMap).map((s) => ({
    key: s.key,
    label: s.label,
    children: Object.values(s.modules)
      .sort((a, b) => moduleOrder(a.label) - moduleOrder(b.label))
      .map((m) => ({ key: m.key, label: m.label, children: m.chapters }))
  }));
});

async function loadSubjects() {
  const r = await call('exam_subject_overview');
  if (r.ok && r.data) subjects.value = r.data.list || [];
}

async function load() {
  loading.value = true;
  const r = await call('content_list', {
    subject: filter.subject || undefined,
    status: filter.status || undefined
  });
  loading.value = false;
  if (!r.ok || !r.data) { ElMessage.error(r.msg || r.code || '加载失败'); return; }
  list.value = r.data.list || [];
  const first = list.value.find((c) => c.status === 'published') || list.value[0];
  if (first) await openChapter(first);
  else detail.value = null;
}

async function openChapter(c) {
  const r = await call('content_detail', { subject: c.subject, module_id: c.module_id, chapter_id: c.chapter_id });
  if (r.ok && r.data) detail.value = r.data.content;
  else ElMessage.error(r.msg || r.code || '正文加载失败');
}

function onNodeClick(data) {
  if (data && data.chapter) openChapter(data.chapter);
}

onMounted(async () => {
  await loadSubjects();
  await load();
});
</script>
