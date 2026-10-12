// scripts/rotate-admin-key.js · 生成新的 admin_web_key 并给出轮换操作指引(批4.3)
// 用法: node scripts/rotate-admin-key.js [reason]
// 行为: 本地生成 AWK-<64hex> 格式新密钥(与 admin-action config_set 校验正则一致),
//       打印可直接粘贴到「云端测试 / admin-action config_set」的入参; 不触碰数据库。
// 注意: 轮换后所有持旧 key 的会话立即失效 → 需重新登录; 账号密码登录链路不受影响。
const crypto = require('crypto');

function genAdminWebKey() {
  return 'AWK-' + crypto.randomBytes(32).toString('hex'); // 32B = 64 hex
}

function main() {
  const reason = (process.argv[2] || '').trim().slice(0, 100) || '密钥定期轮换';
  const key = genAdminWebKey();
  if (!/^AWK-[a-f0-9]{64}$/.test(key)) {
    console.error('生成失败: 格式不符 AWK-+64hex');
    process.exit(1);
  }
  console.log('=== admin_web_key 轮换 ===');
  console.log('新密钥(请妥善保存, 仅出现一次):');
  console.log('  ' + key);
  console.log('');
  console.log('轮换方式一(推荐: admin-action 云端测试面板入参):');
  console.log(JSON.stringify({ action: 'config_set', admin_web_key: key, reason }, null, 2));
  console.log('');
  console.log('轮换方式二(已登录后台的代理调用, 需携有效会话或旧 key):');
  console.log('  POST /api  body = ' + JSON.stringify({ action: 'config_set', admin_web_key: key, reason }));
  console.log('');
  console.log('⚠️  轮换后: 持旧 key 的请求将返 bad_key(401); 请通知所有运营重新登录。');
  console.log('    账号密码登录(admin_login 发 12h 会话令牌)不受静态 key 轮换影响, 推荐改用。');
}

if (require.main === module) main();
module.exports = { genAdminWebKey };
