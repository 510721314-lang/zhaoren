<template>
  <div class="md-body" v-html="html"></div>
</template>

<script setup>
import { computed } from 'vue';

// 极简 Markdown 渲染：仅覆盖学习内容实际使用的语法（标题/段落/加粗/行内代码/分隔线）。
// 所有文本先 HTML 转义再拼装，避免正文里的尖括号/脚本被当成标签执行。
const props = defineProps({ source: { type: String, default: '' } });

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

const html = computed(() => {
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }
  };
  for (const raw of String(props.source || '').split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); out.push('<hr/>'); continue; }
    para.push(t);
  }
  flush();
  return out.join('');
});
</script>

<style scoped>
.md-body { font-size: 14px; line-height: 1.85; color: #303133; word-break: break-word; }
.md-body :deep(h1) { font-size: 20px; margin: 4px 0 12px; }
.md-body :deep(h2) { font-size: 17px; margin: 18px 0 8px; }
.md-body :deep(h3) { font-size: 15px; margin: 14px 0 6px; }
.md-body :deep(h4) { font-size: 14px; margin: 12px 0 6px; }
.md-body :deep(p) { margin: 0 0 10px; }
.md-body :deep(strong) { color: #1f2d3d; }
.md-body :deep(code) { background: #f4f4f5; border-radius: 3px; padding: 1px 4px; font-size: 13px; }
.md-body :deep(hr) { border: 0; border-top: 1px solid #ebeef5; margin: 14px 0; }
</style>
