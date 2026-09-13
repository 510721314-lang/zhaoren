// 临时通道：通过 IDE 服务端口 WS 协议调用云函数（等价云端测试面板，mock_openid 身份）
// 用法: run.js <functionName> <jsonEventFile> [timeoutMs]
const http = require('http');
const WebSocket = require('C:/Users/DC/Desktop/微信WEB开发者工具/resources/app.asar/node_modules/ws');
const fs = require('fs');
const crypto = require('crypto');

const IDE_PORT = 11841;
const ENV = 'cloud1-d9gkefwcp5c777088';
const PROJECT = 'c:\\Users\\DC\\Desktop\\zhaoren';
const APPID = 'wxbc4a4afacdf234f5';

const fnName = process.argv[2];
const eventFile = process.argv[3];
const timeoutMs = parseInt(process.argv[4] || '20000', 10);
const eventStr = eventFile && eventFile !== '-' ? fs.readFileSync(eventFile, 'utf8') : process.argv[5] || '{}';
const eventObj = JSON.parse(eventStr);

function upgradeOnce() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: IDE_PORT, path: '/upgrade', timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, body: body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('upgrade timeout')); });
  });
}

(async () => {
  const up = await upgradeOnce();
  if (up.status !== 200 || !up.body || !up.body.port) {
    console.log('UPGRADE_FAIL ' + JSON.stringify(up));
    process.exit(2);
  }
  const port = up.body.port;
  const projectId = '' + (up.body.projectId || '');
  const nonce = crypto.randomBytes(20).toString('hex');
  const proto = projectId + '_CLI_' + nonce;

  const ws = new WebSocket('ws://127.0.0.1:' + port, proto);
  let settled = false;
  const finish = (code, out) => { if (!settled) { settled = true; console.log(out); try { ws.close(); } catch (e) {} setTimeout(() => process.exit(code), 200); } };
  const timer = setTimeout(() => finish(3, 'NO_RESPONSE_TIMEOUT'), timeoutMs);

  ws.on('open', () => {
    const msg = {
      type: 'CLOUD_FUNCTIONS_CALL',
      env: ENV,
      name: fnName,
      data: process.argv[6] === 'obj' ? eventObj : eventStr,
      callback: { id: 0 },
      project: PROJECT,
      appid: APPID,
      extAppid: '',
      lang: 'zh',
      clientId: nonce,
      cwd: PROJECT
    };
    ws.send(JSON.stringify(msg));
  });
  ws.on('message', (raw) => {
    const txt = raw.toString();
    let parsed; try { parsed = JSON.parse(txt); } catch (e) { parsed = null; }
    if (parsed && parsed.type === 'HEARTBEAT') {
      ws.send(JSON.stringify({ type: 'CALLBACK', callback: parsed.callback }));
      return;
    }
    clearTimeout(timer);
    if (parsed && parsed.type === 'CALLBACK') {
      finish(0, 'CALLBACK ' + JSON.stringify(parsed.payload || parsed.error || parsed));
    } else {
      finish(0, 'MSG ' + txt);
    }
  });
  ws.on('error', (e) => { clearTimeout(timer); finish(4, 'WS_ERROR ' + e.message); });
  ws.on('close', (code, reason) => { clearTimeout(timer); if (!settled) finish(5, 'WS_CLOSED ' + code + ' ' + reason.toString()); });
})().catch((e) => { console.log('FATAL ' + (e && e.stack || e)); process.exit(1); });
