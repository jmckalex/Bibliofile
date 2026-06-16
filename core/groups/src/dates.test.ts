import { describe, it, expect } from 'vitest';
import {
  startOfPeriod,
  parseBibDeskDate,
  resolveDateWindow,
  dateInWindow,
  DateComparison,
  Period,
  type DateConditionParams,
} from './index.js';

function params(p: Partial<DateConditionParams>): DateConditionParams {
  return {
    comparison: DateComparison.Today,
    numberValue: 0,
    andNumberValue: 0,
    periodValue: Period.Day,
    dateValue: null,
    toDateValue: null,
    ...p,
  };
}

describe('startOfPeriod', () => {
  const base = new Date(2024, 2, 15, 13, 45, 30); // Fri 2024-03-15 13:45:30 local

  it('Day truncates to midnight', () => {
    const d = startOfPeriod(base, Period.Day);
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('Day with offset rolls the date over', () => {
    const yesterday = startOfPeriod(base, Period.Day, -1);
    expect(yesterday.getDate()).toBe(14);
    const tomorrow = startOfPeriod(base, Period.Day, 1);
    expect(tomorrow.getDate()).toBe(16);
  });

  it('Day offset crosses a month boundary', () => {
    const d = startOfPeriod(new Date(2024, 2, 1, 5, 0, 0), Period.Day, -1);
    expect(d.getMonth()).toBe(1); // Feb
    expect(d.getDate()).toBe(29); // 2024 is a leap year
  });

  it('Week truncates to the first weekday (Sunday default)', () => {
    // 2024-03-15 is a Friday; week start (Sun) = 2024-03-10
    const d = startOfPeriod(base, Period.Week);
    expect(d.getDate()).toBe(10);
    expect(d.getDay()).toBe(0); // Sunday
  });

  it('Week respects a Monday firstWeekday', () => {
    const d = startOfPeriod(base, Period.Week, 0, 0, 0, 0, 1);
    expect(d.getDate()).toBe(11); // Monday
    expect(d.getDay()).toBe(1);
  });

  it('Month truncates to the 1st', () => {
    const d = startOfPeriod(base, Period.Month);
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(2);
  });

  it('Year truncates to Jan 1', () => {
    const d = startOfPeriod(base, Period.Year);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });
});

describe('parseBibDeskDate', () => {
  it('parses standardDescription with explicit zone', () => {
    const d = parseBibDeskDate('2024-03-15 09:30:00 +0000');
    expect(d).not.toBeNull();
    expect(d!.getTime()).toBe(Date.parse('2024-03-15T09:30:00Z'));
  });

  it('parses zoneless standardDescription as local', () => {
    const d = parseBibDeskDate('2024-03-15 09:30:00');
    expect(d!.getFullYear()).toBe(2024);
    expect(d!.getHours()).toBe(9);
  });

  it('parses ISO-8601', () => {
    const d = parseBibDeskDate('2024-03-15T09:30:00Z');
    expect(d!.getTime()).toBe(Date.parse('2024-03-15T09:30:00Z'));
  });

  it('parses bare yyyy-MM-dd local', () => {
    const d = parseBibDeskDate('2020-01-02');
    expect(d!.getFullYear()).toBe(2020);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(2);
  });

  it('parses a bare 4-digit year', () => {
    const d = parseBibDeskDate('1999');
    expect(d!.getFullYear()).toBe(1999);
    expect(d!.getMonth()).toBe(0);
  });

  it('returns null for empty/garbage', () => {
    expect(parseBibDeskDate('')).toBeNull();
    expect(parseBibDeskDate('   ')).toBeNull();
    expect(parseBibDeskDate(undefined)).toBeNull();
    expect(parseBibDeskDate('not a date')).toBeNull();
  });
});

describe('resolveDateWindow + dateInWindow (relative windows, injected now)', () => {
  // Fix "now" to Fri 2024-03-15 12:00:00 local.
  const now = new Date(2024, 2, 15, 12, 0, 0);

  it('Today: [startOfDay, ∞)', () => {
    const w = resolveDateWindow(params({ comparison: DateComparison.Today }), { now });
    expect(w.start).toEqual(new Date(2024, 2, 15, 0, 0, 0));
    expect(w.end).toBeNull();
    // an item from this morning matches; yesterday does not
    expect(dateInWindow(new Date(2024, 2, 15, 8, 0, 0), w)).toBe(true);
    expect(dateInWindow(new Date(2024, 2, 14, 23, 59, 59), w)).toBe(false);
  });

  it('Yesterday: [yesterday, today)', () => {
    const w = resolveDateWindow(params({ comparison: DateComparison.Yesterday }), { now });
    expect(w.start).toEqual(new Date(2024, 2, 14, 0, 0, 0));
    expect(w.end).toEqual(new Date(2024, 2, 15, 0, 0, 0));
    expect(dateInWindow(new Date(2024, 2, 14, 10, 0, 0), w)).toBe(true);
    expect(dateInWindow(new Date(2024, 2, 15, 0, 0, 0), w)).toBe(false); // end exclusive
  });

  it('ThisWeek: [weekStart, ∞)', () => {
    const w = resolveDateWindow(params({ comparison: DateComparison.ThisWeek }), { now });
    expect(w.start).toEqual(new Date(2024, 2, 10, 0, 0, 0)); // Sunday
    expect(w.end).toBeNull();
  });

  it('InLast 7 days: rollover boundary', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.InLast, numberValue: 7, periodValue: Period.Day }),
      { now },
    );
    // start = startOfDay(now) + (1 - 7) days = 2024-03-09
    expect(w.start).toEqual(new Date(2024, 2, 9, 0, 0, 0));
    expect(w.end).toBeNull();
    // exactly 7 days ago at 00:00 is the boundary -> included
    expect(dateInWindow(new Date(2024, 2, 9, 0, 0, 0), w)).toBe(true);
    // just before the boundary -> excluded
    expect(dateInWindow(new Date(2024, 2, 8, 23, 59, 59), w)).toBe(false);
    // today -> included
    expect(dateInWindow(now, w)).toBe(true);
  });

  it('InLast 1 day == today', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.InLast, numberValue: 1, periodValue: Period.Day }),
      { now },
    );
    expect(w.start).toEqual(new Date(2024, 2, 15, 0, 0, 0));
  });

  it('NotInLast 7 days: (∞, end) with same end as InLast.start', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.NotInLast, numberValue: 7, periodValue: Period.Day }),
      { now },
    );
    expect(w.start).toBeNull();
    expect(w.end).toEqual(new Date(2024, 2, 9, 0, 0, 0));
    expect(dateInWindow(new Date(2024, 2, 1, 0, 0, 0), w)).toBe(true);
    expect(dateInWindow(new Date(2024, 2, 9, 0, 0, 0), w)).toBe(false);
  });

  it('Exactly 2 days ago: a single-day window', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.Exactly, numberValue: 2, periodValue: Period.Day }),
      { now },
    );
    expect(w.start).toEqual(new Date(2024, 2, 13, 0, 0, 0));
    expect(w.end).toEqual(new Date(2024, 2, 14, 0, 0, 0));
  });

  it('Between 2 and 5 days: spans the wider range', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.Between, numberValue: 5, andNumberValue: 2, periodValue: Period.Day }),
      { now },
    );
    // start = -max(5,2)=-5 -> 03-10 ; end = 1-min(5,2)=1-2=-1 -> 03-14
    expect(w.start).toEqual(new Date(2024, 2, 10, 0, 0, 0));
    expect(w.end).toEqual(new Date(2024, 2, 14, 0, 0, 0));
  });

  it('InLast with month period', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.InLast, numberValue: 1, periodValue: Period.Month }),
      { now },
    );
    expect(w.start).toEqual(new Date(2024, 2, 1, 0, 0, 0)); // start of this month
  });

  it('absolute Date: single-day window', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.Date, dateValue: new Date(2020, 5, 10, 14, 0, 0) }),
      { now },
    );
    expect(w.start).toEqual(new Date(2020, 5, 10, 0, 0, 0));
    expect(w.end).toEqual(new Date(2020, 5, 11, 0, 0, 0));
  });

  it('AfterDate: (dayAfter, ∞)', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.AfterDate, dateValue: new Date(2020, 5, 10) }),
      { now },
    );
    expect(w.start).toEqual(new Date(2020, 5, 11, 0, 0, 0));
    expect(w.end).toBeNull();
  });

  it('BeforeDate: (∞, day); missing item date PASSES the upper bound', () => {
    const w = resolveDateWindow(
      params({ comparison: DateComparison.BeforeDate, dateValue: new Date(2020, 5, 10) }),
      { now },
    );
    expect(w.start).toBeNull();
    expect(w.end).toEqual(new Date(2020, 5, 10, 0, 0, 0));
    expect(dateInWindow(null, w)).toBe(true); // BibDesk asymmetry
    expect(dateInWindow(new Date(2020, 5, 9), w)).toBe(true);
    expect(dateInWindow(new Date(2020, 5, 10), w)).toBe(false);
  });

  it('InDateRange: [from, dayAfter(to))', () => {
    const w = resolveDateWindow(
      params({
        comparison: DateComparison.InDateRange,
        dateValue: new Date(2020, 0, 1),
        toDateValue: new Date(2020, 0, 31),
      }),
      { now },
    );
    expect(w.start).toEqual(new Date(2020, 0, 1, 0, 0, 0));
    expect(w.end).toEqual(new Date(2020, 1, 1, 0, 0, 0));
  });

  it('ThisSession uses the injected session start', () => {
    const sessionStart = new Date(2024, 2, 15, 9, 0, 0);
    const w = resolveDateWindow(params({ comparison: DateComparison.ThisSession }), { now, sessionStart });
    expect(w.start).toBe(sessionStart);
    expect(w.end).toBeNull();
  });
});

describe('dateInWindow asymmetry (missing item date)', () => {
  it('missing date fails a lower bound but passes an upper bound', () => {
    expect(dateInWindow(null, { start: new Date(2020, 0, 1), end: null })).toBe(false);
    expect(dateInWindow(null, { start: null, end: new Date(2020, 0, 1) })).toBe(true);
    expect(dateInWindow(null, { start: null, end: null })).toBe(true);
  });
});
