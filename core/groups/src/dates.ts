/**
 * Date parsing + relative-date-window resolution for Date conditions.
 *
 * Ports:
 *   - `NSDate startOfPeriod:byAdding:atHour:minute:second:`
 *     (NSDate_BDSKExtensions.m:296-362) — start-of-period truncation + offset.
 *   - `BDSKCondition getStartDate:endDate:` (BDSKCondition.m:636-693) — maps a
 *     {@link DateComparison} to a half-open `[startDate, endDate)` window.
 *
 * BibDesk uses the system calendar in local time. We replicate that with local
 * `Date` arithmetic. The week's first day follows the calendar's `firstWeekday`
 * (BibDesk reads it from `[calendar firstWeekday]`); we default to Sunday (the
 * Gregorian/US default, `firstWeekday == 1`) and allow an override.
 */
import { DateComparison, Period } from './comparison.js';

/** Options controlling relative-date resolution (injected for determinism). */
export interface DateWindowOptions {
  /** "Now" used to compute relative windows. Defaults to `new Date()`. */
  now?: Date;
  /**
   * First day of the week, 0=Sunday..6=Saturday. Defaults to 0 (Sunday),
   * matching the Gregorian calendar's `firstWeekday == 1` (1-based Sunday).
   */
  firstWeekday?: number;
  /** Document open date — used by the `ThisSession` comparison. */
  sessionStart?: Date;
}

/** A half-open date window `[start, end)`; `null` end is "open / no bound". */
export interface DateWindow {
  start: Date | null;
  end: Date | null;
}

/**
 * Port of `-[NSDate startOfPeriod:byAdding:atHour:minute:second:]`.
 *
 * Truncates `base` to the start of the given period (in local time), then adds
 * `offset` whole periods. `atHour/minute/second` set the time-of-day of the
 * truncated instant (default 00:00:00).
 *
 * Period truncation:
 *   - Day   → that calendar day.
 *   - Week  → back to `firstWeekday` of the containing week.
 *   - Month → first day of the month.
 *   - Year  → Jan 1 of the year.
 */
export function startOfPeriod(
  base: Date,
  period: Period,
  offset = 0,
  hour = 0,
  minute = 0,
  second = 0,
  firstWeekday = 0,
): Date {
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();

  let result: Date;
  switch (period) {
    case Period.Day:
      result = new Date(y, m, d, hour, minute, second, 0);
      break;
    case Period.Week: {
      const dow = base.getDay(); // 0=Sun..6=Sat
      // days since the week's first day (BibDesk: setWeekday:firstWeekday)
      const back = (dow - firstWeekday + 7) % 7;
      result = new Date(y, m, d - back, hour, minute, second, 0);
      break;
    }
    case Period.Month:
      result = new Date(y, m, 1, hour, minute, second, 0);
      break;
    case Period.Year:
      result = new Date(y, 0, 1, hour, minute, second, 0);
      break;
    default:
      result = new Date(y, m, d, hour, minute, second, 0);
      break;
  }

  if (offset !== 0) {
    switch (period) {
      case Period.Day:
        result = new Date(
          result.getFullYear(),
          result.getMonth(),
          result.getDate() + offset,
          hour,
          minute,
          second,
          0,
        );
        break;
      case Period.Week:
        result = new Date(
          result.getFullYear(),
          result.getMonth(),
          result.getDate() + offset * 7,
          hour,
          minute,
          second,
          0,
        );
        break;
      case Period.Month:
        result = new Date(
          result.getFullYear(),
          result.getMonth() + offset,
          result.getDate(),
          hour,
          minute,
          second,
          0,
        );
        break;
      case Period.Year:
        result = new Date(
          result.getFullYear() + offset,
          result.getMonth(),
          result.getDate(),
          hour,
          minute,
          second,
          0,
        );
        break;
      default:
        break;
    }
  }

  return result;
}

/**
 * Parse a BibDesk date-field value into a `Date`, or `null` if unparseable.
 *
 * BibDesk persists Date-Added/Date-Modified via `-[NSDate standardDescription]`
 * = `yyyy-MM-dd HH:mm:ss ZZZ` (e.g. `2024-03-15 09:30:00 +0000`). The model also
 * stores these as ISO-8601 strings. We accept both, plus a bare `yyyy-MM-dd` and
 * a bare 4-digit year (freeform Year fields), and finally fall back to the JS
 * `Date` parser. Bare date/year forms are interpreted in *local* time so they
 * align with the local-time relative windows.
 */
export function parseBibDeskDate(value: string | undefined | null): Date | null {
  if (value == null) return null;
  const s = value.trim();
  if (s === '') return null;

  // standardDescription: yyyy-MM-dd HH:mm:ss ZZZ
  const std = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-]\d{2}:?\d{2}|Z)?$/.exec(
    s,
  );
  if (std) {
    const [, yy, mm, dd, hh, mi, ss, tz] = std;
    if (tz) {
      // Has an explicit zone — let JS parse it (normalize to ISO).
      const iso = `${yy}-${mm}-${dd}T${hh}:${mi}:${ss}${tz === 'Z' ? 'Z' : tz}`;
      const t = Date.parse(iso);
      if (!Number.isNaN(t)) return new Date(t);
    }
    return new Date(
      Number(yy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss),
      0,
    );
  }

  // bare yyyy-MM-dd (local)
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 0, 0, 0, 0);
  }

  // bare 4-digit year (freeform Year field) → Jan 1 local
  const yr = /^(\d{4})$/.exec(s);
  if (yr) {
    return new Date(Number(yr[1]), 0, 1, 0, 0, 0, 0);
  }

  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Parameters extracted from a Date condition's serialized value. */
export interface DateConditionParams {
  comparison: DateComparison;
  /** N for Exactly/InLast/NotInLast/Between (first number). */
  numberValue: number;
  /** Second N for Between. */
  andNumberValue: number;
  /** Unit for relative windows. */
  periodValue: Period;
  /** Absolute date for Date/AfterDate/BeforeDate/InDateRange (from). */
  dateValue: Date | null;
  /** Absolute "to" date for InDateRange. */
  toDateValue: Date | null;
}

/**
 * Port of `-[BDSKCondition getStartDate:endDate:]` (BDSKCondition.m:636-693).
 * Resolves a Date condition to a half-open window `[start, end)`. A `null`
 * bound means "unbounded on that side".
 */
export function resolveDateWindow(
  params: DateConditionParams,
  opts: DateWindowOptions = {},
): DateWindow {
  const now = opts.now ?? new Date();
  const fw = opts.firstWeekday ?? 0;
  const {
    comparison,
    numberValue,
    andNumberValue,
    periodValue,
    dateValue,
    toDateValue,
  } = params;

  const sop = (period: Period, offset = 0): Date =>
    startOfPeriod(now, period, offset, 0, 0, 0, fw);
  const sopDate = (base: Date, offset = 0): Date =>
    startOfPeriod(base, Period.Day, offset, 0, 0, 0, fw);

  switch (comparison) {
    case DateComparison.Today:
      return { start: sop(Period.Day), end: null };
    case DateComparison.Yesterday:
      return { start: sop(Period.Day, -1), end: sop(Period.Day) };
    case DateComparison.ThisWeek:
      return { start: sop(Period.Week), end: null };
    case DateComparison.LastWeek:
      return { start: sop(Period.Week, -1), end: sop(Period.Week) };
    case DateComparison.Exactly:
      return {
        start: sop(periodValue, -numberValue),
        end: sop(periodValue, 1 - numberValue),
      };
    case DateComparison.InLast:
      return { start: sop(periodValue, 1 - numberValue), end: null };
    case DateComparison.NotInLast:
      return { start: null, end: sop(periodValue, 1 - numberValue) };
    case DateComparison.Between: {
      const hi = Math.max(numberValue, andNumberValue);
      const lo = Math.min(numberValue, andNumberValue);
      return {
        start: sop(periodValue, -hi),
        end: sop(periodValue, 1 - lo),
      };
    }
    case DateComparison.Date:
      return dateValue
        ? { start: sopDate(dateValue), end: sopDate(dateValue, 1) }
        : { start: null, end: null };
    case DateComparison.AfterDate:
      return dateValue ? { start: sopDate(dateValue, 1), end: null } : { start: null, end: null };
    case DateComparison.BeforeDate:
      return dateValue ? { start: null, end: sopDate(dateValue) } : { start: null, end: null };
    case DateComparison.InDateRange:
      return {
        start: dateValue ? sopDate(dateValue) : null,
        end: toDateValue ? sopDate(toDateValue, 1) : null,
      };
    case DateComparison.ThisSession:
      return { start: opts.sessionStart ?? null, end: null };
    default:
      return { start: null, end: null };
  }
}

/**
 * Membership test against a resolved window, matching the date branch of
 * `-[BDSKCondition isSatisfiedByItem:]` (BDSKCondition.m:241-242):
 *
 *   (start == nil || (date && date >= start)) &&
 *   (end   == nil || (date == nil || date < end))
 *
 * Note the asymmetry BibDesk encodes: a missing item date fails a lower bound
 * but *passes* an upper bound. So e.g. "before X" matches items with no date.
 */
export function dateInWindow(date: Date | null, window: DateWindow): boolean {
  const lowerOk =
    window.start === null || (date !== null && date.getTime() >= window.start.getTime());
  const upperOk =
    window.end === null || date === null || date.getTime() < window.end.getTime();
  return lowerOk && upperOk;
}
