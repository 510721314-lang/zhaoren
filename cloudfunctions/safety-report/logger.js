// 环境门控日志: prod 静默(业务错误已写 platform_event), dev 打印。
// env 缓存与 openid.js 共享; openid 未预热(冷实例首调)时按非 prod 放行一次。
// 部署注意: CloudBase 按函数目录独立打包, 需复制到各云函数目录, require('./logger')。
const { getCachedEnv } = require('./openid');

module.exports = {
  d(...args) {
    if (getCachedEnv() !== 'prod') console.log(...args);
  },
  // 警告/错误始终输出(基础设施级故障排查用, 不含正常业务流水)
  w(...args) { console.warn(...args); },
  e(...args) { console.error(...args); }
};
