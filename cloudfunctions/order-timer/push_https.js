// order-timer/push_https.js · 批 6.1 订阅消息 HTTPS 通道(opt-in)
// 当 admin_config.sub_msg_https = { appid, secret } 已配置时, 用本模块走
//   cgi-bin/stable_token → access_token → subscribe/send 直连微信;
// 未配置时由调用方回退到 cloud.openapi.subscribeMessage.send(云调用), 保持现状。
// 设计为纯函数 + 注入式 postJson, 便于在无网络下单测, 不依赖 wx-server-sdk。
const https = require('https');

function defaultPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad_json: ' + buf.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 创建带 access_token 缓存的推送器; postJson 可注入以单测
function createHttpsPusher({ appid, secret, postJson = defaultPostJson }) {
  if (!appid || !secret) return null; // 未配置 → 调用方走云调用回退
  let cache = { token: '', expireAt: 0 };
  async function getAccessToken() {
    if (cache.token && cache.expireAt > Date.now() + 60000) return cache.token;
    const r = await postJson('https://api.weixin.qq.com/cgi-bin/stable_token', {
      grant_type: 'client_credential', appid, secret, force_refresh: false
    });
    if (!r || !r.access_token) throw new Error('stable_token fail: ' + JSON.stringify(r).slice(0, 80));
    cache = { token: r.access_token, expireAt: Date.now() + ((r.expires_in || 7200) * 1000) };
    return cache.token;
  }
  async function send({ touser, templateId, page, data, miniprogramState }) {
    const token = await getAccessToken();
    const body = { touser, template_id: templateId, page: page || 'pages-v2/demand-detail/demand-detail', data };
    if (miniprogramState) body.miniprogram_state = miniprogramState;
    const r = await postJson('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + token, body);
    if (!r || r.errcode !== 0) {
      const e = new Error((r && r.errmsg) || 'subscribe_send_fail');
      e.errCode = (r && r.errcode) || -1;
      throw e;
    }
    return { ok: true };
  }
  return { send, getAccessToken };
}

module.exports = { createHttpsPusher, defaultPostJson };
