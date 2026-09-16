import { describe, expect, it } from 'vitest';
import { formatClock, formatDateTime } from './datetime';

describe('datetime 东八区格式化', () => {
  it('converts UTC ISO to Asia/Shanghai date-time', () => {
    // UTC 2026-09-16 03:53:25 = 东八区 2026-09-16 11:53:25
    expect(formatDateTime('2026-09-16T03:53:25.123Z')).toBe('2026-09-16 11:53:25');
  });

  it('handles date rollover across midnight', () => {
    // UTC 2026-09-15 17:30:00 = 东八区 2026-09-16 01:30:00
    expect(formatDateTime('2026-09-15T17:30:00.000Z')).toBe('2026-09-16 01:30:00');
  });

  it('formats clock-only in Asia/Shanghai', () => {
    expect(formatClock('2026-09-16T03:53:25.123Z')).toBe('11:53:25');
    expect(formatClock(new Date('2026-09-16T03:53:25.123Z'))).toBe('11:53:25');
  });

  it('returns the raw value for invalid input', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});
