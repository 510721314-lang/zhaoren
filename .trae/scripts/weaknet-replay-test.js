// 弱网重放测试脚本 (运行时, 需云凭证) —— 模板
// 原理: 弱网最危险 = 请求发出但响应丢失 -> 重试同一请求. 此处用 @cloudbase/node-sdk 直连云环境,
//       对"发布/接单"云函数以同一 client_request_id(固定)连续重放 N 次, 最后查库断言实际只落 1 条.
// 前置(必须先完成, 否则无法运行):
//   1) 本目录下初始化 Node 工程并安装依赖:
//        cd .trae/scripts && npm init -y && npm i @cloudbase/node-sdk
//   2) 提供云密钥与 mock 身份(env 必须 dev 以放行 mock_openid, 见 admin_config.env 语义):
//        $env:TCB_SECRETID , $env:TCB_SECRETKEY , $env:TCB_ENV , $env:OPENID_MOCK
//      (密钥在腾讯云控制台 访问密钥 获取; 切勿提交到 git)
//   3) 运行: $env:TCB_ENV="cloud1-xxx"; node weaknet-replay-test.js
// 注意: 本机无云密钥时无法验证; 未装依赖也不可跑. 仅作为填好前置后的运行用例.
const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({
  secretId: process.env.TCB_SECRETID,
  secretKey: process.env.TCB_SECRETKEY,
  env: process.env.TCB_ENV,
});
const db = app.database();

const OPENID_MOCK = process.env.OPENID_MOCK || 'test_weaknet_openid';
const N = 3; // 重放次数(等同弱网失败重试次数)

async function callFn(name, data) {
  const r = await app.callFunction({ name, data });
  return r && r.result;
}
// 构造一个最小发布 payload(需按项目 publish 参数补齐)
function publishPayload(clientRequestId) {
  return {
    action: 'publish',
    client_request_id: clientRequestId,
    scene: 'W1', title: '弱网重放测试需求', remark: '弱网重放测试需求｜备注',
    rate_fen: 3000, duration_h: 1,
    service_date: Date.now(), // 只用于测试, 真实以项目字段为准
    location: { city: '成都' },
  };
}

async function main() {
  const crid = 'weakenet_replay_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);

  // ---- 发布重放: 同一 client_request_id 发 N 次 ----
  console.log(`[发布] 重放 ${N} 次, client_request_id=${crid}`);
  let publishRes = [];
  for (let i = 0; i < N; i++) {
    try { publishRes.push(await callFn('demand-publish', publishPayload(crid))); }
    catch (e) { console.log(`  第${i + 1}次失败: ${e.message}`); }
  }
  const demandCount = await db.collection('demand')
    .where({ client_request_id: crid, is_deleted: false }).count().then((x) => x.total);
  const pubOk = (demandCount === 1);
  console.log(`  demand 实际条数 = ${demandCount}  (期望 1) => ${pubOk ? 'PASS' : 'FAIL'}`);

  // ---- 接单重放: 对同一需求用 mock 身份重放 take N 次(依赖已发布的 demand) ----
  const demand = await db.collection('demand')
    .where({ client_request_id: crid }).limit(1).get().then((r) => r.data && r.data[0]);
  let takeRes = [];
  if (demand) {
    for (let i = 0; i < N; i++) {
      try {
        takeRes.push(await callFn('order-create', {
          action: 'take', demand_id: demand._id,
          partner_openid: OPENID_MOCK, partner_location: { latitude: 30.57, longitude: 104.06 },
        }));
      } catch (e) { console.log(`  接单第${i + 1}次失败: ${e.message}`); }
    }
    const orderCount = await db.collection('order_main')
      .where({ demand_id: demand._id }).count().then((x) => x.total);
    const takeOk = (orderCount === 1);
    console.log(`  order_main 实际条数 = ${orderCount}  (期望 1) => ${takeOk ? 'PASS' : 'FAIL'}`);
  } else {
    console.log('  跳过接单重放: 未找到测试需求');
  }

  const pass = publishRes.every((r) => r && r.ok) ? true : false;
  console.log('=================');
  console.log(pass ? '结论: 发布重放未造成脏数据(但请以 demand 条数为准)' : '结论: 存在失败, 查看上方返回');
  process.exit(pubOk ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });