// scripts/rehearse-key-rotation.js · idcard/phone AES 密钥轮换演练(dry-run, 批4.3)
// 用法: node scripts/rehearse-key-rotation.js
// 行为: 生成候选新密钥; 经 tcb-exec 统计需重加密的记录数(只读, 不改库); 输出停机窗口内的迁移步骤。
// 安全: idcard/phone 密文用旧密钥解密后才能用新密钥重加密 → 必须「先全量回填, 再原子切 key」, 期间停写。
//       本脚本只 dry-run 统计与出方案, 不写入任何数据。真实轮换需在维护窗口按输出步骤人工执行。
const crypto = require('crypto');
const { execTcbCommands } = require('./tcb-exec');

function genKey() { return crypto.randomBytes(32).toString('hex'); } // 64 hex

// 统计某集合里含某密文字段的文档数(只读)
async function countEncrypted(coll, field) {
  const r = execTcbCommands([{
    TableName: coll,
    CommandType: 'QUERY',
    Command: JSON.stringify({ find: { [field]: _.exists(true) }, limit: 1 }),
  }]);
  // tcb nosql execute 对聚合支持有限, 这里退化为「取一条确认存在」; 精确计数交由控制台/迁移脚本。
  if (r.parsed && r.parsed[0] && Array.isArray(r.parsed[0].documents)) {
    return { ok: true, hasData: r.parsed[0].documents.length > 0, sample: r.parsed[0].documents.length };
  }
  return { ok: false, err: (r.stderr || '').slice(0, 200) || 'tcb 不可用(鉴权/地域), 请在 IDE 控制台执行统计' };
}
// 占位 _ (脚本内不真正走 DB 命令的 _ 语义, 仅构造 find)
const _ = { exists: (v) => ({ $exists: v }) };

async function main() {
  const newIdKey = genKey();
  const newPhoneKey = genKey();
  console.log('=== idcard/phone AES 密钥轮换演练 (DRY-RUN, 不写库) ===');
  console.log('候选新 idcard_aes_key:', newIdKey);
  console.log('候选新 phone_aes_key :', newPhoneKey);
  console.log('');

  const probes = [
    ['user_account', 'idcard_enc'],
    ['user_account', 'phone_enc'],
    ['demand', 'phone_enc'],
  ];
  console.log('--- 密文记录探测(只读, 确认哪些集合有需重加密数据) ---');
  for (const [coll, field] of probes) {
    const r = await countEncrypted(coll, field);
    console.log(`  ${coll}.${field}: ${r.ok ? (r.hasData ? '存在密文记录' : '无') : '探测失败(' + r.err + ')'}`);
  }

  console.log('');
  console.log('--- 真实轮换步骤(需停机窗口, 按序执行) ---');
  console.log('  1. 公告维护, 停写: 关闭下单/实名/改资料入口(switch_* 置 false)。');
  console.log('  2. 读旧 key(admin_config.idcard_aes_key / phone_aes_key), 全量遍历上述集合:');
  console.log('     旧 key 解密 → 新 key 重加密 → 回写 *_enc/*_hash(phone_hash 必须用新 key 重算!)。');
  console.log('  3. 校验: 抽验解密成功、phone_hash 去重查询仍命中。');
  console.log('  4. 原子切换: 单事务更新 admin_config 的两个 *_aes_key 为新 key。');
  console.log('  5. 恢复写入口; 观察 24h 无解密失败告警再废弃旧 key。');
  console.log('');
  console.log('⚠️  phone_hash 是确定性查询键, 换 key 后旧 hash 全部失效 → 必须同步重算, 否则按号查不到/重复判断错乱。');
  console.log('⚠️  演练脚本不改库; 真实迁移请另写带事务的离线脚本并先在测试环境验证。');
}

if (require.main === module) main();
module.exports = { genKey };
