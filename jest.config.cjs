// jest.config.cjs — Jest 主配置
//
// 从 scripts/load-env.cjs 读取 devtools 本地配置（由 .env 驱动）。
// 仅包含 Jest 标准字段，自定义字段请通过 require('../scripts/load-env.cjs') 获取。

const { ROOT } = require('./scripts/load-env.cjs');

module.exports = {
  rootDir: ROOT,
  testEnvironment: 'node',
  // 默认不匹配任何文件（本项目原有 node:test 体系已覆盖单测）；
  // e2e / 自动化用例将各自用 --config 指定独立配置文件。
  // 用永远不匹配的正则禁用默认 testMatch，避免 Jest 30 扫到非测试 js 文件。
  testRegex: 'a^',
};
