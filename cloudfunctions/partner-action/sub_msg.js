// _shared/sub_msg.js — 订阅消息统一发送封装 + 授权/发送计数状态（方案A 2026-11-02）
// 微信一次性订阅：一次授权 = 一条额度；服务端无法查询微信侧剩余额度，
// 故只记录「累计授权条数 granted_count」与「累计成功发送条数 sent_count」，不对外承诺剩余值。
// 状态挂在 partner_profile.sub_msgs.<key>：
//   { authorized, granted_count, sent_count, last_authorized_at, last_sent_at, quota_empty_at, updated_at }
// 兼容存量：无计数字段时按 granted_count=1 / sent_count=0 处理；authorized=false 时按 0 处理。

const MAX_GRANT = 5;   // 单键累计授权上限（防异常客户端无限累加）

// 归一化：把存量布尔模型与计数模型统一成 { granted, sent, canSend }
function stateOf(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  let granted = Number.isFinite(Number(s.granted_count))
    ? Number(s.granted_count)
    : (s.authorized === true ? 1 : 0);
  let sent = Number.isFinite(Number(s.sent_count)) ? Number(s.sent_count) : 0;
  if (sent > granted) granted = sent;                 // 脏数据自愈：已发条数不超过授权条数
  return { granted, sent, canSend: s.authorized === true && granted > sent };
}

// 授权：累计 granted_count（客户端上报本次实际 accept 次数 1/2），保留已发送计数
function authorizePatch(raw, count, now) {
  const st = stateOf(raw);
  const add = Math.max(0, Math.min(MAX_GRANT, Number(count) || 1));
  const granted = Math.min(MAX_GRANT, st.granted + add);
  return Object.assign({}, raw, {
    authorized: granted > st.sent,
    granted_count: granted,
    sent_count: st.sent,
    last_authorized_at: now,
    updated_at: now
  });
}

// 关闭授权：清零计数（用户主动关开关）
function revokePatch(raw, now) {
  return Object.assign({}, raw, {
    authorized: false,
    granted_count: 0,
    sent_count: 0,
    updated_at: now
  });
}

// 发送成功：消费 1 条；用尽则 authorized=false
function sentPatch(raw, now) {
  const st = stateOf(raw);
  const sent = st.sent + 1;
  const granted = Math.max(st.granted, sent);
  return Object.assign({}, raw, {
    authorized: granted > sent,
    granted_count: granted,
    sent_count: sent,
    last_sent_at: now,
    updated_at: now
  });
}

// 额度用尽（43101）：把 sent_count 抬到 granted_count 并关闭授权
function exhaustedPatch(raw, now) {
  const st = stateOf(raw);
  const granted = Math.max(st.granted, st.sent);
  return Object.assign({}, raw, {
    authorized: false,
    granted_count: granted,
    sent_count: granted,
    quota_empty_at: now,
    updated_at: now
  });
}

// 把某个 key 的 patch 合并回 sub_msgs（不破坏其他模板）
function withKey(subMsgs, key, patch) {
  return Object.assign({}, subMsgs || {}, { [key]: patch });
}

// 统一发送入口：cloud.openapi.subscribeMessage.send 的唯一允许调用点。
// sender 可选（order-timer 的 HTTPS 直连通道传 (a)=>httpsPusher.send(a)）；默认走云调用。
// 永不抛出：返回 { sent, errCode, errMsg }，由调用方决定降级与状态落库。
async function sendOnce(cloud, args, sender) {
  try {
    if (sender) await sender(args);
    else await cloud.openapi.subscribeMessage.send(args);
    return { sent: true, errCode: '', errMsg: '' };
  } catch (e) {
    return {
      sent: false,
      errCode: (e && e.errCode !== undefined) ? e.errCode : '',
      errMsg: String((e && (e.errMsg || e.message)) || '')
    };
  }
}

module.exports = { stateOf, authorizePatch, revokePatch, sentPatch, exhaustedPatch, withKey, sendOnce, MAX_GRANT };
