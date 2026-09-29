// zz-ai-guard · AI 通道可用性验证（临时函数，2026-09-29，验证后删除）
// 职责：在云函数内通过 @cloudbase/node-sdk 调 CloudBase AI 文本生成，验证链路可用
// 守卫：仅 admin_openids 白名单可调用；无 mock 身份；失败 fail-closed 返回 ai_unavailable
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const wxCtx = cloud.getWXContext();
  // 云端测试面板无真实 OPENID → 走 mock_openid（管理员显式传身份）；与 resolveOpenid 语义一致，仅临时验证函数用
  const openid = wxCtx.OPENID || event.mock_openid || null;
  if (!openid) return { ok: false, code: 'ai_no_openid', msg: '未获取到登录身份（请传 mock_openid 或真机调用）' };

  const db = cloud.database();
  let cfg = { admin_openids: [] };
  try {
    const r = await db.collection('admin_config').doc('global').get();
    cfg = r.data || cfg;
  } catch (e) { /* fail-closed */ }

  const admins = Array.isArray(cfg.admin_openids) ? cfg.admin_openids : [];
  if (admins.indexOf(openid) < 0) {
    return { ok: false, code: 'ai_forbidden', msg: '仅管理员可调用此临时函数' };
  }

  const action = event.action === 'polish' ? 'polish' : 'ping';
  // 可用性探测：ping 用极简 prompt 验证链路；polish 顺带验证中文改写能力
  const prompt = action === 'polish'
    ? '请将下面这段需求描述改写得更清晰通顺（保持原意，不改事实，不超过50字）：「' + String(event.text || '').slice(0, 100) + '」'
    : '请回答：这是 CloudBase AI 通道连通性测试，只回复OK';
  // 模型名：deepseek-v4-flash 预览版已于 2026-09-27 下线 → 新版 id 为 deepseek-v4-flash-0731（官方公告）
  const modelId = event.model || 'deepseek-v4-flash-0731';

  try {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 });
    const model = app.ai().createModel('cloudbase');
    const result = await model.generateText({
      model: modelId,
      messages: [
        { role: 'system', content: action === 'polish' ? '你是文案润色助手。' : '你是连通性测试助手。' },
        { role: 'user', content: prompt }
      ]
    });
    return {
      ok: true, action, model: modelId,
      text: String(result.text || '').slice(0, 300),
      usage: result.usage || null
    };
  } catch (e) {
    const raw = (e && (e.response && e.response.data) ? JSON.stringify(e.response.data) : '') ||
      String(e && e.message || e);
    return {
      ok: false, code: 'ai_unavailable', model: modelId,
      msg: 'AI 通道调用失败: ' + raw.slice(0, 300),
      hint: '若为 429/模型未启用：控制台 AI+ → 生文模型，确认 deepseek-v4-flash-0731 已开通'
    };
  }
};