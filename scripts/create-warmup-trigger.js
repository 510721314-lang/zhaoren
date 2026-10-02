/**
 * create-warmup-trigger.js
 * 用 miniprogram-ci 官方 CI 通道创建 zz-warmup 的微信云开发定时触发器
 * 用法: node scripts/create-warmup-trigger.js
 * 密钥: KEY/private.wxbc4a4afacdf234f5.key (微信公众平台-开发-开发设置-小程序代码上传)
 */
const ci = require('miniprogram-ci');

const APPID = 'wxbc4a4afacdf234f5';
const KEY_PATH = require('path').join(__dirname, '..', 'KEY', 'private.wxbc4a4afacdf234f5.key');
const PROJECT_PATH = require('path').join(__dirname, '..');
const ENV_ID = 'cloud1-d9gkefwcp5c777088';
const FN_NAME = 'zz-warmup';
const TRIGGER_NAME = 'warmupTimer';
const CRON = '0 */5 7-22 * * * *';

async function main() {
  const project = new ci.Project({
    appid: APPID,
    type: 'miniProgram',
    projectPath: PROJECT_PATH,
    privateKeyPath: KEY_PATH,
    ignores: ['node_modules/**/*', '.git/**/*', 'KEY/**/*'],
  });

  console.log('[1/3] 创建定时触发器...', { envId: ENV_ID, functionName: FN_NAME, trigger: TRIGGER_NAME, cron: CRON });

  const result = await ci.cloud.createTimeTrigger({
    project,
    envId: ENV_ID,
    functionName: FN_NAME,
    triggersConfig: [
      {
        name: TRIGGER_NAME,
        type: 'timer',
        config: CRON,
      },
    ],
  });

  console.log('[2/3] 返回结果:', JSON.stringify(result, null, 2));

  if (result && result.errCode === 0) {
    console.log('[3/3] ✅ 触发器创建成功');
  } else {
    console.log('[3/3] ⚠️ 需人工判断: 见上方返回');
  }
}

main().catch((e) => {
  console.error('创建失败:', e && e.message ? e.message : e);
  process.exit(1);
});
