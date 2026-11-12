function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function wallTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const want = Date.UTC(year, month - 1, day, hour, minute, second || 0);
  let utc = want;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(utc), timeZone);
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const diff = want - got;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

function addCalendarDays(year, month, day, delta) {
  const next = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function weekdayIndex(date, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[name];
}

function startOfLocalDay(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return wallTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

function localHourRange(dateKey, hour, timeZone) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const start = wallTimeToUtc(year, month, day, hour, 0, 0, timeZone);
  const endHour = hour + 1;
  const end = endHour === 24
    ? wallTimeToUtc(addCalendarDays(year, month, day, 1).year, addCalendarDays(year, month, day, 1).month, addCalendarDays(year, month, day, 1).day, 0, 0, 0, timeZone)
    : wallTimeToUtc(year, month, day, endHour, 0, 0, timeZone);
  return { start, end };
}

function dateKeyFromDate(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

function periodRange(kind, timeZone, now = new Date()) {
  const parts = zonedParts(now, timeZone);
  if (kind === 'day' || kind === 'daily') {
    const start = wallTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
    const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
    const end = wallTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
    return { start, end };
  }
  if (kind === 'week' || kind === 'weekly') {
    const index = weekdayIndex(now, timeZone);
    const mondayOffset = index === 0 ? -6 : 1 - index;
    const monday = addCalendarDays(parts.year, parts.month, parts.day, mondayOffset);
    const start = wallTimeToUtc(monday.year, monday.month, monday.day, 0, 0, 0, timeZone);
    const next = addCalendarDays(monday.year, monday.month, monday.day, 7);
    const end = wallTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
    return { start, end };
  }
  const start = wallTimeToUtc(parts.year, parts.month, 1, 0, 0, 0, timeZone);
  const nextMonth = parts.month === 12
    ? { year: parts.year + 1, month: 1, day: 1 }
    : { year: parts.year, month: parts.month + 1, day: 1 };
  const end = wallTimeToUtc(nextMonth.year, nextMonth.month, 1, 0, 0, 0, timeZone);
  return { start, end };
}

function combineLocal(dateStr, timeStr, timeZone) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const [hour, minute] = String(timeStr || '09:00').split(':').map(Number);
  return wallTimeToUtc(year, month, day, hour || 0, minute || 0, 0, timeZone);
}

function dayBounds(dateKey, timeZone) {
  const start = combineLocal(dateKey, '00:00', timeZone);
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const next = addCalendarDays(year, month, day, 1);
  const end = wallTimeToUtc(next.year, next.month, next.day, 0, 0, 0, timeZone);
  return { start, end };
}

function dateKeyOf(value, timeZone) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return dateKeyFromDate(parsed, timeZone);
}

function viewRange(query = {}, timeZone) {
  const fromKey = dateKeyOf(query.startDate || query.dateFrom || query.from, timeZone);
  const toKey = dateKeyOf(query.endDate || query.dateTo || query.to, timeZone);
  if (fromKey || toKey) {
    const startKey = fromKey || toKey;
    const endKey = toKey || fromKey;
    const from = startKey <= endKey ? startKey : endKey;
    const to = startKey <= endKey ? endKey : startKey;
    const today = dateKeyFromDate(new Date(), timeZone);
    const label = from === to ? (from === today ? 'Today' : from) : `${from} to ${to}`;
    return { ...{ start: dayBounds(from, timeZone).start, end: dayBounds(to, timeZone).end }, preset: 'range', label, from, to };
  }
  const preset = query.preset || (query.date ? 'date' : 'today');
  if (preset === 'week') {
    const range = periodRange('week', timeZone);
    return { ...range, preset, label: 'This week', from: dateKeyFromDate(range.start, timeZone), to: dateKeyFromDate(new Date(range.end.getTime() - 1), timeZone) };
  }
  if (preset === 'month') {
    const range = periodRange('month', timeZone);
    return { ...range, preset, label: 'This month', from: dateKeyFromDate(range.start, timeZone), to: dateKeyFromDate(new Date(range.end.getTime() - 1), timeZone) };
  }
  if (preset === 'yesterday') {
    const parts = zonedParts(new Date(), timeZone);
    const previous = addCalendarDays(parts.year, parts.month, parts.day, -1);
    const date = `${previous.year}-${String(previous.month).padStart(2, '0')}-${String(previous.day).padStart(2, '0')}`;
    return { ...dayBounds(date, timeZone), preset, label: 'Yesterday', from: date, to: date };
  }
  const date = query.date || dateKeyFromDate(new Date(), timeZone);
  const chosen = Boolean(query.date);
  return { ...dayBounds(date, timeZone), preset: chosen ? 'date' : 'today', label: chosen ? date : 'Today', from: date, to: date };
}

function remainingDays(endDate, now = new Date()) {
  if (!endDate) return null;
  const ms = new Date(endDate).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86400000));
}

module.exports = {
  zonedParts,
  wallTimeToUtc,
  addCalendarDays,
  startOfLocalDay,
  localHourRange,
  dateKeyFromDate,
  dateKeyOf,
  dayBounds,
  periodRange,
  viewRange,
  combineLocal,
  remainingDays,
  weekdayIndex,
};
