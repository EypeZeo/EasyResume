import { describe, expect, it } from 'vitest';
import { experienceSummary, monthIndex } from './resumeMath';

const work = (patch = {}) => ({
  id: 'work',
  confirmed: true,
  employment_type: 'full_time',
  start_date: '2020-01',
  end_date: '2021-01',
  current: false,
  ...patch,
});
describe('experience display matches qualification month rules', () => {
  it('unions overlapping employment and counts complete month differences', () => {
    expect(
      experienceSummary(
        [work(), work({ id: 'second', start_date: '2020-07', end_date: '2022-01' })],
        '2026-10',
      ).months,
    ).toBe(24);
  });
  it('does not infer months from year-only or invalid month text', () => {
    expect(monthIndex('2024')).toBeNull();
    expect(monthIndex('2024-99')).toBeNull();
    const result = experienceSummary(
      [work(), work({ id: 'partial', start_date: '2022', end_date: '2024-01' })],
      '2026-10',
    );
    expect(result.months).toBeNull();
    expect(result.known_months).toBe(12);
    expect(result.omitted).toBe(1);
  });
  it('does not silently count unchecked, unknown, future or conflicting work', () => {
    for (const patch of [
      { confirmed: false },
      { employment_type: 'unknown' },
      { end_date: '2027-01' },
      { current: true },
      { start_date: '2022-01' },
    ]) {
      expect(experienceSummary([work(patch)], '2026-10').months).toBeNull();
    }
  });
  it('keeps internship and part-time outside formal work totals', () => {
    expect(
      experienceSummary(
        [
          work(),
          work({ employment_type: 'internship', end_date: '2025-01' }),
          work({ employment_type: 'part_time' }),
        ],
        '2026-10',
      ).months,
    ).toBe(12);
    expect(experienceSummary([], '2026-10').months).toBeNull();
  });
  it('freezes current employment at the selected cutoff', () => {
    expect(experienceSummary([work({ current: true, end_date: '' })], '2021-06').months).toBe(17);
    expect(experienceSummary([work()], '').months).toBeNull();
  });
});
