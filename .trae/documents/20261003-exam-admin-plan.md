# 后台认证考试管理系统 实施计划

## Context

当前耍伴接单考试体系（基础科目 base 全员前置、提升科目 W1 陪诊专项、通过线满分 100）的**题库和通过规则硬编码在云函数**（`partner-action` EXAM_BANK/EXAM_THRESHOLD），后台无法调整。需求：在管理后台新增「认证考试管理系统」，支持**增减考试项目、定义考试通过规则（通过线+前置科目）、管理题目题库（单选含答案）**。

目标：考试体系全配置化，云端 `exam_bank` 集合为唯一数据源，硬编码题库降级为读库失败时的兜底（fail-closed，与 getPartnerLimits 同范式）。

## 数据模型

独立集合 `exam_bank`，每科目一个 doc（不加入 export_collection 白名单，避免答案 answer_idx 随备份导出泄露）：

```
{ _id: code, code, title, desc, pass_line: 0-100, requires: [前置科目code],
  enabled: true, questions: [{ question, options[2-6], answer_idx }],
  is_deleted: false, created_at, updated_at, updated_by }
```

- 科目 code 与接单场景 code 可重合（W1 既是场景也是专项科目）；base 为通用前置科目
- **题目上限 60 题/科目**（100 题≈90KB 逼近网关 100KB body 限制）

## 云函数改动

### 1. cloudfunctions/admin-action/index.js（新增 6 个 action）
- ROLE_GRANTS 加：`'exam_*': ['R3']`、`'exam_bank_seed': ['R1','R3']`
- `exam_subject_list`：列表（code/title/desc/pass_line/requires/enabled/question_count/updated_at），**不含答案**
- `exam_subject_detail{code}`：全量含 questions
- `exam_subject_create/update{code,title,desc,pass_line,requires,enabled,questions}`：校验 code 3-20 位、pass_line 0-100 整数、questions 1-60 条、每条 question≤500 字/options 2-6 个各≤50 字/answer_idx 在界、requires 引用已存在且 enabled 的科目；**被其它科目 requires 引用的科目禁止删除**（防悬挂）
- `exam_subject_delete{code}`：软删 is_deleted:true
- `exam_bank_seed`：用 FALLBACK 题库（与 partner-action 同源）初始化缺失科目，**幂等、绝不覆盖手建**（已存在则跳过）
- 全部走 ok()/fail() + logEvent 留痕（仿 home_activity CRUD，L2340-2425）

### 2. cloudfunctions/partner-action/index.js（题库/规则动态化）
- 新增 `getExamBank()`：FALLBACK=现有硬编码 EXAM_BANK，5 分钟缓存，读 exam_bank（is_deleted≠true）——镜像 getPartnerLimits（L127-155）范式；**读失败不缓存空值**（照现行为）
- `get_exam_questions`：题库/pass_line/requires 全动态；前置门禁**通用化**（遍历 subject.requires 逐科查 exam_scores，替代 W1 特判）；返回 `bank_ver: updated_at`
- `submit_exam`：同样动态判分 + requires 门禁；入参带 `bank_ver`，与云端不符返回 `pa_exam_bank_changed`（防考试中途改题判分错位）
- 新增 `exam_subjects`：返回启用科目配置 `{list:[{code,title,desc,pass_line,requires}]}`（不含答案），供前端 exam-status/accept-config/profile 使用

### 3. cloudfunctions/order-create/index.js（接单校验动态化）
- base 通用前置保留硬编码 FALLBACK；专项校验改为「code===demand.scene 且科目存在则按该科目 requires+pass_line 校验」（W1 特判泛化，scene code 与 subject code 本就同源）
- **修 L378 文案 bug「>=80分」→动态 pass_line**

## 前端（小程序）改动

### 4. miniprogram/pages-v2/pkg-low/exam/exam.js
- `onLoad` 放开 subject 白名单（当前只认 base|W1，新增科目打不开考试页）
- 补 `pa_exam_base_not_passed` 专属 UI：toast + 「去考基础科目」引导按钮（当前仅 loadError 无引导）

### 5. miniprogram/pages-v2/pkg-low/exam-status/exam-status.js
- SUBJECTS 静态定义 → 改为 my_profile + `exam_subjects` 动态拉取
- locked 逻辑按 requires 泛化（当前硬编码 base 前置）

### 6. miniprogram/pages-v2/pkg-low/accept-config/accept-config.js + profile/profile.js
- passLine / examPassed / fetchExamBadge 硬编码 100 → 改从 `exam_subjects` 动态取值计算

## admin-web 前端改动

### 7. admin-web-frontend/src/views/Exam.vue（新建）
- 照抄 Operations.vue 骨架（Tab + el-table + el-dialog）+ Legal.vue 动态行范式（L58-76）
- 科目列表 el-table：code/title/pass_line/requires/题目数/启用状态/操作（编辑/删除）
- 编辑弹窗：基础信息（title/desc/pass_line/enabled）+ requires 多选（其他科目）+ 题目动态行（question input、options 4 个、answer radio、删除行）+ 新增题目按钮
- 「一键初始化题库」按钮 → 调 `exam_bank_seed`
- 调 `src/api/admin.js` 的 `call('exam_xxx', data)`（自动注入 X-Admin-Key）

### 8. 路由与菜单
- src/router/index.js 加 `{ path: 'exam', component: () => import('../views/Exam.vue'), meta: { title: '认证考试管理' } }`
- src/views/Layout.vue「运营配置」组（ops-group）加 `<el-menu-item index="/exam">认证考试</el-menu-item>`

## 部署顺序

1. admin-action → 2. partner-action → 3. order-create → 4. admin-web（npm run build → dist 清空重拷 cloudfunctions/admin-web/public → 部署）
- CLI 部署命令（一次一个函数）：`& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names <fn> --project c:\zhaoren --remote-npm-install`
- admin-web 构建前需 `$env:Path = 'C:\Program Files\nodejs;' + $env:Path` 前置 node 路径

## 验证

- **网关实测**（X-Admin-Key 鉴权，重试 4 次应对 502/504）：
  - `exam_bank_seed` 连跑两遍幂等；`exam_subject_list` 见 base/W1；`exam_subject_detail` 含答案
  - 改 pass_line → `exam_subjects` 生效（≤5min 缓存或重拉）
  - `get_exam_questions` 未过前置返回 `pa_exam_base_not_passed`；`submit_exam` 判分正确
- **前端**：admin-web `npm run build` 编译通过；小程序 4 个改动 JS 语法检查（node -e new Function）
- **真机**：exam-status → 考试 → 接单全链路；后台 Exam.vue 增改题目后 ≤5min 生效

## 关键文件

- c:\zhaoren\cloudfunctions\admin-action\index.js
- c:\zhaoren\cloudfunctions\partner-action\index.js
- c:\zhaoren\cloudfunctions\order-create\index.js
- c:\zhaoren\admin-web-frontend\src\views\Exam.vue（新建，参照 Operations.vue/Legal.vue）
- c:\zhaoren\miniprogram\pages-v2\pkg-low\exam\exam.js
- c:\zhaoren\miniprogram\pages-v2\pkg-low\exam-status\exam-status.js
- c:\zhaoren\miniprogram\pages-v2\pkg-low\accept-config\accept-config.js
- c:\zhaoren\miniprogram\pages-v2\profile\profile.js
