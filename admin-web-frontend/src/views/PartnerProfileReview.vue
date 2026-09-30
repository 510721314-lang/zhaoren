// views/PartnerProfileReview.vue · 耍伴资料审核（bio/技能/亮点）
// 列表来自 admin-action partner_profile_pending_list（含当前快照 vs 待审对比）
// 写操作：partner_profile_review（approve 覆盖快照别 prev / reject 留原因 + 通知）
// 展开行：按分类(简介/技能/亮点)展示【原内容 vs 变更后】并高亮差异 + 审核历史
<template>
  <div>
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:600">耍伴资料待审</span>
      <el-tag type="warning" size="small" v-if="total">{{ total }} 条</el-tag>
      <el-button type="primary" plain :loading="loading" @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border stripe size="small" row-key="openid">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div style="padding:8px 16px;display:flex;gap:28px;flex-wrap:wrap">
            <!-- 审核入口已内联至列表列各分类块 (展开行仅作 diff 复核) -->
            <!-- 一、个人简介 差异 -->
            <div style="flex:1;min-width:240px">
              <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px">① 个人简介</div>
              <div style="font-size:13px;margin-bottom:4px;color:#909399">原内容：{{ row.current.bio || '（空）' }}</div>
              <div style="font-size:13px">变更后：
                <span v-for="(tk,i) in charDiff(row.current.bio, row.pending.bio)" :key="i"
                  :class="tk.t === 1 ? 'diff-add' : (tk.t === 2 ? 'diff-del' : '')">{{ tk.v }}</span>
              </div>
            </div>

            <!-- 二、技能标签 差异 -->
            <div style="flex:1;min-width:240px">
              <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px">② 技能标签</div>
              <div style="font-size:13px;margin-bottom:4px;color:#909399">原内容：</div>
              <div v-if="!row.current.skills.length" style="color:#ccc;font-size:12px;margin-bottom:4px">（空）</div>
              <div v-else style="margin-bottom:6px"><el-tag v-for="s in row.current.skills" :key="s" size="small" type="info" style="margin-right:4px">{{ s }}</el-tag></div>
              <div style="font-size:13px;color:#909399">变更后（差异高亮）：</div>
              <div>
                <el-tag v-for="s in row.pending.skills" :key="s" size="small" style="margin-right:4px" :type="isNew(s, row.current.skills, row.pending.skills) ? 'success' : 'info'">{{ s }}</el-tag>
                <el-tag v-for="s in removedSet(row.current.skills, row.pending.skills)" :key="'r'+s" size="small" type="danger" effect="plain" class="diff-del-tag" style="margin-right:4px">− {{ s }}</el-tag>
              </div>
            </div>

            <!-- 三、服务亮点 差异 -->
            <div style="flex:1;min-width:240px">
              <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px">③ 服务亮点</div>
              <div style="font-size:13px;margin-bottom:4px;color:#909399">原内容：</div>
              <div v-if="!row.current.highlights.length" style="color:#ccc;font-size:12px;margin-bottom:4px">（空）</div>
              <div v-else style="margin-bottom:6px"><el-tag v-for="h in row.current.highlights" :key="h" size="small" type="info" style="margin-right:4px">{{ h }}</el-tag></div>
              <div style="font-size:13px;color:#909399">变更后（差异高亮）：</div>
              <div>
                <el-tag v-for="h in row.pending.highlights" :key="h" size="small" type="success" style="margin-right:4px" :class="isNew(h, row.current.highlights, row.pending.highlights) ? 'diff-add-tag' : ''">{{ h }}</el-tag>
                <el-tag v-for="h in removedSet(row.current.highlights, row.pending.highlights)" :key="'r'+h" size="small" type="danger" effect="plain" class="diff-del-tag" style="margin-right:4px">− {{ h }}</el-tag>
              </div>
            </div>

            <!-- 四、资质证书 差异 -->
            <div style="flex:1;min-width:240px">
              <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px">④ 资质证书</div>
              <div style="font-size:13px;margin-bottom:4px;color:#909399">原内容：{{ mediaBill(row.current.qualifications) }}</div>
              <div style="font-size:13px;color:#909399">变更后（差异高亮）：</div>
              <div>
                <el-tag v-for="t in row.pending.qualifications?.titles" :key="t" size="small" type="success" style="margin-right:4px" :class="isNew(t, row.current.qualifications?.titles || [], row.pending.qualifications?.titles || []) ? 'diff-add-tag' : ''">{{ t }}</el-tag>
                <el-tag v-for="t in removedSet(row.current.qualifications?.titles || [], row.pending.qualifications?.titles || [])" :key="'r'+t" size="small" type="danger" effect="plain" class="diff-del-tag" style="margin-right:4px">− {{ t }}</el-tag>
                <div style="font-size:12px;color:#c45656" v-if="mediaBill(row.current.qualifications).includes('图片') || (row.pending.qualifications?.photos||[]).length">图片：{{ (row.current.qualifications?.photos||[]).length }} 张 → {{ (row.pending.qualifications?.photos||[]).length }} 张</div>
              </div>
            </div>

            <!-- 五、荣誉 其他 差异 -->
            <div style="flex:1;min-width:240px">
              <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px">⑤ 荣誉 其他</div>
              <div style="font-size:13px;margin-bottom:4px;color:#909399">原内容：{{ mediaBill(row.current.honors) }}</div>
              <div style="font-size:13px;color:#909399">变更后（差异高亮）：</div>
              <div>
                <el-tag v-for="t in row.pending.honors?.titles" :key="t" size="small" type="success" style="margin-right:4px" :class="isNew(t, row.current.honors?.titles || [], row.pending.honors?.titles || []) ? 'diff-add-tag' : ''">{{ t }}</el-tag>
                <el-tag v-for="t in removedSet(row.current.honors?.titles || [], row.pending.honors?.titles || [])" :key="'r'+t" size="small" type="danger" effect="plain" class="diff-del-tag" style="margin-right:4px">− {{ t }}</el-tag>
                <div style="font-size:12px;color:#c45656" v-if="mediaBill(row.current.honors).includes('图片') || (row.pending.honors?.photos||[]).length">图片：{{ (row.current.honors?.photos||[]).length }} 张 → {{ (row.pending.honors?.photos||[]).length }} 张</div>
              </div>
            </div>

            <!-- 六、审核历史 -->
            <div style="flex:1;min-width:240px">
              <div style="font-weight:600;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px">⑥ 审核历史</div>
              <div v-if="!row.audit_history || !row.audit_history.length" style="font-size:12px;color:#999">暂无审核记录</div>
              <div v-for="(h,i) in row.audit_history" :key="i" style="font-size:12px;line-height:1.9;color:#333;border-bottom:1px dashed #eee">
                <el-tag size="small" :type="h.result === 'approved' ? 'success' : 'danger'" style="margin-right:6px">{{ h.result === 'approved' ? '通过' : '驳回' }}</el-tag>
                {{ formatTime(h.at) }} · 操作人 {{ h.by || '-' }}
                <span v-if="h.reason" style="color:#c45656">理由：{{ h.reason }}</span>
              </div>
            </div>
          </div>
        </template>
      </el-table-column>

      <el-table-column prop="nickname" label="昵称" min-width="140" show-overflow-tooltip />
      <el-table-column label="OpenID" width="170">
        <template #default="{ row }"><span style="font-family:monospace;font-size:11px">{{ maskOpenid(row.openid) }}</span></template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ formatTime(row.submitted_at) }}</template>
      </el-table-column>
      <el-table-column label="待审内容" min-width="360">
        <template #default="{ row }">
          <!-- 分类块：各栏目均展示 原内容 vs 变更后 diff(新增绿/删除红) -->
          <div v-if="row.current.bio || row.pending.bio" class="prc-cat">
            <div class="prc-cat-head">
              <div class="prc-cat-name">简介</div>
              <div class="prc-actions" v-if="hasPending(row,'bio')">
                <el-button size="mini" type="success" link :loading="busyField===row.openid+'|bio'" @click="doFieldApprove(row,'bio')">通过</el-button>
                <el-button size="mini" type="danger" link @click="openFieldReject(row,'bio')">驳回</el-button>
              </div>
            </div>
            <div class="prc-line"><span class="prc-old-tag">原</span><span v-for="(s,i) in bioOldSpans(row.current.bio, row.pending.bio)" :key="'o'+i" :class="s.t === 2 ? 'diff-del-tag' : ''">{{ s.v }}</span></div>
            <div class="prc-line"><span class="prc-new-tag">新</span><span v-for="(s,i) in bioNewSpans(row.current.bio, row.pending.bio)" :key="'n'+i" :class="s.t === 1 ? 'diff-add-tag' : ''">{{ s.v }}</span></div>
          </div>
          <div v-if="(row.current.skills || []).length || (row.pending.skills || []).length" class="prc-cat">
            <div class="prc-cat-head">
              <div class="prc-cat-name">技能</div>
              <div class="prc-actions" v-if="hasPending(row,'skills')">
                <el-button size="mini" type="success" link :loading="busyField===row.openid+'|skills'" @click="doFieldApprove(row,'skills')">通过</el-button>
                <el-button size="mini" type="danger" link @click="openFieldReject(row,'skills')">驳回</el-button>
              </div>
            </div>
            <div class="prc-line">
              <span class="prc-old-tag">原</span>
              <el-tag v-for="s in row.current.skills" :key="s" size="small" effect="plain" class="prc-tag" :class="removedSet(row.current.skills, row.pending.skills).includes(s) ? 'diff-del-tag' : ''">{{ s }}</el-tag>
            </div>
            <div class="prc-line">
              <span class="prc-new-tag">新</span>
              <el-tag v-for="s in row.pending.skills" :key="s" size="small" type="info" class="prc-tag" :class="isNew(s, row.current.skills, row.pending.skills) ? 'diff-add-tag' : ''">{{ s }}</el-tag>
            </div>
          </div>
          <div v-if="(row.current.highlights || []).length || (row.pending.highlights || []).length" class="prc-cat">
            <div class="prc-cat-head">
              <div class="prc-cat-name">亮点</div>
              <div class="prc-actions" v-if="hasPending(row,'highlights')">
                <el-button size="mini" type="success" link :loading="busyField===row.openid+'|highlights'" @click="doFieldApprove(row,'highlights')">通过</el-button>
                <el-button size="mini" type="danger" link @click="openFieldReject(row,'highlights')">驳回</el-button>
              </div>
            </div>
            <div class="prc-line">
              <span class="prc-old-tag">原</span>
              <el-tag v-for="h in row.current.highlights" :key="h" size="small" effect="plain" class="prc-tag" :class="removedSet(row.current.highlights, row.pending.highlights).includes(h) ? 'diff-del-tag' : ''">{{ h }}</el-tag>
            </div>
            <div class="prc-line">
              <span class="prc-new-tag">新</span>
              <el-tag v-for="h in row.pending.highlights" :key="h" size="small" type="info" class="prc-tag" :class="isNew(h, row.current.highlights, row.pending.highlights) ? 'diff-add-tag' : ''">{{ h }}</el-tag>
            </div>
          </div>
          <div v-if="mediaBill(row.current.qualifications) !== '（空）' || (row.pending.qualifications?.titles || []).length || (row.pending.qualifications?.photos || []).length" class="prc-cat">
            <div class="prc-cat-head">
              <div class="prc-cat-name">资质证书</div>
              <div class="prc-actions" v-if="hasPending(row,'qualifications')">
                <el-button size="mini" type="success" link :loading="busyField===row.openid+'|qualifications'" @click="doFieldApprove(row,'qualifications')">通过</el-button>
                <el-button size="mini" type="danger" link @click="openFieldReject(row,'qualifications')">驳回</el-button>
              </div>
            </div>
            <div class="prc-line"><span class="prc-old-tag">原</span><span>{{ mediaBill(row.current.qualifications) }}</span></div>
            <div class="prc-line">
              <span class="prc-new-tag">新</span>
              <el-tag v-for="t in row.pending.qualifications?.titles" :key="t" size="small" type="info" class="prc-tag" :class="isNew(t, row.current.qualifications?.titles || [], row.pending.qualifications?.titles || []) ? 'diff-add-tag' : ''">{{ t }}</el-tag>
              <el-tag v-for="t in removedSet(row.current.qualifications?.titles || [], row.pending.qualifications?.titles || [])" :key="'r'+t" size="small" type="danger" effect="plain" class="prc-tag diff-del-tag">− {{ t }}</el-tag>
              <span v-if="(row.current.qualifications?.photos || []).length || (row.pending.qualifications?.photos || []).length" class="prc-photo" :class="(row.current.qualifications?.photos || []).length !== (row.pending.qualifications?.photos || []).length ? 'diff-add-tag' : ''">图片 {{ (row.pending.qualifications?.photos || []).length }} 张</span>
            </div>
            <!-- 资质证书缩略图(点击看原图) -->
            <div v-if="thumbPhotos(row.current.qualifications).length || thumbPhotos(row.pending.qualifications).length" class="prc-thumbs">
              <el-image v-for="(ph,i) in [...thumbPhotos(row.current.qualifications), ...thumbPhotos(row.pending.qualifications)]" :key="'q'+i"
                class="prc-thumb" :src="ph.url" :preview-src-list="allThumbUrls(row.current.qualifications, row.pending.qualifications)"
                :initial-index="i" fit="cover" lazy />
            </div>
          </div>
          <div v-if="mediaBill(row.current.honors) !== '（空）' || (row.pending.honors?.titles || []).length || (row.pending.honors?.photos || []).length" class="prc-cat">
            <div class="prc-cat-head">
              <div class="prc-cat-name">荣誉 其他</div>
              <div class="prc-actions" v-if="hasPending(row,'honors')">
                <el-button size="mini" type="success" link :loading="busyField===row.openid+'|honors'" @click="doFieldApprove(row,'honors')">通过</el-button>
                <el-button size="mini" type="danger" link @click="openFieldReject(row,'honors')">驳回</el-button>
              </div>
            </div>
            <div class="prc-line"><span class="prc-old-tag">原</span><span>{{ mediaBill(row.current.honors) }}</span></div>
            <div class="prc-line">
              <span class="prc-new-tag">新</span>
              <el-tag v-for="t in row.pending.honors?.titles" :key="t" size="small" type="info" class="prc-tag" :class="isNew(t, row.current.honors?.titles || [], row.pending.honors?.titles || []) ? 'diff-add-tag' : ''">{{ t }}</el-tag>
              <el-tag v-for="t in removedSet(row.current.honors?.titles || [], row.pending.honors?.titles || [])" :key="'r'+t" size="small" type="danger" effect="plain" class="prc-tag diff-del-tag">− {{ t }}</el-tag>
              <span v-if="(row.current.honors?.photos || []).length || (row.pending.honors?.photos || []).length" class="prc-photo" :class="(row.current.honors?.photos || []).length !== (row.pending.honors?.photos || []).length ? 'diff-add-tag' : ''">图片 {{ (row.pending.honors?.photos || []).length }} 张</span>
            </div>
            <!-- 荣誉 其他 缩略图(点击看原图) -->
            <div v-if="thumbPhotos(row.current.honors).length || thumbPhotos(row.pending.honors).length" class="prc-thumbs">
              <el-image v-for="(ph,i) in [...thumbPhotos(row.current.honors), ...thumbPhotos(row.pending.honors)]" :key="'h'+i"
                class="prc-thumb" :src="ph.url" :preview-src-list="allThumbUrls(row.current.honors, row.pending.honors)"
                :initial-index="i" fit="cover" lazy />
            </div>
          </div>
          <div v-if="!row.current.bio && !row.pending.bio && !(row.current.skills || []).length && !(row.pending.skills || []).length && !(row.current.highlights || []).length && !(row.pending.highlights || []).length && mediaBill(row.current.qualifications) === '（空）' && !(row.pending.qualifications?.titles || []).length && !(row.pending.qualifications?.photos || []).length && mediaBill(row.current.honors) === '（空）' && !(row.pending.honors?.titles || []).length && !(row.pending.honors?.photos || []).length" style="color:#999">（空）</div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <div style="font-size:12px;color:#909399">待审 {{ pendingCount(row) }} 项</div>
          <el-button size="mini" type="primary" plain style="margin-top:2px" :loading="busyField===row.openid+'|all'" @click="doAllApprove(row)">全部通过</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top:12px;justify-content:flex-end;display:flex"
      v-model:current-page="page" v-model:page-size="size" :total="total"
      :page-sizes="[15, 30]" layout="total, sizes, prev, pager, next"
      @size-change="load" @current-change="load"
    />

    <el-dialog v-model="rejectDialog" title="驳回耍伴资料" width="480px">
      <el-form label-position="top">
        <el-form-item label="被驳回耍伴"><span>{{ rejectTarget?.nickname || rejectTarget?.openid }}</span><el-tag size="small" type="warning" style="margin-left:8px">{{ fieldName(rejectField) }}</el-tag></el-form-item>
        <el-form-item label="常用原因">
          <el-select v-model="rejectPreset" placeholder="选择快捷原因" clearable style="width:100%" @change="onPresetChange">
            <el-option label="含联系方式/链接（引流）" value="资料含联系方式/链接，请移除后重提" />
            <el-option label="内容不实/疑似虚假" value="资料内容不实，请核实后重提" />
            <el-option label="含敏感词/违规内容" value="资料含违规内容，请修改后重提" />
            <el-option label="表述不完整/过于简短" value="资料表述不完整，请补充完善后重提" />
          </el-select>
        </el-form-item>
        <el-form-item label="驳回原因（必填）" required>
          <el-input v-model="rejectNote" type="textarea" :rows="3" placeholder="请填写驳回原因，将反馈给耍伴" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="doFieldReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';
import { formatTime } from '../utils/format.js';

const list = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(15);
const loading = ref(false);
const busy = ref('');     // 兼容占位(未使用)
const busyField = ref('');
const rejectDialog = ref(false);
const rejectNote = ref('');
const rejectPreset = ref('');
const rejectTarget = ref(null);
const rejectField = ref('');
const submitting = ref(false);

function onPresetChange(v) { if (v) rejectNote.value = v; }

function maskOpenid(openid) {
  if (!openid) return '-';
  if (openid.length <= 10) return openid;
  return openid.slice(0, 4) + '****' + openid.slice(-6);
}

// ── 差异计算 ──
// 字符级 LCS diff，返回 [{t:0相同/1新增/2删除, v}]
function charDiff(a, b) {
  const A = a ? String(a) : '';
  const B = b ? String(b) : '';
  const arrA = [...A], arrB = [...B];
  const n = arrA.length, m = arrB.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = arrA[i] === arrB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const res = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && arrA[i] === arrB[j]) { res.push({ t: 0, v: arrA[i] }); i++; j++; }
    else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) { res.push({ t: 1, v: arrB[j] }); j++; }
    else { res.push({ t: 2, v: arrA[i] }); i++; }
  }
  return res;
}
// 数组差异：项在 new 且不在 old → 新增(success)；仅在 old → 通过 removedSet 显示为删除划线
function isNew(x, oldArr, newArr) {
  return (newArr || []).indexOf(x) >= 0 && (oldArr || []).indexOf(x) < 0;
}
function removedSet(oldArr, newArr) {
  const n = new Set(newArr || []);
  return (oldArr || []).filter((x) => !n.has(x));
}
// 简介字符级 diff: 原行=相同+删除(删除划线红), 新行=相同+新增(新增绿)
function bioOldSpans(a, b) { return charDiff(a, b).filter((s) => s.t !== 1); }
function bioNewSpans(a, b) { return charDiff(a, b).filter((s) => s.t !== 2); }
// 栏目级图文(资质/荣誉) 原内容摘要
function mediaBill(m) {
  const o = m || {};
  const titles = (o.titles || []).join('、') || '（空）';
  const photos = (o.photos || []).length;
  return photos > 0 ? `${titles}；图片 ${photos} 张` : titles;
}
// 有 url 的缩略图(过滤待审/快照里未取到 url 的)
function thumbPhotos(m) {
  const o = m || {};
  return (o.photos || []).filter((p) => p && p.url);
}
// 全部缩略图 url(当前+待审, 用于大图预览列表)
function allThumbUrls(cur, pend) {
  return [...thumbPhotos(cur), ...thumbPhotos(pend)].map((p) => p.url);
}

async function load() {
  loading.value = true;
  const r = await call('partner_profile_pending_list', { page: page.value, size: size.value });
  loading.value = false;
  if (r.ok) {
    list.value = r.data?.list || [];
    total.value = r.data?.total || 0;
  } else {
    ElMessage.error(r.msg || '加载待审列表失败');
  }
}

async function doFieldApprove(row, field) {
  const key = row.openid + '|' + field;
  busyField.value = key;
  const r = await call('partner_profile_review', { target_openid: row.openid, items: [{ field, pass: true, reason: '' }] });
  busyField.value = '';
  if (r.ok) { ElMessage.success('已通过'); await load(); }
  else ElMessage.error(r.msg || '操作失败');
}

function openFieldReject(row, field) {
  rejectTarget.value = row;
  rejectField.value = field;
  rejectNote.value = '';
  rejectDialog.value = true;
}

async function doFieldReject() {
  if (!rejectNote.value.trim()) { ElMessage.warning('请填写驳回原因'); return; }
  submitting.value = true;
  const target = rejectTarget.value;
  const field = rejectField.value;
  const r = await call('partner_profile_review', { target_openid: target.openid, items: [{ field, pass: false, reason: rejectNote.value.trim() }] });
  submitting.value = false;
  if (r.ok) { ElMessage.success('已驳回'); rejectDialog.value = false; await load(); }
  else ElMessage.error(r.msg || '操作失败');
}

async function doAllApprove(row) {
  try {
    await ElMessageBox.confirm(
      `确认全部通过耍伴「${row.nickname || row.openid}」的所有待审内容？`,
      '操作确认',
      { confirmButtonText: '确认全部通过', cancelButtonText: '取消', type: 'success' }
    );
  } catch (_) { return; }
  busyField.value = row.openid + '|all';
  const items = Object.keys(FIELD_META).filter((f) => hasPending(row, f)).map((f) => ({ field: f, pass: true, reason: '' }));
  const r = await call('partner_profile_review', { target_openid: row.openid, items });
  busyField.value = '';
  if (r.ok) { ElMessage.success('已全部通过'); await load(); }
  else ElMessage.error(r.msg || '操作失败');
}

// 栏目元数据
const FIELD_META = {
  bio: '个人简介', skills: '技能标签', highlights: '服务亮点',
  qualifications: '资质证书', honors: '荣誉 其他'
};
function fieldName(k) { return FIELD_META[k] || k; }
function hasPending(row, field) {
  if (!row || !row.pending) return false;
  const v = row.pending[field];
  if (typeof v === 'string') return !!v;
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return !!(v.titles && v.titles.length) || !!(v.photos && v.photos.length);
  return false;
}
function pendingCount(row) {
  return Object.keys(FIELD_META).filter((f) => hasPending(row, f)).length;
}
onMounted(load);
</script>

<style scoped>
.diff-add { background: #f0f9eb; color: #67c23a; border-radius: 2px; }
.diff-del { background: #fef0f0; color: #f56c6c; text-decoration: line-through; border-radius: 2px; }
.diff-add-tag { border: 1px dashed #67c23a; }
.diff-del-tag { text-decoration: line-through; opacity: 0.9; }
/* 待审内容列 · 分类块(原 vs 新) */
.prc-cat { margin: 2px 0 4px; }
.prc-cat-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #e4e7ed; margin-bottom: 2px; }
.prc-cat-head .prc-cat-name { border-bottom: none; margin-bottom: 0; }
.prc-actions { flex-shrink: 0; display: flex; align-items: center; }
.prc-cat-name { font-size: 12px; color: #606266; font-weight: 600; border-bottom: 1px dashed #e4e7ed; margin-bottom: 2px; padding-bottom: 1px; }
.prc-line { font-size: 12px; line-height: 22px; display: flex; flex-wrap: wrap; align-items: center; }
.prc-old-tag, .prc-new-tag { flex-shrink: 0; display: inline-block; width: 22px; text-align: center; border-radius: 3px; font-size: 11px; margin-right: 6px; }
.prc-old-tag { background: #f4f4f5; color: #909399; }
.prc-new-tag { background: #f0f9eb; color: #67c23a; }
.prc-tag { margin-right: 4px; }
.prc-photo { font-size: 12px; color: #c45656; padding: 0 4px; }
/* 资质/荣誉 缩略图 */
.prc-thumbs { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
.prc-thumb { width: 64px; height: 64px; border-radius: 6px; border: 1px solid #ebeef5; cursor: zoom-in; }
</style>