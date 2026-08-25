function scheduledPeriods(data) {
  return (data?.rows || []).reduce((total, row) => total + [1, 2, 3, 4, 5]
    .filter(day => Boolean(row?.[day])).length, 0);
}

/** Stable, human-facing metadata for one overview card. */
export function overviewCardSummary({ item = {}, data = null, viewType = 'class' } = {}) {
  const periods = scheduledPeriods(data);
  const maximum = Number(item.max_per_week);
  return {
    title: String(item.name || '未命名课表'),
    scheduled_periods: periods,
    capacity_text: viewType === 'teacher' && Number.isInteger(maximum) && maximum >= 0
      ? `已排 ${periods} 节 · 周上限 ${maximum} 节`
      : `已排 ${periods} 节`,
  };
}
