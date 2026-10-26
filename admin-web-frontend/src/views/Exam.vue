<template>
  <div>
    <h3 style="margin:0 0 16px">学习考试中心</h3>
    <el-alert type="warning" :closable="false" style="margin-bottom:16px">
      题库与科目规则由运营配置，修改后小程序端 ≤5 分钟生效（云端 5 分钟缓存）。题目答案仅后台保存，不对耍伴端下发。
    </el-alert>

    <el-tabs v-model="tab">
      <el-tab-pane label="科目与规则" name="subjects" lazy>
        <SubjectsPanel />
      </el-tab-pane>
      <el-tab-pane label="题库管理" name="questions" lazy>
        <QuestionsPanel />
      </el-tab-pane>
      <el-tab-pane label="课程预览" name="content" lazy>
        <ContentPreview />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import SubjectsPanel from './exam/SubjectsPanel.vue';
import QuestionsPanel from './exam/QuestionsPanel.vue';
import ContentPreview from './exam/ContentPreview.vue';

const tab = ref('subjects');
</script>
