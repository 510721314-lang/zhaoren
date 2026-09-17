// 一次性脚本: 按昵称查 openid
// 运行: cd cloudfunctions/_shared; node lookup-oids.js
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d9gkefwcp5c777088' });
const db = cloud.database();
const _ = db.command;

async function main() {
  const targets = ['耍伴测试20260912-1', '测试20260912-1'];
  for (const nick of targets) {
    const r = await db.collection('user_account')
      .where({ nickname: nick, is_deleted: _.neq(true) })
      .limit(5).get();
    if (r.data && r.data.length) {
      for (const u of r.data) {
        console.log(`${nick} → openid=${u.openid}  roles=${JSON.stringify(u.roles)}  status=${u.status}`);
      }
    } else {
      console.log(`${nick} → 未找到`);
      // 宽松搜
      const loose = await db.collection('user_account')
        .where({ nickname: db.RegExp({ regexp: nick.slice(0, 6), options: 'i' }) })
        .limit(10).get();
      if (loose.data && loose.data.length) {
        console.log(`  宽松匹配:`);
        for (const u of loose.data) console.log(`    ${u.nickname} → ${u.openid}`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
