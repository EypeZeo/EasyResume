export function monthIndex(value: string): number | null {
  if (!/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(value || '')) return null;
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
}

/** Mirrors the backend month-union display; saved qualification is always computed there. */
export function experienceSummary(records: any[], asOf: string) {
  const spans: [number, number][] = [];
  const excluded: { id: string; reason: string }[] = [];
  const asOfIndex = monthIndex(asOf);
  let uncertain = !records.length;
  for (const record of records) {
    if (record.employment_type === 'internship' || record.employment_type === 'part_time') continue;
    const start = monthIndex(record.start_date);
    const end = record.current ? asOfIndex : monthIndex(record.end_date);
    const reason = !record.confirmed
      ? '经历尚未检查'
      : record.employment_type === 'unknown'
        ? '工作类型尚未确认'
        : start === null || end === null || asOfIndex === null
          ? '日期需精确到月份'
          : end < start || start > asOfIndex || end > asOfIndex
            ? '日期冲突或包含未来时间'
            : record.current && record.end_date
              ? '在职状态与结束日期冲突'
              : '';
    if (reason) {
      uncertain = true;
      excluded.push({ id: record.id, reason });
    } else spans.push([start!, end!]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  const known_months = merged.reduce((total, [start, end]) => total + end - start, 0);
  return {
    months: uncertain ? null : known_months,
    known_months,
    omitted: excluded.length,
    excluded,
  };
}
