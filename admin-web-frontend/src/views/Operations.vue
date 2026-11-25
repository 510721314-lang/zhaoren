// views/Operations.vue · 运营配置独立模块(阈值 + 场景管理)
// 数据来源: admin-action config_get → operations 聚合块 + config_schema + scene_list
// 阈值表单由 config_schema 元数据驱动(新增参数零前端改动);
// 保存走 diff 确认弹窗(仅提交变化字段 + 必填变更原因)。
// 场景写操作: scene_add / scene_delete / scene_option_add / scene_option_remove
//            / scene_visibility_set / scene_option_visibility_set(前端显示开关)
<template>
  <div>
    <h3 style="margin:0 0 16px">运营配置</h3>

    <el-tabs v-model="activeTab">
      <!-- ── Tab 1: 阈值与开关(schema 驱动) ── -->
      <el-tab-pane label="阈值与开关" name="thresholds">
        <el-alert type="info" :closable="false" style="margin-bottom:12px">
          每个参数下方的灰色文字为其用途与影响说明（由后台 CONFIG_SCHEMA 统一下发，改参数定义时同步维护）。保存仅提交发生变化的参数并需填写变更原因，立即写入配置历史（C 端约 5 分钟内生效）。高风险项：平台总开关、模拟支付开关、平台抽成、费率区间、信用阈值，调整前请评估影响面。
        </el-alert>
        <el-form v-if="data" label-width="210px" label-position="right">
          <el-card v-for="grp in groups" :key="grp" style="margin-bottom:16px">
            <template #header>
              <b>{{ grp }}</b>
              <el-tag v-if="changedInGroup(grp).length" type="warning" size="small" style="margin-left:8px">
                {{ changedInGroup(grp).length }} 项待保存
              </el-tag>
            </template>
            <el-row :gutter="16">
              <el-col v-for="s in fieldsOf(grp)" :key="s.f" :xs="24" :sm="12" :md="8">
                <el-form-item :label="s.label">
                  <el-input-number
                    v-if="s.t === 'int'"
                    v-model="patch[s.f]"
                    :min="s.min"
                    :max="s.max"
                  />
                  <el-select
                    v-else-if="s.t === 'enum'"
                    v-model="patch[s.f]"
                    style="width:100%"
                  >
                    <el-option v-for="o in (s.opts || [])" :key="o" :label="o" :value="o" />
                  </el-select>
                  <el-switch
                    v-else
                    v-model="patch[s.f]"
                    inline-prompt
                    active-text="开启"
                    inactive-text="关闭"
                  />
                  <span v-if="s.unit" class="ops-unit">{{ s.unit }}</span>
                  <!-- 时间红线类参数(自 0:00 起算的分钟数): 实时换算成时刻, 改值即变 -->
                  <span v-if="s.clock" class="ops-clock">= {{ clockText(patch[s.f], s) }}</span>
                  <div v-if="s.d" class="ops-desc">{{ s.d }}</div>
                </el-form-item>
              </el-col>
            </el-row>
            <!-- 分组级 重置/保存 (唯一保存入口; 全滑动开关分组也走本组保存, 不再有底部全局按钮) -->
            <div class="grp-actions">
              <el-button size="small" :disabled="!changedInGroup(grp).length" @click="resetGroup(grp)">重置</el-button>
              <el-button size="small" type="primary" :loading="saving && saveGroup === grp" @click="openSaveGroup(grp)">
                保存<template v-if="changedInGroup(grp).length"> ({{ changedInGroup(grp).length }} 项变更)</template>
              </el-button>
            </div>
          </el-card>
        </el-form>
      </el-tab-pane>

      <!-- ── Tab 2: 场景管理 ── -->
      <el-tab-pane label="场景管理" name="scenes">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <el-button type="primary" @click="openAddScene">+ 新增场景</el-button>
          <el-tag type="info" size="small">共 {{ sceneList.length }} 个场景 ({{ builtinCount }} 内置 / {{ sceneList.length - builtinCount }} 自定义)</el-tag>
          <el-tag type="warning" size="small">内置场景不可删除, 仅可增删服务项</el-tag>
          <el-tag type="success" size="small">列表顺序 = 前端展示顺序: 前 5 名进首页主宫格, 其余进「更多场景」折叠区</el-tag>
        </div>

        <el-table :data="sceneList" border stripe size="small">
          <!-- 展开行: 该场景下的服务项目(SOP)管理区 —— 与场景管理整合(feature-plan-service-sop 批1 原计划) -->
          <el-table-column type="expand" width="40">
            <template #default="{row}">
              <div style="padding:8px 24px 12px">
                <div style="margin-bottom:8px;display:flex;gap:8px;align-items:center">
                  <el-button size="small" type="primary" plain @click="openAddSop(row.code)">＋ 新增「{{ row.name }}」服务项目</el-button>
                  <el-tag size="small" type="info">共 {{ sopByScene(row.code).length }} 项</el-tag>
                  <el-tag size="small" type="info">仅 online 对小程序端可见</el-tag>
                </div>
                <el-table :data="sopByScene(row.code)" border size="small" style="width:100%" empty-text="该场景暂无服务项目，点上方「新增」">
                  <el-table-column prop="name" label="项目名" min-width="140" show-overflow-tooltip />
                  <el-table-column prop="brief" label="简介" min-width="160" show-overflow-tooltip />
                  <el-table-column label="SOP 长度" width="90">
                    <template #default="{row: p}">{{ p.sop_content_len || 0 }} 字</template>
                  </el-table-column>
                  <el-table-column prop="sort" label="排序" width="70" />
                  <el-table-column label="状态" width="80">
                    <template #default="{row: p}">
                      <el-tag :type="p.status === 'online' ? 'success' : 'info'" size="small">{{ p.status === 'online' ? '上架' : '下架' }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="220" fixed="right">
                    <template #default="{row: p}">
                      <el-button size="small" type="primary" text @click="openEditSop(p)">编辑</el-button>
                      <el-button size="small" type="warning" text :loading="sopBusy === p._id" @click="toggleSopStatus(p)">{{ p.status === 'online' ? '下架' : '上架' }}</el-button>
                      <el-button size="small" type="danger" text :loading="sopBusy === p._id" @click="deleteSop(p)">删除</el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="code" label="编码" width="80">
            <template #default="{row}">
              <span style="font-family:monospace;font-weight:600">{{ row.code }}</span>
              <el-tag v-if="row.builtin" type="info" size="small" style="margin-left:4px">内置</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" width="140" />
          <el-table-column label="服务项">
            <template #default="{row}">
              <span v-for="opt in row.options" :key="opt" class="opt-chip">
                <el-tag :type="isOptHidden(row, opt) ? 'info' : 'success'" size="small" :class="{ 'opt-off': isOptHidden(row, opt) }">{{ opt }}</el-tag>
                <el-switch
                  size="small"
                  :model-value="!isOptHidden(row, opt)"
                  :loading="visBusy === row.code + '::' + opt"
                  @change="(v) => toggleOptionVisible(row, opt, v)"
                />
              </span>
              <el-button size="small" text type="primary" @click="openOptAdd(row)">+ 加</el-button>
              <el-button size="small" text type="danger" :disabled="!row.options || row.options.length===0" @click="openOptRemove(row)">- 删</el-button>
              <el-button size="small" text type="primary" :disabled="!row.options || row.options.length < 2" @click="openOptSort(row)">排序</el-button>
            </template>
          </el-table-column>
          <el-table-column label="免责声明类型" width="160">
            <template #default="{row}">{{ disclaimerLabel(row.disclaimer_type) }}</template>
          </el-table-column>
          <el-table-column label="前端显示" width="150" align="center">
            <template #default="{row}">
              <el-switch
                :model-value="row.visible !== false"
                :loading="visBusy === row.code"
                inline-prompt
                active-text="显示"
                inactive-text="隐藏"
                @change="(v) => toggleSceneVisible(row, v)"
              />
              <!-- 场景本身为「显示」但子服务项全被隐藏 → 前端会自动隐藏该场景(home-action 同口径), 明确提示避免误解 -->
              <div v-if="row.visible !== false && frontVisibleOptions(row).length === 0" class="vis-hint">
                <el-tag type="warning" size="small">无可用服务项,前端自动隐藏</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="205" fixed="right">
            <template #default="{row}">
              <el-button size="small" text type="primary" :disabled="isFirstScene(row)" @click="moveScene(row, -1)">↑ 上移</el-button>
              <el-button size="small" text type="primary" :disabled="isLastScene(row)" @click="moveScene(row, 1)">↓ 下移</el-button>
              <el-button size="small" type="danger" plain :disabled="row.builtin" @click="doDeleteScene(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-alert v-if="sceneList.length === 0" type="info" :closable="false" style="margin-top:12px">暂无场景, 请点"+ 新增场景"</el-alert>
      </el-tab-pane>

      <!-- ── Tab 3: 首页活动 ── -->
      <el-tab-pane label="首页活动" name="activities">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <el-button type="primary" :loading="actLoading" @click="loadActivities">刷新</el-button>
          <el-button type="primary" plain @click="openAddActivity">＋ 新增活动</el-button>
          <el-tag type="info" size="small">活动仅在有效期内+状态active时前端可见</el-tag>
        </div>
        <el-table :data="activities" v-loading="actLoading" border stripe size="small">
          <el-table-column prop="id" label="ID" width="140">
            <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.id }}</span></template>
          </el-table-column>
          <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
          <el-table-column label="类型" width="100">
            <template #default="{row}">
              <el-tag size="small">{{ actTypeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{row}">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '显示中' : '隐藏' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="有效期" width="180">
            <template #default="{row}">{{ actTime(row.start_at) }} ~ {{ actTime(row.end_at) }}</template>
          </el-table-column>
          <el-table-column prop="priority" label="优先级" width="70" sortable />
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{row}">
              <el-button size="small" type="primary" text @click="openEditActivity(row)">编辑</el-button>
              <el-button size="small" type="danger" text :loading="actBusy === row.id" @click="doDeleteActivity(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- ── Tab: 发布页 Banner（发布页顶部轮播图，后台可配；未配置时发布页整块不渲染） ── -->
      <el-tab-pane label="发布页 Banner" name="publish_banners">
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
          <el-button type="primary" :loading="pbLoading" @click="loadPublishBanners">刷新</el-button>
          <el-button type="primary" plain @click="openAddBanner">＋ 新增 Banner</el-button>
          <el-tag type="info" size="small">仅 enabled 且有图的 Banner 在发布页顶部显示；链接须为小程序内部路径（以 / 开头）</el-tag>
        </div>
        <el-table :data="publishBanners" v-loading="pbLoading" border stripe size="small">
          <el-table-column prop="id" label="ID" width="140">
            <template #default="{row}"><span style="font-family:monospace;font-size:11px">{{ row.id }}</span></template>
          </el-table-column>
          <el-table-column label="图片" min-width="240">
            <template #default="{row}">
              <span style="font-family:monospace;font-size:12px">{{ (row.images || []).length }} 张</span>
              <span v-if="row.images && row.images[0]" style="margin-left:8px;color:#909399;font-size:11px">{{ row.images[0].image }}</span>
            </template>
          </el-table-column>
          <el-table-column label="跳转链接" min-width="220">
            <template #default="{row}">
              <div style="font-size:12px">{{ (row.images && row.images[0] && row.images[0].link) || '-' }}</div>
              <div v-if="row.images && row.images.length > 1" style="color:#909399;font-size:11px">共 {{ row.images.length }} 个链接</div>
            </template>
          </el-table-column>
          <el-table-column prop="sort" label="排序" width="70" sortable />
          <el-table-column label="状态" width="80">
            <template #default="{row}">
              <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '显示' : '隐藏' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="{row}">
              <el-button size="small" type="primary" text @click="openEditBanner(row)">编辑</el-button>
              <el-button size="small" type="danger" text :loading="pbBusy === row.id" @click="doDeleteBanner(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

    </el-tabs>

    <!-- 参数变更确认弹窗(diff + 原因) -->
    <el-dialog v-model="confirmDialog" title="确认参数变更" width="620px">
      <el-alert
        type="warning"
        :closable="false"
        style="margin-bottom:12px"
        title="仅提交发生变化的参数；保存后立即生效并写入变更日志。"
      />
      <el-table :data="confirmRows" size="small" border style="margin-bottom:14px">
        <el-table-column prop="label" label="参数" width="180" />
        <el-table-column label="原值" width="130">
          <template #default="{row}"><span class="v-old">{{ fmt(row, false) }}</span></template>
        </el-table-column>
        <el-table-column width="36" align="center">
          <template #default>→</template>
        </el-table-column>
        <el-table-column label="新值">
          <template #default="{row}"><span class="v-new">{{ fmt(row, true) }}</span></template>
        </el-table-column>
      </el-table>
      <el-input
        v-model="reason"
        type="textarea"
        :rows="2"
        maxlength="100"
        show-word-limit
        placeholder="请填写变更原因（必填），如：大促前临时放宽接单距离"
      />
      <template #footer>
        <el-button @click="confirmDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!reason.trim()" @click="doSave">确认保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增场景弹窗 -->
    <el-dialog v-model="sceneAddDialog" title="新增场景" width="480px">
      <el-form label-position="top">
        <el-form-item label="场景编码 (W+数字, 如 W12)" required>
          <el-input v-model="newScene.code" placeholder="W12" />
        </el-form-item>
        <el-form-item label="场景名称 (1-12 字)" required>
          <el-input v-model="newScene.name" placeholder="如: 宠物陪伴" />
        </el-form-item>
        <el-form-item label="免责声明类型">
          <el-select v-model="newScene.disclaimer_type" style="width:100%">
            <el-option label="通用声明 general_disclaimer" value="general_disclaimer" />
            <el-option label="就医声明 medical_disclaimer" value="medical_disclaimer" />
            <el-option label="线上声明 online_disclaimer" value="online_disclaimer" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始服务项 (逗号分隔, 最多 8 个)">
          <el-input v-model="newScene.optionsStr" placeholder="如: 遛狗, 喂猫, 就医陪同" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="sceneAddDialog = false">取消</el-button>
        <el-button type="primary" :loading="sceneSaving" @click="doAddScene">确认新增</el-button>
      </template>
    </el-dialog>

    <!-- 服务项增删弹窗 -->
    <el-dialog v-model="optDialog" :title="optIsAdd ? `为 ${optScene?.name} 加服务项` : `从 ${optScene?.name} 删服务项`" width="400px">
      <el-select v-if="optIsAdd" v-model="optValue" filterable allow-create default-first-option placeholder="输入服务项名称 (1-10 字)" style="width:100%">
        <el-option v-for="o in optScene?.options || []" :key="o" :label="o" :value="o" disabled />
      </el-select>
      <el-select v-else v-model="optValue" placeholder="选择要删除的服务项" style="width:100%">
        <el-option v-for="o in optScene?.options || []" :key="o" :label="o" :value="o" />
      </el-select>
      <template #footer>
        <el-button @click="optDialog = false">取消</el-button>
        <el-button type="primary" :loading="sceneSaving" @click="doOptSubmit">确认</el-button>
      </template>
    </el-dialog>

    <!-- 服务项排序弹窗(前端显示顺序 = 此列表顺序; 2026-10-13) -->
    <el-dialog v-model="optSortDialog" :title="`服务项排序 - ${optSortScene?.name || ''}`" width="420px" @closed="load">
      <div v-for="(o, i) in optSortList" :key="o" class="opt-sort-row">
        <span class="opt-sort-name">{{ o }}</span>
        <span>
          <el-button size="small" text type="primary" :disabled="i === 0" @click="moveOpt(i, -1)">↑ 上移</el-button>
          <el-button size="small" text type="primary" :disabled="i === optSortList.length - 1" @click="moveOpt(i, 1)">↓ 下移</el-button>
        </span>
      </div>
      <el-alert type="info" :closable="false" style="margin-top:8px">前端按此顺序展示(被隐藏的服务项自动跳过; 发布页展示前 N 个可见项, N=后台 scene_option_display_max)</el-alert>
      <template #footer>
        <el-button @click="optSortDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 活动编辑弹窗 -->
    <el-dialog v-model="actDialog" :title="actIsEdit ? '编辑活动' : '新增活动'" width="560px">
      <el-form label-position="top">
        <el-row :gutter="12">
          <el-col :span="16"><el-form-item label="活动标题 (1-30 字)" required><el-input v-model="actForm.title" placeholder="如: 国庆搭子总动员" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="活动类型" required>
            <el-select v-model="actForm.type" style="width:100%">
              <el-option label="banner 轮播" value="banner" />
              <el-option label="活动卡片" value="card" />
              <el-option label="两者都有" value="both" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-form-item label="副标题 (≤60 字, 可选)"><el-input v-model="actForm.subtitle" placeholder="如: 假期出行找搭子,最高立减20元" /></el-form-item>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="Banner 图 (750×360 横向, jpg/png/webp ≤2MB)">
            <div class="act-img-row">
              <el-button size="small" type="primary" plain :loading="actUploading === 'banner'" @click="pickActivityImage('banner')">上传图片</el-button>
              <span class="act-img-spec">Banner 类型必填 · 自动压缩为 750×360 横向</span>
            </div>
            <el-input v-model="actForm.banner_image" placeholder="cloud://..." class="act-img-input" />
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="封面图 (750×750 方形, jpg/png/webp ≤2MB)">
            <div class="act-img-row">
              <el-button size="small" type="primary" plain :loading="actUploading === 'cover'" @click="pickActivityImage('cover')">上传图片</el-button>
              <span class="act-img-spec">卡片类型必填 · 自动裁切为 750×750 方形</span>
            </div>
            <el-input v-model="actForm.cover_image" placeholder="cloud://..." class="act-img-input" />
          </el-form-item></el-col>
        </el-row>
        <div class="act-img-tip">图片过大无法直传时：请在「微信开发者工具 → 云开发 → 存储」上传图片，再把 cloud:// 链接粘贴到上方输入框</div>
        <input ref="actFileInput" type="file" accept="image/jpeg,image/png,image/webp" style="display:none" @change="onActivityFileChange" />
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="点击跳转" required>
            <el-select v-model="actForm.jump_to" style="width:100%">
              <el-option label="跳发布页 (预填场景)" value="demand_publish" />
              <el-option label="跳场景广场" value="scene_list" />
              <el-option label="Webview H5" value="webview" />
              <el-option label="活动详情页 (暂未实现)" value="activity_detail" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="关联场景 (可选, 空=所有场景可见)">
            <el-select v-model="actForm.scene_code" clearable placeholder="不绑定=所有场景可见" style="width:100%">
              <el-option v-for="s in sceneList" :key="s.code" :label="`${s.name} (${s.code})`" :value="s.code" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="优先级 (越大越靠前)"><el-input-number v-model="actForm.priority" :min="0" :max="1000" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="状态">
            <el-select v-model="actForm.status" style="width:100%">
              <el-option label="显示" value="active" />
              <el-option label="隐藏" value="draft" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="8"><el-form-item label="有效期 (天, 默认30)">
            <el-input-number v-model="actForm.days" :min="1" :max="365" @change="syncActTime" />
          </el-form-item></el-col>
        </el-row>
        <el-collapse style="margin-top:8px" v-if="actForm.jump_to === 'activity_detail'">
          <el-collapse-item title="活动详情内容 (activity_detail 落地页)" name="content">
            <el-row :gutter="12">
              <el-col :span="12"><el-form-item label="活动时间文案"><el-input v-model="actForm.content.time_text" placeholder="如: 2026-10-01 ~ 2026-12-31" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="活动地点"><el-input v-model="actForm.content.location" placeholder="如: 线上 / 线下某地" /></el-form-item></el-col>
            </el-row>
            <el-form-item label="活动规则 (每行一条, 最多10条)"><el-input v-model="actForm.rulesText" type="textarea" :rows="4" placeholder="注册并登录小程序&#10;发布一条真实需求" /></el-form-item>
            <el-form-item label="活动说明"><el-input v-model="actForm.content.body" type="textarea" :rows="3" /></el-form-item>
            <el-form-item label="按钮文案 (默认: 立即报名)"><el-input v-model="actForm.content.cta_text" maxlength="12" /></el-form-item>
          </el-collapse-item>
        </el-collapse>
      </el-form>
      <template #footer>
        <el-button @click="actDialog = false">取消</el-button>
        <el-button type="primary" :loading="actSaving" @click="doSubmitActivity">确认</el-button>
      </template>
    </el-dialog>

    <!-- 发布页 Banner 编辑弹窗（2026-11-22 多图改版：1~6 张，每张独立链接） -->
    <el-dialog v-model="pbDialog" :title="pbIsEdit ? '编辑 Banner' : '新增 Banner'" width="620px">
      <el-form label-position="top">
        <el-form-item :label="`Banner 图 (横向, jpg/png/webp ≤2MB, 最多 ${PB_MAX_IMAGES} 张)`">
          <div class="act-img-row">
            <el-button size="small" type="primary" plain :loading="pbUploading" :disabled="bannerForm.images.length >= PB_MAX_IMAGES" @click="pickBannerImage">上传图片</el-button>
            <span class="act-img-spec">已 {{ bannerForm.images.length }}/{{ PB_MAX_IMAGES }} 张；自动压缩为宽 750 横向。发布页只轮播前 {{ PB_MAX_IMAGES }} 张</span>
          </div>
          <input ref="bannerFileInput" type="file" multiple accept="image/jpeg,image/png,image/webp" style="display:none" @change="onBannerFileChange" />
          <div v-for="(it, i) in bannerForm.images" :key="i" class="pb-img-item">
            <div class="pb-img-idx">{{ i + 1 }}</div>
            <div class="pb-img-thumb">
              <img v-if="/^https?:/.test(it.image)" :src="it.image" alt="" style="width:100%;height:100%;object-fit:cover" />
              <span v-else>{{ it.image ? '已上传' : '待上传' }}</span>
            </div>
            <div class="pb-img-main">
              <el-input v-model="it.image" placeholder="cloud://..." size="small" />
              <el-input v-model="it.link" placeholder="跳转链接，如 /pages-v2/publish/publish?sceneCode=W1" size="small" style="margin-top:6px" />
            </div>
            <el-button size="small" type="danger" text @click="removeBannerImage(i)">删除</el-button>
          </div>
          <div v-if="!bannerForm.images.length" class="pb-img-empty">暂无图片，请点「上传图片」或直接粘贴 cloud:// 链接</div>
        </el-form-item>
        <div style="font-size:12px;color:#909399;margin:-8px 0 12px">每张图链接必填且须为小程序内部路径（以 / 开头）；tabBar 页（首页/广场/服务/消息/我的）会自动用 switchTab 跳转</div>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="排序 (越小越靠前)"><el-input-number v-model="bannerForm.sort" :min="0" :max="9999" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="启用"><el-switch v-model="bannerForm.enabled" /></el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="pbDialog = false">取消</el-button>
        <el-button type="primary" :loading="pbSaving" @click="doSubmitBanner">确认</el-button>
      </template>
    </el-dialog>

    <!-- 服务项目编辑弹窗（批1，feature-plan-service-sop） -->
    <el-dialog v-model="sopDialog" :title="sopIsEdit ? '编辑服务项目' : '新增服务项目'" width="680px" destroy-on-close>
      <el-form label-position="top">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="关联场景" required>
            <el-select v-model="sopForm.scene_code" placeholder="选择场景" style="width:100%">
              <el-option v-for="s in sceneList" :key="s.code" :label="`${s.name} (${s.code})`" :value="s.code" />
            </el-select>
          </el-form-item></el-col>
          <el-col :span="12"><el-form-item label="项目名 (1-30 字)" required>
            <el-input v-model="sopForm.name" maxlength="30" show-word-limit placeholder="如: 就医陪同" />
          </el-form-item></el-col>
        </el-row>
        <el-form-item label="简介 (≤100 字)">
          <el-input v-model="sopForm.brief" maxlength="100" show-word-limit placeholder="一句话说明该服务项目" />
        </el-form-item>
        <el-form-item :label="`SOP 正文（纯文本 ≤20000 字，当前 ${sopWordCount}/20000）`">
          <div style="border:1px solid #dcdfe6;border-radius:4px;z-index:100;">
            <Toolbar :editor="sopEditorRef" :defaultConfig="sopToolbarConfig" style="border-bottom:1px solid #dcdfe6;" />
            <Editor :defaultConfig="sopEditorConfig" v-model="sopForm.sop_content" style="height:320px;overflow-y:hidden;" @onCreated="onSopEditorCreated" @onChange="onSopEditorChange" />
          </div>
        </el-form-item>
        <el-form-item label="封面图 fileID (可选, 暂留空)">
          <el-input v-model="sopForm.cover_fileid" placeholder="cloud://..." />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="排序 (越小越靠前)"><el-input-number v-model="sopForm.sort" :min="0" :max="9999" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="状态">
            <el-select v-model="sopForm.status" style="width:100%">
              <el-option label="上架" value="online" />
              <el-option label="下架" value="offline" />
            </el-select>
          </el-form-item></el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="sopDialog = false">取消</el-button>
        <el-button type="primary" :loading="sopSaving" @click="saveSop">确认保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, shallowRef, onBeforeUnmount } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { call } from '../api/admin.js';
import '@wangeditor/editor/dist/css/style.css';
import { Editor, Toolbar } from '@wangeditor/editor-for-vue';

const activeTab = ref('thresholds');
const data = ref(null);
const patch = reactive({});
const orig = reactive({});
const saving = ref(false);
const sceneSaving = ref(false);

// ───────── schema 驱动: 分组与字段 ─────────
const groups = computed(() => {
  const schema = data.value?.config_schema || [];
  const arr = [];
  schema.forEach((s) => { if (arr.indexOf(s.g) < 0) arr.push(s.g); });
  return arr;
});
function fieldsOf(g) {
  return (data.value?.config_schema || []).filter((s) => s.g === g);
}

// ───────── diff(仅 schema 字段; 与加载快照逐字段比较) ─────────
const diffRows = computed(() => {
  const schema = data.value?.config_schema || [];
  return schema
    .filter((s) => String(orig[s.f]) !== String(patch[s.f]))
    .map((s) => ({ f: s.f, label: s.label, unit: s.unit || '', t: s.t, old: orig[s.f], now: patch[s.f] }));
});
function changedInGroup(g) {
  const keys = fieldsOf(g).map((s) => s.f);
  return diffRows.value.filter((r) => keys.indexOf(r.f) >= 0);
}
// 分组级重置: 把该分组字段恢复到加载快照
function resetGroup(g) {
  fieldsOf(g).forEach((s) => { patch[s.f] = orig[s.f]; });
}
function fmt(row, isNew) {
  const v = isNew ? row.now : row.old;
  if (row.t === 'bool') return v ? '开启' : '关闭';
  return v + (row.unit ? ' ' + row.unit : '');
}
// 时间红线类参数(clock=true, 值为自 0:00 起算的分钟数)换算为 HH:MM;
// 值 0 的语义由 schema.clockZero 指定(如「全天开放」), 未指定则按 00:00 展示
function clockText(min, s) {
  const n = Number(min);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n === 0 && s && s.clockZero) return s.clockZero;
  if (n >= 1440) return '24:00';
  const h = String(Math.floor(n / 60)).padStart(2, '0');
  const m = String(Math.round(n % 60)).padStart(2, '0');
  return `${h}:${m}`;
}

// ───────── 加载 / 保存 ─────────
async function load() {
  const r = await call('config_get');
  if (r.ok && r.data) {
    data.value = r.data;
    const ops = r.data.operations || {};
    Object.keys(patch).forEach((k) => delete patch[k]);
    Object.keys(orig).forEach((k) => delete orig[k]);
    Object.assign(patch, ops);
    Object.assign(orig, ops);
  } else {
    ElMessage.error(r.msg || '加载失败');
  }
}

const confirmDialog = ref(false);
const reason = ref('');
const saveGroup = ref(null); // 当前保存针对的分组名(仅该分组; 保存后置回 null)

// 确认弹窗显示的 diff 行: 仅当前分组
const confirmRows = computed(() => {
  if (saveGroup.value) return changedInGroup(saveGroup.value);
  return diffRows.value;
});

function openSaveGroup(grp) {
  const changes = changedInGroup(grp);
  if (!changes.length) { ElMessage.info('没有参数变更'); return; }
  saveGroup.value = grp;
  reason.value = '';
  confirmDialog.value = true;
}

async function doSave() {
  if (!reason.value.trim()) { ElMessage.warning('请填写变更原因'); return; }
  saving.value = true;
  const payload = { reason: reason.value.trim() };
  confirmRows.value.forEach((r) => { payload[r.f] = r.now; });
  const r = await call('config_set', payload);
  saving.value = false;
  if (r.ok) {
    ElMessage.success(`已保存 ${(r.data && r.data.updated && r.data.updated.length) || ''} 项参数`);
    confirmDialog.value = false;
    saveGroup.value = null;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '保存失败');
  }
}

// ───────── 活动管理 ─────────
const activities = ref([]);
const actLoading = ref(false);
const actBusy = ref('');
const actDialog = ref(false);
const actIsEdit = ref(false);
const actSaving = ref(false);
const actUploading = ref('');   // '' | banner | cover(上传中标记)
const actFileInput = ref(null); // 隐藏 file input
const actPendingUse = ref('banner'); // 待上传用途
const actForm = reactive({
  id: '', title: '', subtitle: '', banner_image: '', cover_image: '',
  type: 'banner', jump_to: 'demand_publish', jump_param: {},
  scene_code: '', priority: 0, status: 'active', days: 30,
  start_at: 0, end_at: 0,
  // 活动详情内容(activity_detail 落地页)
  content: { time_text: '', location: '', body: '', cta_text: '' },
  rulesText: ''
});

function actTypeLabel(t) {
  return { banner: '轮播', card: '卡片', both: '两者' }[t] || t;
}
function actTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function syncActTime() {
  const now = Date.now();
  actForm.start_at = now;
  actForm.end_at = now + (actForm.days || 30) * 86400000;
}

async function loadActivities() {
  actLoading.value = true;
  const r = await call('home_activity_list');
  actLoading.value = false;
  if (r.ok) activities.value = r.data?.list || [];
  else ElMessage.error(r.msg || '加载活动失败');
}

function openAddActivity() {
  actIsEdit.value = false;
  actForm.id = ''; actForm.title = ''; actForm.subtitle = '';
  actForm.banner_image = ''; actForm.cover_image = '';
  actForm.type = 'banner'; actForm.jump_to = 'demand_publish';
  actForm.jump_param = {}; actForm.scene_code = '';
  actForm.priority = 0; actForm.status = 'active'; actForm.days = 30;
  actForm.content = { time_text: '', location: '', body: '', cta_text: '' };
  actForm.rulesText = '';
  syncActTime();
  actDialog.value = true;
}

function openEditActivity(row) {
  actIsEdit.value = true;
  Object.assign(actForm, { ...row, days: Math.round((row.end_at - row.start_at) / 86400000) || 30 });
  actForm.content = row.content || { time_text: '', location: '', body: '', cta_text: '' };
  actForm.rulesText = (row.content && row.content.rules || []).join('\n');
  actDialog.value = true;
}

async function doSubmitActivity() {
  // trim 后判空: 只填空格不算填(否则前端活动卡片会渲染出一块空白正文区)
  actForm.title = String(actForm.title || '').trim();
  actForm.subtitle = String(actForm.subtitle || '').trim();
  if (!actForm.title) { ElMessage.warning('标题必填'); return; }
  if (!actForm.type) { ElMessage.warning('类型必填'); return; }
  actSaving.value = true;
  const rules = actForm.rulesText.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const payload = {
    title: actForm.title, subtitle: actForm.subtitle,
    banner_image: actForm.banner_image, cover_image: actForm.cover_image,
    type: actForm.type, jump_to: actForm.jump_to,
    jump_param: actForm.jump_param, scene_code: actForm.scene_code,
    start_at: actForm.start_at, end_at: actForm.end_at,
    status: actForm.status, priority: actForm.priority,
    content: {
      time_text: actForm.content.time_text, location: actForm.content.location,
      rules, body: actForm.content.body, cta_text: actForm.content.cta_text
    }
  };
  const r = actIsEdit.value
    ? await call('home_activity_update', { id: actForm.id, patch: payload })
    : await call('home_activity_create', { activity: payload });
  actSaving.value = false;
  if (r.ok) {
    ElMessage.success(actIsEdit.value ? '已更新' : '已创建');
    actDialog.value = false;
    await loadActivities();
  } else { ElMessage.error(r.msg || r.code || '保存失败'); }
}

// ───────── 活动图片上传(base64 → admin-action upload_image → cloud fileID) ─────────
// 规格: banner 750×360 横向 / cover 750×750 方形, 源文件 jpg/png/webp ≤2MB
// 通道限制: CloudBase HTTP 网关请求体上限约 100KiB, base64 直传仅支持 ≤90KB 小图,
//   故前端统一 canvas 压缩到目标规格(JPEG 逐级降质); 压缩后仍超限 → 引导到云开发控制台→存储上传后粘贴 cloud:// 链接
const INLINE_B64_MAX = 90 * 1024;  // base64 上限(留网关余量)
const ACT_IMG_SPEC = { banner: { w: 750, square: false }, cover: { w: 750, square: true } };

function pickActivityImage(use) {
  actPendingUse.value = use;
  actFileInput.value && actFileInput.value.click();
}

function compressImageForUpload(file, use) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const spec = ACT_IMG_SPEC[use] || ACT_IMG_SPEC.banner;
        const W = img.naturalWidth, H = img.naturalHeight;
        if (!W || !H) { resolve(''); return; }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (spec.square) {
          // 封面: 中心裁剪成方形, 限 750×750(不放大)
          const s = Math.min(Math.min(W, H), 750);
          canvas.width = s; canvas.height = s;
          ctx.drawImage(img, (W - s) / 2, (H - s) / 2, s, s, 0, 0, s, s);
        } else {
          // Banner: 按比例缩到宽 750 以内(不放大)
          let cw = W, ch = H;
          if (cw > 750) { ch = Math.round(ch * 750 / cw); cw = 750; }
          canvas.width = cw; canvas.height = ch;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
        }
        // 逐级降质, 直到 base64 ≤ 90KB
        for (const q of [0.85, 0.72, 0.6]) {
          const b64 = canvas.toDataURL('image/jpeg', q).replace(/^data:image\/jpeg;base64,/, '');
          if (b64.length <= INLINE_B64_MAX) { resolve(b64); return; }
        }
        resolve(''); // 压缩后仍超限 → 交给控制台路径
      } catch (e) {
        resolve('');
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}

async function onActivityFileChange(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';   // 允许重复选择同一文件
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { ElMessage.error('图片大小不能超过 2MB'); return; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { ElMessage.error('仅支持 jpg/png/webp 格式'); return; }
  const use = actPendingUse.value;
  const b64 = await compressImageForUpload(file, use);
  if (!b64) {
    ElMessage({ message: '图片处理后仍过大,请在 云开发控制台→存储→上传图片,再把 cloud:// 链接粘贴到下方输入框', type: 'warning', duration: 5000 });
    return;
  }
  actUploading.value = use;
  try {
    const r = await call('upload_image', { use, fileData: b64 });
    if (r.ok && r.data && r.data.fileID) {
      if (use === 'banner') actForm.banner_image = r.data.fileID;
      else actForm.cover_image = r.data.fileID;
      ElMessage.success('图片上传成功,已自动压缩为推荐规格');
    } else {
      ElMessage.error(r.msg || r.code || '图片上传失败');
    }
  } finally {
    actUploading.value = '';
  }
}

async function doDeleteActivity(row) {
  try {
    await ElMessageBox.confirm(`确认删除活动「${row.title}」?`, '删除确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
  } catch (_) { return; }
  actBusy.value = row.id;
  const r = await call('home_activity_delete', { id: row.id });
  actBusy.value = '';
  if (r.ok) { ElMessage.success('已删除'); await loadActivities(); }
  else { ElMessage.error(r.msg || r.code || '删除失败'); }
}

// ───────── 发布页顶部 Banner 管理（发布页轮播图；仅 enabled 且有图的在小程序端显示） ─────────
const publishBanners = ref([]);
const pbLoading = ref(false);
const pbBusy = ref('');
const pbDialog = ref(false);
const pbIsEdit = ref(false);
const pbSaving = ref(false);
const pbUploading = ref(false);
const bannerFileInput = ref(null);
const PB_MAX_IMAGES = 6;
// 2026-11-22 多图改版：images 为 [{image, link}]；旧数据 image/link 在编辑时兼容为 1 张
const bannerForm = reactive({ id: '', images: [{ image: '', link: '' }], sort: 0, enabled: true });

function resetBannerForm() {
  Object.assign(bannerForm, { id: '', images: [{ image: '', link: '' }], sort: 0, enabled: true });
}

function removeBannerImage(i) {
  bannerForm.images.splice(i, 1);
  if (!bannerForm.images.length) bannerForm.images.push({ image: '', link: '' });
}

async function loadPublishBanners() {
  pbLoading.value = true;
  const r = await call('publish_banner_list');
  pbLoading.value = false;
  if (r.ok) publishBanners.value = r.data?.list || [];
  else ElMessage.error(r.msg || '加载 Banner 失败');
}

function openAddBanner() {
  pbIsEdit.value = false;
  resetBannerForm();
  pbDialog.value = true;
}

function openEditBanner(row) {
  pbIsEdit.value = true;
  const images = Array.isArray(row.images) && row.images.length
    ? row.images.map((it) => ({ image: it.image || '', link: it.link || '' }))
    : [{ image: row.image || '', link: row.link || '' }];
  Object.assign(bannerForm, { id: row.id, images, sort: row.sort || 0, enabled: row.enabled !== false });
  pbDialog.value = true;
}

async function doSubmitBanner() {
  const images = (bannerForm.images || [])
    .map((it) => ({ image: String(it.image || '').trim(), link: String(it.link || '').trim() }))
    .filter((it) => it.image || it.link);
  if (!images.length) { ElMessage.warning('Banner 图片必填'); return; }
  if (images.length > PB_MAX_IMAGES) { ElMessage.warning(`最多 ${PB_MAX_IMAGES} 张图片`); return; }
  for (const it of images) {
    if (!it.image) { ElMessage.warning('每张图片的 cloud:// 地址必填'); return; }
    if (!it.link || it.link.charAt(0) !== '/') { ElMessage.warning('每张图的链接须为小程序内部路径（以 / 开头）'); return; }
  }
  pbSaving.value = true;
  const payload = { images, sort: bannerForm.sort, enabled: bannerForm.enabled };
  const r = pbIsEdit.value
    ? await call('publish_banner_update', { id: bannerForm.id, patch: payload })
    : await call('publish_banner_create', { banner: payload });
  pbSaving.value = false;
  if (r.ok) {
    ElMessage.success(pbIsEdit.value ? '已更新' : '已创建');
    pbDialog.value = false;
    await loadPublishBanners();
  } else { ElMessage.error(r.msg || r.code || '保存失败'); }
}

function pickBannerImage() {
  bannerFileInput.value && bannerFileInput.value.click();
}

// 支持一次多选：逐张校验 ≤2MB + 格式，压缩后逐个上传并追加，最多 6 张
async function onBannerFileChange(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  pbUploading.value = true;
  try {
    for (const file of files) {
      if (bannerForm.images.filter((it) => it.image).length >= PB_MAX_IMAGES) {
        ElMessage.warning(`最多 ${PB_MAX_IMAGES} 张图片`);
        break;
      }
      if (file.size > 2 * 1024 * 1024) { ElMessage.error(`${file.name} 大小超过 2MB`); continue; }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { ElMessage.error(`${file.name} 仅支持 jpg/png/webp`); continue; }
      const b64 = await compressImageForUpload(file, 'banner');
      if (!b64) {
        ElMessage({ message: `${file.name} 处理后仍过大，请在云开发控制台→存储上传后粘贴 cloud:// 链接`, type: 'warning', duration: 5000 });
        continue;
      }
      const r = await call('upload_image', { use: 'banner', fileData: b64 });
      if (r.ok && r.data && r.data.fileID) {
        // 首行空占位复用，其余追加
        const empty = bannerForm.images.find((it) => !it.image);
        if (empty) empty.image = r.data.fileID;
        else bannerForm.images.push({ image: r.data.fileID, link: '' });
      } else {
        ElMessage.error(r.msg || r.code || '图片上传失败');
      }
    }
  } finally {
    pbUploading.value = false;
  }
}

async function doDeleteBanner(row) {
  try {
    await ElMessageBox.confirm('确认删除该 Banner?', '删除确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
  } catch (_) { return; }
  pbBusy.value = row.id;
  const r = await call('publish_banner_delete', { id: row.id });
  pbBusy.value = '';
  if (r.ok) { ElMessage.success('已删除'); await loadPublishBanners(); }
  else { ElMessage.error(r.msg || r.code || '删除失败'); }
}

// ───────── 服务项目与 SOP 管理（批1，feature-plan-service-sop-20261121） ─────────
const sopProjects = ref([]);
const sopLoading = ref(false);
const sopBusy = ref('');
const sopDialog = ref(false);
const sopIsEdit = ref(false);
const sopSaving = ref(false);
const sopForm = reactive({
  _id: '', scene_code: '', name: '', brief: '', sop_content: '', cover_fileid: '', sort: 0, status: 'online'
});
function resetSopForm() {
  Object.assign(sopForm, { _id: '', scene_code: '', name: '', brief: '', sop_content: '', cover_fileid: '', sort: 0, status: 'online' });
}

// ── SOP 富文本编辑器（wangEditor v5）：图片走 upload_image(use=sop)，视频阶段1仅粘贴 cloud:// 链接 ──
const sopEditorRef = shallowRef(null);
const sopWordCount = ref(0);
const sopToolbarConfig = { excludeKeys: ['uploadVideo'] }; // 禁「上传视频」，保留「插入视频」粘贴链接
const sopEditorConfig = {
  placeholder: '履约前/中/后的标准操作步骤与注意事项，可插图/粘贴视频链接',
  MENU_CONF: {
    uploadImage: {
      async customUpload(file, insertFn) {
        // 复用活动图压缩链路：use=sop 走 banner 分支（限宽 750、不强制 1:1）
        const b64 = await compressImageForUpload(file, 'sop');
        if (!b64) { ElMessage.warning('图片处理后仍过大，请在云开发控制台→存储上传后粘贴 cloud:// 链接'); return; }
        const r = await call('upload_image', { use: 'sop', fileData: b64 });
        if (r.ok && r.data && r.data.fileID) {
          insertFn(r.data.fileID, file.name, r.data.fileID); // <img src="cloud://...">，小程序端转临时链接渲染
        } else {
          ElMessage.error(r.msg || r.code || '图片上传失败');
        }
      }
    }
  }
};
function plainTextLen(html) {
  // 与后端 action_service_sop.stripTags 口径一致：去标签/实体后按纯文本计字数
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}
function onSopEditorCreated(editor) { sopEditorRef.value = editor; }
function onSopEditorChange(editor) {
  sopWordCount.value = plainTextLen(editor ? editor.getHtml() : sopForm.sop_content);
}
onBeforeUnmount(() => { const e = sopEditorRef.value; if (e) { e.destroy(); sopEditorRef.value = null; } });

async function loadSopProjects() {
  sopLoading.value = true;
  const r = await call('sop_project_list');
  sopLoading.value = false;
  if (r.ok) sopProjects.value = r.data?.list || [];
  else ElMessage.error(r.msg || '加载服务项目失败');
}
// 按场景过滤服务项目(场景展开行用; 全量已在 onMounted 加载, 零额外请求)
function sopByScene(code) {
  return sopProjects.value.filter((p) => p.scene_code === code);
}
function openAddSop(sceneCode) {
  sopIsEdit.value = false;
  resetSopForm();
  if (sceneCode) sopForm.scene_code = sceneCode;  // 从场景展开行新增时预设关联场景
  sopWordCount.value = 0;
  sopDialog.value = true;
}
function openEditSop(row) {
  sopIsEdit.value = true;
  Object.assign(sopForm, {
    _id: row._id, scene_code: row.scene_code, name: row.name, brief: row.brief,
    sop_content: row.sop_content, cover_fileid: row.cover_fileid, sort: row.sort, status: row.status
  });
  sopWordCount.value = plainTextLen(row.sop_content);
  sopDialog.value = true;
}
async function saveSop() {
  sopForm.name = String(sopForm.name || '').trim();
  sopForm.brief = String(sopForm.brief || '').trim();
  if (!sopForm.scene_code) { ElMessage.warning('请选择关联场景'); return; }
  if (!sopForm.name) { ElMessage.warning('项目名必填'); return; }
  sopSaving.value = true;
  const payload = {
    scene_code: sopForm.scene_code, name: sopForm.name, brief: sopForm.brief,
    sop_content: sopForm.sop_content, cover_fileid: sopForm.cover_fileid,
    sort: sopForm.sort, status: sopForm.status
  };
  if (sopIsEdit.value) payload._id = sopForm._id;
  const r = await call('sop_project_save', payload);
  sopSaving.value = false;
  if (r.ok) {
    ElMessage.success(sopIsEdit.value ? '已更新' : '已创建');
    sopDialog.value = false;
    await loadSopProjects();
  } else { ElMessage.error(r.msg || r.code || '保存失败'); }
}
async function toggleSopStatus(row) {
  const next = row.status === 'online' ? 'offline' : 'online';
  sopBusy.value = row._id;
  const r = await call('sop_project_status', { _id: row._id, status: next });
  sopBusy.value = '';
  if (r.ok) { ElMessage.success(next === 'online' ? '已上架' : '已下架'); await loadSopProjects(); }
  else { ElMessage.error(r.msg || r.code || '操作失败'); }
}
async function deleteSop(row) {
  try {
    await ElMessageBox.confirm(`确认删除服务项目「${row.name}」? 软删除, 小程序端不再展示。`, '删除确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
  } catch (_) { return; }
  sopBusy.value = row._id;
  const r = await call('sop_project_delete', { _id: row._id });
  sopBusy.value = '';
  if (r.ok) { ElMessage.success('已删除'); await loadSopProjects(); }
  else { ElMessage.error(r.msg || r.code || '删除失败'); }
}

// ───────── 场景列表 ─────────
const sceneList = computed(() => data.value?.scene_list || []);
const builtinCount = computed(() => sceneList.value.filter((s) => s.builtin).length);

// 新增场景弹窗
const sceneAddDialog = ref(false);
const newScene = reactive({ code: '', name: '', disclaimer_type: 'general_disclaimer', optionsStr: '' });

// 服务项弹窗
const optDialog = ref(false);
const optIsAdd = ref(true);
const optScene = ref(null);
const optValue = ref('');

function disclaimerLabel(type) {
  const m = { medical_disclaimer: '就医声明', general_disclaimer: '通用声明', online_disclaimer: '线上声明' };
  return m[type] || type || '通用声明';
}

// ── 前端显示开关(场景 / 服务项) ──
// 语义: 仅隐藏前端入口(首页宫格/广场 chips/发布页场景卡/接单配置), 不做后端拦截;
//       隐藏场景的存量需求仍在广场 all 流水、附近列表与详情页可见。
const visBusy = ref('');
function isOptHidden(row, opt) {
  return (row.hidden_options || []).indexOf(opt) >= 0;
}
// 前端可见服务项(与 home-action 同口径: 先取前 N 项再剔除隐藏项); N = 后台 scene_option_display_max(缺省 3)
function frontVisibleOptions(row) {
  const n = Number(data.value?.operations?.scene_option_display_max) || 3;
  const max = Math.min(8, Math.max(1, n));
  return (row.options || []).slice(0, max).filter((o) => !isOptHidden(row, o));
}
async function confirmHide(what) {
  try {
    await ElMessageBox.confirm(
      `${what} 将不再出现在前端入口(首页宫格 / 广场 / 发布页 / 接单配置); 该场景的存量需求仍可在广场、附近与详情页看到。确认隐藏?`,
      '隐藏确认',
      { type: 'warning', confirmButtonText: '确认隐藏', cancelButtonText: '取消' }
    );
    return true;
  } catch (_) { return false; }
}
async function toggleSceneVisible(row, visible) {
  if (visible === false && !(await confirmHide(`场景「${row.name} (${row.code})」`))) return;
  visBusy.value = row.code;
  const r = await call('config_set', { scene_visibility_set: { scene: row.code, visible: !!visible } });
  visBusy.value = '';
  if (r.ok) { ElMessage.success(visible ? '已设为前端显示' : '已隐藏'); await load(); }
  else { ElMessage.error(r.msg || r.code || '操作失败'); }
}
async function toggleOptionVisible(row, opt, visible) {
  if (visible === false && !(await confirmHide(`服务项「${opt}」`))) return;
  visBusy.value = row.code + '::' + opt;
  const r = await call('config_set', { scene_option_visibility_set: { scene: row.code, option: opt, visible: !!visible } });
  visBusy.value = '';
  if (r.ok) { ElMessage.success(visible ? '已设为前端显示' : '已隐藏'); await load(); }
  else { ElMessage.error(r.msg || r.code || '操作失败'); }
}

// ── 场景/服务项排序(2026-10-13 需求: 前端显示顺序 = scene_list/options 数组序) ──
function scenePos(row) { return sceneList.value.indexOf(row); }
function isFirstScene(row) { return scenePos(row) <= 0; }
function isLastScene(row) { return scenePos(row) >= sceneList.value.length - 1; }
async function moveScene(row, dir) {
  if (sceneSaving.value) return;
  sceneSaving.value = true;
  const r = await call('config_set', { scene_reorder: { scene: row.code, direction: dir < 0 ? 'up' : 'down' } });
  sceneSaving.value = false;
  if (r.ok) { await load(); } else { ElMessage.error(r.msg || r.code || '排序失败'); }
}

// 服务项排序弹窗: 每次点击即时落库; 关闭弹窗时整体重载对齐云端
const optSortDialog = ref(false);
const optSortScene = ref(null);
const optSortList = ref([]);
function openOptSort(row) { optSortScene.value = row; optSortList.value = (row.options || []).slice(); optSortDialog.value = true; }
async function moveOpt(i, dir) {
  const list = optSortList.value;
  const to = dir < 0 ? i - 1 : i + 1;
  if (to < 0 || to >= list.length || sceneSaving.value) return;
  sceneSaving.value = true;
  const r = await call('config_set', { scene_option_reorder: { scene: optSortScene.value.code, option: list[i], direction: dir < 0 ? 'up' : 'down' } });
  sceneSaving.value = false;
  if (r.ok) {
    const tmp = list[i]; list[i] = list[to]; list[to] = tmp;
    optSortList.value = list.slice();
  } else { ElMessage.error(r.msg || r.code || '排序失败'); }
}

// ── 场景新增 ──
function openAddScene() {
  newScene.code = ''; newScene.name = ''; newScene.disclaimer_type = 'general_disclaimer'; newScene.optionsStr = '';
  sceneAddDialog.value = true;
}
async function doAddScene() {
  if (!newScene.code || !newScene.name) { ElMessage.warning('编码和名称必填'); return; }
  sceneSaving.value = true;
  const options = newScene.optionsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const r = await call('config_set', {
    scene_add: { code: newScene.code, name: newScene.name, disclaimer_type: newScene.disclaimer_type, options }
  });
  sceneSaving.value = false;
  if (r.ok) {
    ElMessage.success('场景已新增, 可在"法律合规"页面补充该场景专属免责声明');
    sceneAddDialog.value = false;
    await load();
  } else {
    ElMessage.error(r.msg || r.code || '新增失败');
  }
}

// ── 场景删除 ──
async function doDeleteScene(row) {
  if (row.builtin) { ElMessage.warning('内置场景不可删除'); return; }
  if (row.options && row.options.length > 0) {
    ElMessage.warning('该场景还有服务项, 请先清空再删除');
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除场景「${row.name} (${row.code})」? 此操作不可恢复。`, '删除确认', { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' });
  } catch (_) { return; }
  sceneSaving.value = true;
  const r = await call('config_set', { scene_delete: row.code });
  sceneSaving.value = false;
  if (r.ok) { ElMessage.success('已删除'); await load(); }
  else { ElMessage.error(r.msg || r.code || '删除失败'); }
}

// ── 服务项增删 ──
function openOptAdd(row) { optIsAdd.value = true; optScene.value = row; optValue.value = ''; optDialog.value = true; }
function openOptRemove(row) {
  if (!row.options || row.options.length === 0) { ElMessage.warning('该场景无服务项'); return; }
  optIsAdd.value = false; optScene.value = row; optValue.value = ''; optDialog.value = true;
}
async function doOptSubmit() {
  if (!optValue.value || !optScene.value) { ElMessage.warning('请填写服务项'); return; }
  sceneSaving.value = true;
  const payload = optIsAdd.value
    ? { scene_option_add: { scene: optScene.value.code, option: optValue.value } }
    : { scene_option_remove: { scene: optScene.value.code, option: optValue.value } };
  const r = await call('config_set', payload);
  sceneSaving.value = false;
  if (r.ok) {
    ElMessage.success(optIsAdd.value ? '已添加' : '已删除');
    optDialog.value = false;
    await load();
  } else { ElMessage.error(r.msg || r.code || '操作失败'); }
}

onMounted(async () => {
  await load();
  await loadActivities();
  await loadSopProjects();
});
</script>

<style scoped>
.ops-unit { margin-left:8px; color:#909399; font-size:12px; }
.ops-clock { margin-left:8px; color:#409EFF; font-size:12px; font-weight:600; }
.ops-desc { flex-basis:100%; width:100%; font-size:12px; color:#909399; line-height:1.45; margin-top:2px; }
.grp-actions { margin-top:12px; text-align:right; display:flex; justify-content:flex-end; gap:8px; }
.opt-chip { display:inline-flex; align-items:center; gap:2px; margin:0 10px 4px 0; }
.opt-sort-row { display:flex; align-items:center; justify-content:space-between; padding:6px 4px; border-bottom:1px dashed #ebeef5; }
.opt-sort-row:last-of-type { border-bottom:none; }
.opt-sort-name { font-size:13px; }
.vis-hint { margin-top:4px; line-height:1.3; }
.opt-off { text-decoration: line-through; }
.v-old { color:#909399; }
.v-new { color:#67c23a; font-weight:600; }
.act-img-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.act-img-spec { font-size:12px; color:#909399; }
/* 发布页 Banner 多图列表（2026-11-22） */
.pb-img-item { display:flex; align-items:flex-start; gap:10px; padding:8px; border:1px solid var(--el-border-color-lighter); border-radius:6px; margin-bottom:8px; }
.pb-img-idx { width:18px; height:18px; flex:0 0 18px; margin-top:12px; border-radius:50%; background:#f0f2f5; color:#909399; font-size:11px; line-height:18px; text-align:center; }
.pb-img-main { flex:1; min-width:0; }
.pb-img-thumb { width:96px; height:46px; flex:0 0 96px; border-radius:4px; background:#f5f7fa; display:flex; align-items:center; justify-content:center; overflow:hidden; font-size:11px; color:#909399; }
.pb-img-empty { padding:14px; border:1px dashed var(--el-border-color); border-radius:6px; color:#909399; font-size:12px; text-align:center; }
.act-img-input { font-size:12px; }
.act-img-tip { font-size:12px; color:#E6A23C; background:#fdf6ec; border:1px solid #faecd8; border-radius:4px; padding:6px 8px; line-height:1.5; margin-bottom:8px; }
</style>
