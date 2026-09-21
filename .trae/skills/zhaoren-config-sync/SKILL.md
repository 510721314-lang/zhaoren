---
name: zhaoren-config-sync
description: 确保同一业务配置在前端 enum、云端 admin_config 集合、各云函数之间保持一致. Use when 发现首页/发布页展示的场景数量与预期不符、需求发布时场景白名单异常、运营后台改了配置但前端没同步. Do not use for 一次性的功能开发或 bugfix.
---

# Zhaoren Config Sync

本项目的业务配置（场景列表、功能开关、白名单）**严禁在多个地方各自硬编码**。必须遵循 SSOT（Single Source of Truth）架构。

## SSOT 架构

```
admin_config 集合 _id: global (SSOT)
    ├─ home-action        动态读取 → 首页/大厅场景分组数
    ├─ demand-publish     动态读取 → 发布场景白名单校验
    ├─ admin-action       动态读取 → 运营后台配置页面
    └─ 前端 config/enums.js 硬编码兜底（UI 渲染 + 发布页选单）
```

**admin_config 是唯一可信源**。所有云函数启动时读它，不硬编码业务列表。前端 enum 允许硬编码 5 个场景（兜底显示名、图标、免责声明等不适合存数据库的内容），但**场景 code 数量必须与 admin_config.scene_list 对齐**。

## 常见症状 → 根因 → 修复

### 症状：首页展示了隐藏场景

| 层 | 检查点 |
|----|--------|
| 前端 | `pages-v2/index/index.js` 的 `sceneGroups` 是否直接用后端返回（应该是 `wx:for="{{sceneGroups}}"`，**无硬编码遍历**） |
| home-action | `index.js` 中是否仍有硬编码 `SCENE_ORDER` / `SCENE_NAMES` 数组 |
| demand-publish | `index.js` 中是否仍有硬编码 `SCENE_WHITELIST` |
| 云端数据 | admin_config.scene_list 实际存了几个？跑 init-db quick_check 看 `scene_count` |

### 根因模式

1. **代码硬编码同步了但数据库是旧种子** → init-db 对 admin_config 是"补缺失不覆盖"模式，旧种子的 8 场景不会被新种子的 5 自动降级
2. **云函数忘了改** → 改了前端 enum 但 home-action / demand-publish 仍硬编码旧列表
3. **前端有硬编码遍历** → index.wxml 里写死了 8 个 `<view wx:for="{{SCENE_ORDER}}">` 而非 `wx:for="{{sceneGroups}}"`

### 修复套路

1. **home-action**：废弃硬编码数组 → 新增 `loadSceneList()` 函数，启动时读 admin_config，失败则用 SCENE_FALLBACK（5 个）兜底
2. **demand-publish**：废弃硬编码白名单 → 新增 `getSceneCodes()` 函数，缓存 admin_config.scene_list 的 code 数组
3. **init-db 迁移逻辑**：检测 admin_config 已有字段与种子的差异（`extraInDoc` / `missingInDoc`），有差异时覆盖；类似 system_templates 的 T→TM 迁移
4. **init-db force_migrate_scenes**：紧急修复时直接覆盖 scene_list 为 SEED_CONFIG.scene_list
5. **quick_check 增强**：返回 `scene_count` + `seed_expected_codes`，快速诊断云端数据与种子差异

## 验证链路（必须按顺序）

```bash
# 1. 部署所有修改过的云函数
cli cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names home-action --project .
cli cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names demand-publish --project .
cli cloud functions deploy --env cloud1-d9gkefwcp5c777088 --names init-db --project .

# 2. 云端测试 init-db quick_check → 确认 scene_count == 预期数量
#    预期返回: { scene_count: 5, seed_expected_codes: ["W1","W2","W8","W10","W11"] }

# 3. 如有差异 → force_migrate_scenes 覆盖
#    云端测试 init-db, 传参: {"action":"force_migrate_scenes"}

# 4. 等 30 秒让云函数缓存失效（home-action 每次调用都会重新读 admin_config, 无需重部署）

# 5. 云端测试 home-action → 确认 scene_groups.length == 预期数量
#    云端测试 home-action, 传参: {"action":"square"}

# 6. 重新编译小程序 → 首页需求广场 tab 看实际场景分组数
#    如有旧数据 → 清缓存: 开发者工具菜单 → 清缓存 → 全部清除
```

## init-db 可用 Actions

| action | 用途 |
|--------|------|
| `{}` (默认) | 幂等初始化集合/索引/种子 + 差异检测迁移 |
| `quick_check` | 查最近 5 条 demand + admin_config 关键项 + scene_count vs seed 差异 |
| `force_migrate_scenes` | **强制覆盖** scene_list 为 SEED_CONFIG.scene_list（紧急修复用） |
| `force_migrate_templates` | 强制覆盖 system_templates 为 TM1-TM8 |

## admin_config.scene_list 种子定义位置

```
cloudfunctions/init-db/index.js → SEED_CONFIG.scene_list
```

当前种子（5 个）：
- W1 就医陪诊, W2 学习陪伴, W8 生活协助, W10 出行陪伴, W11 线上陪伴

已隐藏场景（不再出现）：W3 健身陪伴, W7 情绪陪伴, W9 宠物陪伴

## git 操作规范

- **不要 npm install node_modules** 后 commit，已在 `.gitignore` 中排除
- 每次改 SSOT 相关云函数后立即部署 + quick_check 验证 + commit push
- commit message 格式：`fix(scene): ...` 或 `feat(config): ...`
