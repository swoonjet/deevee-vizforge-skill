// scripts/shapers/calendar-heatmap.mjs
//
// BIND-01/02/04 (Phase 7 Plan 11) -- the calendar-heatmap technique's shaper.
// ONE shaper drives BOTH scaffolds/calendar-heatmap.html and
// scaffolds/calendar-heatmap-animated.html (they read the identical
// BOUND_DATA shape, mirroring bump.mjs's own "one shaper, two scaffolds"
// precedent, 07-08).
//
// Contract (scripts/shapers/README.md): shape(rows, bindings) is pure --
// identical rows+bindings in, identical output out. validate(rows, bindings,
// {contract, profile}) runs AFTER the generic validateBinding() in
// scripts/bind-data.mjs already passed (required-ness, bound-column
// existence, declared type -- this project's calendar-heatmap.json declares
// the `date` role temporal-only, so a nominal bind is already rejected there;
// this file's own validate() re-asserts it belt-and-suspenders, mirrors
// line.mjs/horizon.mjs's own style) plus a minimum-2-distinct-day floor the
// generic validator can't express.
//
// `value` is OPTIONAL (defaultAggregation 'count'): when unbound, every row
// simply counts toward its own day -- the demo (USGS quakes, one row per
// event) never binds `value` at all, matching the technique's "date/value
// per-day aggregation, defaults to per-day count" contract.
//
// The dense per-day `data` array this shaper returns spans the FULL
// calendar-year range derived from the bound dates themselves (a
// single-year bound dataset folds to Jan 1 - Dec 31 of that year; a
// multi-year one spans Jan 1 of its earliest year through Dec 31 of its
// latest) -- never a hardcoded year. Every day in that range is present
// (value 0 where no row landed), so the scaffold never re-derives the
// calendar span itself: it only needs `stats.startDow` (the range's own
// starting weekday) to fold the dense array into a week/weekday grid purely
// by array position -- a fully general rule for ANY bound date range.

function isFiniteNumber(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '') return false;
  return Number.isFinite(Number(v));
}

function parseDateMs(raw) {
  if (raw === undefined || raw === null) return NaN;
  const v = String(raw).trim();
  if (v === '') return NaN;
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function dayKeyOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 86400000;

/**
 * shape(rows, bindings) -> {data:[{date,value,n}], stats:{dayCount,rowCount,
 * totalValue,maxValue,busiestDate,busiestValue,busiestDays,top5WeeksShare,
 * startDow}}
 *
 * `bindings.aggregation.value` selects sum|mean|count (default 'count',
 * mirroring this technique's dataBinding.roles[value].defaultAggregation --
 * a bound `value` column is still only COUNTED per day unless the caller
 * explicitly chooses sum/mean).
 */
export function shape(rows, bindings) {
  const dateCol = bindings.date;
  const valueCol = bindings.value;
  const aggName = (bindings.aggregation && bindings.aggregation.value) || 'count';

  const perDay = new Map(); // dayKey -> array of (numeric value | null)
  let usableRowCount = 0;

  for (const row of rows || []) {
    if (!row) continue;
    const ms = parseDateMs(row[dateCol]);
    if (!Number.isFinite(ms)) continue;
    usableRowCount++;
    const key = dayKeyOf(ms);
    if (!perDay.has(key)) perDay.set(key, []);
    if (valueCol && isFiniteNumber(row[valueCol])) {
      perDay.get(key).push(Number(row[valueCol]));
    } else {
      perDay.get(key).push(null);
    }
  }

  function aggregateDay(entries) {
    if (aggName === 'sum') {
      const nums = entries.filter((v) => v !== null);
      return nums.reduce((a, b) => a + b, 0);
    }
    if (aggName === 'mean') {
      const nums = entries.filter((v) => v !== null);
      return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    }
    return entries.length; // 'count' (default) -- counts rows per day regardless of value
  }

  const dayKeysWithData = [...perDay.keys()];
  const years = new Set(dayKeysWithData.map((k) => Number(k.slice(0, 4))));
  const minYear = years.size > 0 ? Math.min(...years) : new Date().getUTCFullYear();
  const maxYear = years.size > 0 ? Math.max(...years) : minYear;
  const rangeStart = Date.UTC(minYear, 0, 1);
  const rangeEnd = Date.UTC(maxYear + 1, 0, 1); // exclusive

  const data = [];
  for (let ms = rangeStart; ms < rangeEnd; ms += DAY_MS) {
    const key = dayKeyOf(ms);
    const entries = perDay.get(key) || [];
    data.push({ date: key, value: aggregateDay(entries), n: entries.length });
  }

  const maxValue = data.length > 0 ? Math.max(...data.map((d) => d.value)) : 0;
  const totalValue = data.reduce((s, d) => s + d.value, 0);

  // Sunday-start week bucketing, driven purely by array position (the
  // range's own starting weekday) -- never a calendar-library call -- a
  // fully general rule for any dense day range this shaper produces.
  const startDow = new Date(rangeStart).getUTCDay(); // 0=Sun
  const byWeek = new Map();
  data.forEach((d, i) => {
    const w = Math.floor((i + startDow) / 7);
    byWeek.set(w, (byWeek.get(w) || 0) + d.value);
  });
  const weekValues = [...byWeek.values()].sort((a, b) => b - a);
  const top5WeeksShare = totalValue > 0 ? weekValues.slice(0, 5).reduce((s, v) => s + v, 0) / totalValue : null;

  const busiestDays = data
    .slice()
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((d) => ({ date: d.date, value: d.value }));

  const stats = {
    dayCount: data.length,
    rowCount: usableRowCount,
    totalValue,
    maxValue,
    busiestDate: busiestDays[0] ? busiestDays[0].date : null,
    busiestValue: busiestDays[0] ? busiestDays[0].value : null,
    busiestDays,
    top5WeeksShare,
    startDow,
  };

  return { data, stats };
}

/**
 * validate(rows, bindings, {contract, profile}) -> Array<{channel,problem,remedy}>
 *
 * - the bound date column's profiled type is not temporal -> a named
 *   {channel:'date'} error (belt-and-suspenders: the generic validateBinding()
 *   already rejects this via dataBinding.roles[date].types, since this
 *   project's calendar-heatmap.json only accepts temporal for the date role).
 * - fewer than 2 distinct bound days -> a calendar heatmap needs at least 2
 *   days to fold into a grid.
 */
export function validate(rows, bindings, { contract, profile } = {}) {
  const errors = [];
  const dateCol = bindings.date;

  const field = profile && Array.isArray(profile.fields) ? profile.fields.find((f) => f.name === dateCol) : undefined;
  if (field && field.type !== 'temporal') {
    errors.push({
      channel: 'date',
      problem: `channel 'date': column '${dateCol}' is ${field.type} -- calendar-heatmap needs a temporal date column`,
      remedy: `bind 'date' to a temporal column`,
    });
  }

  const distinctDays = new Set(
    (rows || [])
      .map((r) => (r ? parseDateMs(r[dateCol]) : NaN))
      .filter((ms) => Number.isFinite(ms))
      .map((ms) => dayKeyOf(ms))
  );

  if (distinctDays.size < 2) {
    errors.push({
      channel: 'date',
      problem: `channel 'date': only ${distinctDays.size} distinct day(s) found in '${dateCol}' -- a calendar heatmap needs at least 2 days`,
      remedy: `bind 'date' to a column spanning at least 2 distinct days`,
    });
  }

  return errors;
}
