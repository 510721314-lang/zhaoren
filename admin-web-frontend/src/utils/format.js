// utils/format.js · 前端通用格式化 (fen 整数分 / 毫秒时间戳)

export function fenToYuan(fen) {
  if (fen === null || fen === undefined) return '-';
  const v = Number(fen) / 100;
  return v.toFixed(2);
}

export function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function minsToHHmm(mins) {
  if (!mins) return '-';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}

export function roleTag(roles) {
  if (!roles || !roles.length) return '普通用户';
  const map = { user: '用户', partner: '耍伴', admin: '管理员' };
  return roles.map((r) => map[r] || r).join('/');
}

export function statusTag(status) {
  const map = {
    normal: { text: '正常', type: 'success' },
    frozen: { text: '冻结', type: 'warning' },
    banned: { text: '封禁', type: 'danger' },
    deleted: { text: '已删', type: 'info' }
  };
  return map[status] || { text: status || '-', type: 'info' };
}

// 14 态中文标签
export const STATUS_MAP = {
  S0: '待支付', S1: '待确认', S2: '履约中', S3: '已确认', S3_5: '履约完成',
  S4: '部分完成', S5: '已完成', S6: '已取消', S7: '已退款', S8: '已结算',
  S9: '已评价', S10: '已关闭'
};

export function statusLabel(s) {
  return STATUS_MAP[String(s).replace('.', '_')] || s || '-';
}

export function txTypeLabel(t) {
  const m = { pay: '支付', refund: '退款', tip: '小费', fee: '平台费', tip_refund: '小费退回' };
  return m[t] || t;
}

export function wdTypeLabel(t) {
  const m = { fast: '极速提现', normal: '普通提现' };
  return m[t] || t;
}

export function wdStatusLabel(s) {
  const m = { pending: '待处理', processing: '处理中', success: '成功', failed: '失败', rejected: '驳回' };
  return m[s] || s || '-';
}

// 判断 processing 挂起超 24h (返回 true 表示异常)
export function isWithdrawStuck(w) {
  if (!w || w.status !== 'processing' || !w.created_at) return false;
  return Date.now() - Number(w.created_at) > 24 * 3600 * 1000;
}
