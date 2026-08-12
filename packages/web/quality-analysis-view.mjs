function metricNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}

export function qualityMetricSummary(metric = {}) {
  const baseline = metricNumber(metric.baseline_value);
  const searched = metricNumber(metric.search_best_known);
  const best = metricNumber(metric.best_known);
  const improvement = metricNumber(metric.improved_by) || 0;
  const percentage = baseline > 0 ? (improvement / baseline * 100).toFixed(1) : '0.0';
  const status = metric.status || 'UNKNOWN';
  if (metric.proven) {
    return `数学下界 ${metricNumber(metric.lower_bound) ?? best ?? '未知'}；当前课表 ${baseline ?? '未知'}；改善 ${improvement}（${percentage}%）；已证明数学最优（${status}）`;
  }
  if (metric.best_source === 'current_schedule' && searched !== null && baseline !== null) {
    return `最好已知 ${best}；当前课表 ${baseline}；本次搜索 ${searched}，预算内没有改善；尚未证明数学最优（${status}）`;
  }
  const searchNote = searched === null
    ? '本次搜索未找到候选'
    : `本次搜索 ${searched}${improvement > 0 ? `，改善 ${improvement}（${percentage}%）` : ''}`;
  return `最好已知 ${best ?? '未得到'}；当前课表 ${baseline ?? '未知'}；${searchNote}；尚未证明数学最优（${status}）`;
}
