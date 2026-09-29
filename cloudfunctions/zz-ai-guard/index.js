// zz-ai-guard · AI 通道可用性验证（临时函数，2026-09-29，验证后删除）
// 职责：在云函数内通过 @cloudbase/node-sdk 调 CloudBase AI 文本生成，验证链路可用
// 守卫：仅 admin_openids 白名单可调用；无 mock 身份；失败 fail-closed 返回 ai_unavailable
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return { ok: false, code: 'ai_no_openid', msg: '未获取到登录身份' };

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

  try {
    const tcb = require('@cloudbase/node-sdk');
    const app = tcb.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 });
    const model = app.ai().createModel('cloudbase');
    const result = await model.generateText({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: action === 'polish' ? '你是文案润色助手。' : '你是连通性测试助手。' },
        { role: 'user', content: prompt }
      ]
    });
    return {
      ok: true, action,
      text: String(result.text || '').slice(0, 300),
      usage: result.usage || null
    };
  } catch (e) {
    return {
      ok: false, code: 'ai_unavailable',
      msg: 'AI 通道调用失败: ' + String(e && e.message || e).slice(0, 200),
      hint: '确认控制台已开通 AI+ 并启用生文模型(deepseek-v4-flash)'
    };
  }
};