// diag-demand.js — 直接查 demand 集合诊断
const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d9gkefwcp5c777088' });
const db = cloud.database();
const _ = db.command;

(async () => {
  try {
    // 1. 查 demand 全部(不限制条件)
    const all = await db.collection('demand').orderBy('created_at', 'desc').limit(10).get();
    console.log('=== demand 全部 (前10) ===');
    console.log('count:', all.data.length);
    all.data.forEach((d, i) => {
      console.log(`[${i}] _id=${d._id.slice(0,12)}.. scene=${d.scene} status=${d.status} broadcast=${d.broadcast} mode=${d.match_mode} creator=${(d.creator_openid||'').slice(0,8)}.. expire=${d.expire_at ? new Date(d.expire_at).toISOString().slice(0,16) : 'null'} created=${d.created_at ? new Date(d.created_at).toISOString().slice(0,16) : 'null'}`);
    });

    // 2. 用 hallWhere 条件查
    const hall = await db.collection('demand').where({
      is_deleted: false,
      status: 'matching',
      broadcast: true,
      expire_at: _.gt(Date.now())
    }).orderBy('created_at', 'desc').limit(10).get().catch(e => ({ error: e.message, data: [] }));
    console.log('\n=== hallWhere 查询 ===');
    if (hall.error) console.log('ERROR:', hall.error);
    else console.log('count:', hall.data.length);
  } catch (e) {
    console.error('FATAL:', e.message);
  }
  process.exit(0);
})();
