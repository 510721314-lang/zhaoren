---
name: admin-web-write-ui-pattern
description: admin-web 后台写操作 UI 标准模式（二次确认 + 原因填写 + 防双击 + 刷新列表）。Use when 在 admin-web-frontend 新增下架/通过/删除/冻结/审批等写操作按钮，或需要统一后台写操作交互与防误触。Do not use for 小程序端 UI 美化或云函数业务逻辑实现。
---

# admin-web 写操作 UI 模式（Vue3 + Element Plus）

## 触发场景

- 在 admin-web-frontend 新增任何"写操作"按钮（下架/通过/删除/冻结/审批等）
- 需要二次确认 + 原因填写 + 防双击 + 刷新列表

## 核心模式（已在 12 个写操作验证）

### 三要素

1. **`busy` 字符串 ref**：当前正在操作的行 id（不是 boolean），支持多按钮区分
2. **二次确认**：
   - 无需原因 → `ElMessageBox.confirm`
   - 需要原因 → `el-dialog` + `el-input textarea` + 必填校验
3. **反馈闭环**：成功 `ElMessage.success` + `load()` 刷新；失败 `ElMessage.error(r.msg || r.code)`

---

## 模式 A：无需原因（简单状态切换）

**适用**：partner_online、blog_restore、approve 等

```vue
<template>
  <el-button
    size="small"
    type="success"
    :loading="busy === row._id"
    @click="doAction(row)"
  >恢复</el-button>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';

const busy = ref('');

async function doAction(row) {
  // 1. 二次确认
  try {
    await ElMessageBox.confirm(
      `确认恢复「${row.title}」?`,
      '操作确认',
      { confirmButtonText: '确认', cancelButtonText: '取消', type: 'success' }
    );
  } catch (_) { return; }  // 用户取消

  // 2. 防双击 + 调用
  busy.value = row._id;
  const r = await call('blog_restore', { post_id: row._id });
  busy.value = '';

  // 3. 反馈
  if (r.ok) {
    ElMessage.success(r.data?.msg || '已恢复');
    await load();  // 刷新列表
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}
</script>
```

---

## 模式 B：需要原因（弹窗填 note）

**适用**：blog_offline/delete、order_force_cancel、report_handle、user_freeze/ban 等

```vue
<template>
  <el-button
    size="small"
    type="warning"
    :loading="busy === row._id"
    @click="openDialog(row)"
  >下架</el-button>

  <!-- 原因弹窗 -->
  <el-dialog v-model="dialog" title="下架" width="480px">
    <el-form label-position="top">
      <el-form-item label="目标">
        <span>{{ target?.title }}</span>
      </el-form-item>
      <el-form-item label="原因（必填，将记录到审计日志）" required>
        <el-input
          v-model="note"
          type="textarea"
          :rows="3"
          placeholder="请填写原因"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialog = false">取消</el-button>
      <el-button
        type="warning"
        :loading="submitting"
        @click="doSubmit"
      >确认</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { call } from '../api/admin.js';

const busy = ref('');
const dialog = ref(false);
const target = ref(null);
const note = ref('');
const submitting = ref(false);

function openDialog(row) {
  target.value = row;
  note.value = '';
  dialog.value = true;
}

async function doSubmit() {
  // 1. 必填校验
  if (!note.value.trim()) {
    ElMessage.warning('请填写原因');
    return;
  }
  // 2. 提交
  submitting.value = true;
  const r = await call('blog_offline', {
    post_id: target.value._id,
    note: note.value.trim()
  });
  submitting.value = false;
  // 3. 反馈
  if (r.ok) {
    ElMessage.success(r.data?.msg || '已下架');
    dialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '操作失败');
  }
}
</script>
```

---

## 模式 C：多决策（radio 选择 + 备注）

**适用**：dispute_handle（open/refund/complete）等

```vue
<el-dialog v-model="dialog" title="处理纠纷" width="520px">
  <el-form label-position="top">
    <el-form-item label="处理决策" required>
      <el-radio-group v-model="decision">
        <el-radio value="open">开案（继续调查）</el-radio>
        <el-radio value="refund">判退款</el-radio>
        <el-radio value="complete">判完成</el-radio>
      </el-radio-group>
    </el-form-item>
    <el-form-item label="处理说明（必填）" required>
      <el-input v-model="note" type="textarea" :rows="3" />
    </el-form-item>
  </el-form>
</el-dialog>
```

**注意**：Element Plus 2.14+ 用 `value` 属性（不是 `label`）。

---

## 模式 D：配置型选项列表（增 / 删 / 改，2026-11-11 双专家评审立项）

**适用**：后台可配置的枚举列表（理由文案、场景清单、档位选项等），运营要能自助增删选项 + 改显示文案。

### 铁律 1：行必须按「云端已存 ∪ 全集」生成，禁止只按默认常量生成

**反例（踩过的真实缺陷）**：
```javascript
// ❌ 用 DEFAULTS 直接 map —— 云端已存但不在 DEFAULTS 里的 key 被静默丢弃，
//    运营一点保存就把它从配置里删掉（用户端选项凭空消失，且无任何报错）
g.rows = DEFAULTS[kind].map((d) => ({ k: d.k, t: savedMap[d.k] || d.t }));
```
**正例**：
```javascript
// ✅ 云端已存数组为准（保留顺序与子集）；未配置时才回落到默认列表
function fillRows(kind, saved) {
  const savedList = Array.isArray(saved) ? saved.filter((x) => x && x.k) : [];
  const src = savedList.length ? savedList : DEFAULTS[kind];
  const defIt = (k) => ALL[kind].find((d) => d.k === k) || {};
  g.rows = src.map((it) => reactive({ k: it.k, def: defIt(it.k).t || it.t, t: it.t || defIt(it.k).t || '' }));
}
```
> 判据：**保存 → 刷新页面 → 行仍在 → 再保存 → 仍不丢**。缺这一步验收就会漏。

### 铁律 2：删除按钮与「服务端非空约束」对齐

服务端一般拒收空数组（`config_bad_xxx`）。UI 必须同步硬拦截，否则运营拿到的是云函数原始错误码：
```vue
<el-button size="small" type="danger" plain
  :disabled="g.rows.length <= 1" @click="g.rows.splice($index, 1)">删除</el-button>
```

### 铁律 3：key 只读、文案可改、新增只能从白名单里挑

- key 列 `prop="k"` 只读展示，不给编辑控件（改 key 等于改数据口径，历史数据会对不上）；
- 「＋添加」用 `el-select` 列出**全集减去已启用**的项，杜绝自造 key；
- 文案为空时**回退默认值**再提交（服务端通常有 2-10 字下限）。

### 铁律 4：提示「冷启动生效」

配置经 `config_public` + 客户端本地缓存下发，缓存 TTL 常见 7 天。保存成功后必须提示「下次冷启动生效（缓存≤7 天）」，否则用户会反复报「后台改了手机没变」。

### 铁律 5：默认列表不含新增项

新增可选项默认**不**出现在默认兜底列表里（`DEFAULTS = ALL.filter(x => x.k !== 新增key)`），未做配置的存量环境行为完全不变，由运营显式添加才生效。

### 铁律 6：白名单必须「下发侧 + 写入侧」双侧同步

同一配置在云函数里通常有两份白名单：`action_config_public.js`（下发时过滤）与 `action_config_set.js`（写入时校验）。**只改一侧的后果**：
- 只改写入侧 → 后台能存，但下发被过滤，用户端永远看不到（现象最像"没生效"，极易误判为缓存）；
- 只改下发侧 → 下发放行，但保存被 `config_bad_*_key` 拒绝（运营报"选了保存不了"）。

→ 落地要求：新增/收紧一个 key 时，`grep -n "<key>"` 确认两处都命中；部署后做**写入 → `config_get` 回读 → `config_public` 回读**三段实测（只看其中一段都会漏）。

---

## 表格行按钮的状态显隐

按 `row.status` 动态显示，不要全显示：

```vue
<el-button
  v-if="row.status !== 'offline' && row.status !== 'deleted'"
  type="warning"
  @click="openDialog(row, 'offline')"
>下架</el-button>

<el-button
  v-if="row.status === 'offline'"
  type="success"
  @click="doRestore(row)"
>恢复</el-button>

<el-button
  v-if="row.status !== 'deleted'"
  type="danger"
  @click="openDialog(row, 'delete')"
>删除</el-button>
```

---

## 抽屉里的写操作（与表格按钮同步）

详情抽屉里的按钮也要加 `:loading`，避免用户在抽屉里点了没反馈：

```vue
<el-drawer v-model="showDetail">
  <el-button
    :loading="busy === detail.user.openid"
    @click="doFreeze(detail.user)"
  >冻结</el-button>
</el-drawer>
```

---

## 防冒泡（表格行可点击时）

如果表格行 `@row-click` 打开详情，按钮要加 `.stop`：

```vue
<el-table @row-click="onRow">
  <el-table-column label="操作">
    <template #default="{row}">
      <el-button @click.stop="doAction(row)">处理</el-button>
    </template>
  </el-table-column>
</el-table>
```

---

## 错误码透传

admin-action 返回 `{ok:false, code:'xxx', msg:'yyy'}`，前端直接显示：

```javascript
if (!r.ok) {
  ElMessage.error(r.msg || r.code || '操作失败');
}
```

**常见错误码**：
- `config_no_change`：没有需要修改的字段（字段名拼错或不在白名单）
- `*_bad_*`：入参校验失败
- CAS 冲突：`stats.updated === 0`，提示"数据已被他人修改，请刷新"
- 状态前置：如 `blog_offline` 校验 `status !== 'offline'`

---

## 写操作完成后刷新

| 场景 | 刷新什么 |
|------|----------|
| 表格行操作 | `await load()` 重新拉列表 |
| 抽屉内操作 | `await load()` + `await refreshDetail()` 更新抽屉数据 |
| 配置保存 | `await load()` 重新拉 config_get |

---

## 实测清单（12 个写操作，commit 9198508 + fb53cf2）

| 页面 | 写操作 | 模式 |
|------|--------|------|
| Partners | partner_offline / partner_online | B / A |
| Demand | demand_offline | B |
| Orders | order_force_cancel | B |
| Dispute | dispute_handle | C |
| Report | report_handle | B |
| Users | user_freeze/unfreeze/ban/unban | B / A |
| Users | user_credit_adjust | B（带数字校验） |
| Users | penalty | C（level 下拉） |

## 关键约定

1. `busy` 用字符串存行 id，不用 boolean（支持多按钮区分）
2. 弹窗原因字段名：admin-action 大部分要求 `note` 或 `reason`，调用前 Grep 确认
3. 所有写操作 admin-action 都 `logEvent('P2', action, openid, payload)` 审计，前端无需关心
4. 按钮 `size="small"` 是项目约定（表格密集场景）
5. 弹窗宽度：简单 400-480px，复杂表单 520-560px
