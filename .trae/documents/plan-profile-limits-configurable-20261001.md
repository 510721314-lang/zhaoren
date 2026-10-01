# 耍伴资料数量限制后台可配置化

## Context（背景）

用户（PRD 负责人）在真机回归时发现：技能标签、服务亮点、资质/荣誉存在硬编码数量/字数限制（技能 10 条×12 字、亮点 3 条×30 字、资质/荣誉标题 20 条×20 字等），触发「最多 3 条服务亮点」等提示。诉求：**取消标签数量限制，改为通过后台管理系统动态配置**——前端校验、后端强约束、后台表单三方统一由 `admin_config` 驱动，不再散落硬编码。

**范围**：技能标签条数&字数、服务亮点条数&字数、资质/荣誉标题条数&字数（共 6 个 int 字段）。图片张数（6）与单张 3M 限制、bio 200 字**不动**（用户只提数量限制）。

**默认值保持现状**（10/12/3/30/20/20），后台可调大/调小。

## 改动点

### 1. 后台 `cloudfunctions/admin-action/index.js`
- **CONFIG_SCHEMA**（L83-129 数组末尾）新增 6 个 int 字段，`g:'耍伴资料'`：

| f | label | min | max | def |
|---|---|---|---|---|
| p_skills_max | 技能标签条数上限 | 1 | 50 | 10 |
| p_skills_len | 技能标签单条字数 | 1 | 50 | 12 |
| p_highlights_max | 服务亮点条数上限 | 1 | 20 | 3 |
| p_highlight_len | 服务亮点单条字数 | 1 | 100 | 30 |
| p_media_title_max | 资质/荣誉标题条数上限 | 1 | 50 | 20 |
| p_media_len | 资质/荣誉单条标题字数 | 1 | 50 | 20 |

  进 schema 后 `config_set` int 区间校验（L1759-1769）与 `config_get`/`resolveOperations` 自动生效，后台 Operations.vue 动态渲染零改动。
- **config_public**（L351-409）新增 `partner_profile` 子对象，缺省给 schema def，**用 `!== undefined ? : def` 写法**（防 0 值被 `||` 吞掉）：
```js
partner_profile: {
  skills_max: cfgRaw.p_skills_max !== undefined ? cfgRaw.p_skills_max : 10,
  skills_len: cfgRaw.p_skills_len !== undefined ? cfgRaw.p_skills_len : 12,
  highlights_max: cfgRaw.p_highlights_max !== undefined ? cfgRaw.p_highlights_max : 3,
  highlight_len: cfgRaw.p_highlight_len !== undefined ? cfgRaw.p_highlight_len : 30,
  media_title_max: cfgRaw.p_media_title_max !== undefined ? cfgRaw.p_media_title_max : 20,
  media_len: cfgRaw.p_media_len !== undefined ? cfgRaw.p_media_len : 20
}
```

### 2. 后端 `cloudfunctions/partner-action/index.js`
- 新增 `getPartnerLimits()`：读 `admin_config.global`，5 分钟 TTL 缓存（仿现成 `getTencentMapKey` L81-92），读失败返回默认值（fail-closed 不放大）。
- `update_partner_profile`（L606-636）改用其返回值替换硬编码：
  - L624-626 skills：`slice(0, L.skills_max)` + `slice(0, L.skills_len)`
  - L627-629 highlights：`slice(0, L.highlights_max)` + `slice(0, L.highlight_len)`
  - L632 titles：`slice(0, L.media_title_max)` + `slice(0, L.media_len)`；photos 保持 `slice(0,6)`

### 3. 前端 `miniprogram/pages-v2/partner-profile-edit/partner-profile-edit.js` + `.wxml`
- data 新增 `limits: { skillsMax:10, skillsLen:12, highlightsMax:3, highlightLen:30, mediaTitleMax:20, mediaLen:20 }`（初值 = 原常量，config_public 失败不漂移）。
- onLoad（L44-77）在 my_profile 之外**并行**再调一次 `callCloud('admin-action',{action:'config_public'})`，取 `data.partner_profile` 覆盖 limits（仿 realname.js `_loadLegal` L80-92 模式）。
- JS 校验改读 limits：L100 `>= this.data.limits.skillsMax`；L113 `>= this.data.limits.highlightsMax`（toast 文案用动态值）；L130/145 `>= this.data.limits.mediaTitleMax`；L207 `slice(0, this.data.limits.mediaPhotoMax=6)` 保持 6 不动。
- WXML：计数改 `{{skills.length}}/{{limits.skillsMax}}`、`{{highlights.length}}/{{limits.highlightsMax}}`、标题 `{{limits.mediaTitleMax}} · 图片 {{limits.mediaPhotoMax}}`；3 处 input `maxlength="{{limits.skillsLen}}/highlightLen/mediaLen"`。

### 4. RBAC（不改动，确认边界）
- `config_set` 不在 ROLE_GRANTS（L20-43），**默认仅 R1 超管**可改配置。符合「敏感配置仅超管」安全设计，后台用 `admin_r1` 账号在 Operations 页修改即可，R3 运营不可改（如需放开另议）。

## 部署
- 需重部署：`admin-action`、`partner-action` 两个云函数（全路径 cli.bat，一次一个）。
- admin-web 前端零改动（schema 驱动自动渲染），无需 build/inc-deploy。
- 小程序前端改动需重新上传体验版。

## 验证
1. `node --check` 三个改动的 js 文件。
2. 后台：网关 `config_get`（X-Admin-Key）确认 6 字段进入 config_schema；`config_set` 设 `p_skills_max=20`（R1）成功、越界 `p_skills_max=999` 被拒。
3. 小程序端：`config_public` 返回 `partner_profile.skills_max=20`。
4. 前端：技能标签最多 20 条、计数显示 /20；亮点最多 3 条仍拦截（默认）。
5. 后端强约束：构造 15 条技能提交 → 服务端只存 20 条内（配合上限验证）。
6. 回归：`_shared/*.test.js` 单测全通过（默认值未变应无影响）。
7. 恢复 `p_skills_max=10` 默认（或按需保留 20，与用户确认）。

## 尚需用户确认
- 后台改后**≤5 分钟生效**（TTL 缓存），是否可接受；否则需加即时失效参数（非必须，先不做）。
- 默认值是否维持 10/12/3/30/20/20（后台可随时调，默认仅兜底）。