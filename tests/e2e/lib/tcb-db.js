// tests/e2e/lib/tcb-db.js — e2e 测试用 tcb 直读 DB 封装
// 依赖 scripts/tcb-exec.js（JSON 走文件 + spawnSync 数组传参，规避 PS 引号坑）
// 用法: const { query, count } = require('./tcb-db');
const { execTcbCommands } = require('../../../scripts/tcb-exec');

/**
 * 查询集合
 * @param {string} collection 集合名
 * @param {object} filter MongoDB 查询条件
 * @param {object} opts { limit, sort }
 * @returns {Promise<{data: object[], total: number}>}
 */
function query(collection, filter = {}, opts = {}) {
  const limit = opts.limit || 10;
  const cmd = {
    find: collection,
    filter,
    limit,
  };
  if (opts.sort) cmd.sort = opts.sort;
  const r = execTcbCommands([{
    TableName: collection,
    CommandType: 'COMMAND',
    Command: JSON.stringify(cmd),
  }]);
  if (r.status !== 0) {
    throw new Error(`tcb query failed: ${r.stderr || r.stdout}`);
  }
  const data = (r.parsed && r.parsed[0] && r.parsed[0].data) || [];
  return { data, total: data.length };
}

/**
 * 统计集合数量
 * @param {string} collection
 * @param {object} filter
 * @returns {Promise<number>}
 */
function count(collection, filter = {}) {
  const r = execTcbCommands([{
    TableName: collection,
    CommandType: 'COMMAND',
    Command: JSON.stringify({ count: collection, query: filter }),
  }]);
  if (r.status !== 0) {
    throw new Error(`tcb count failed: ${r.stderr || r.stdout}`);
  }
  return (r.parsed && r.parsed[0] && r.parsed[0].total) || 0;
}

module.exports = { query, count };
