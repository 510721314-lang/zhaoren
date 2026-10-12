// 场景中文名映射 · 规范源(批3.1 单一源)
// 说明: 微信云函数按单目录打包, 无法跨目录 require; 本文件为「规范源」,
//   修改后跑 cloudfunctions/_shared/sync-scene-meta.ps1 同步到各函数副本,
//   并由 scripts/check-shared-sync.js 按 SHA-256 守护一致性。
// 口径: 仅「code → 中文名」纯常量映射, 不含任何业务逻辑。
//   运行时时真 SSOT 为 admin_config.scene_list(运营可改名/新增场景), 本映射仅作
//   「云端未配置 name 时的兜底显示名」; code 列表与前端 miniprogram/config/enums.js
//   的 SCENES、init-db 种子保持一致。
const SCENE_NAMES = {
  W1: '就医陪诊', W2: '学习陪伴', W3: '健身陪伴', W4: '游玩陪伴', W7: '情绪陪伴',
  W8: '生活协助', W9: '宠物陪伴', W10: '出行陪伴', W11: '线上陪伴'
};

module.exports = { SCENE_NAMES };
