// Program-calendar time helpers. The program runs on America/Toronto wall
// time; storage is always UTC ISO strings. DST is handled via Intl (the
// Workers runtime ships full ICU).

const ZONE = 'America/Toronto';

/** Offset (ms) of the zone at a given UTC instant, e.g. EDT -> -4h. */
function zoneOffsetMs(utc: Date): number {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(utc).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utc.getTime();
}

/** Build a UTC Date from Toronto wall-clock components. */
export function torontoToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour = 0,
  minute = 0,
): Date {
  // First guess: pretend the wall time is UTC, then correct by the zone offset
  // at that instant (iterate once more to survive DST boundaries).
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMs(guess);
    guess = new Date(Date.UTC(year, month - 1, day, hour, minute) - offset);
  }
  return guess;
}

/** Parse "YYYY-MM-DD HH:mm" (Toronto wall time) -> UTC Date, or null. */
export function parseTorontoLocal(input: string): Date | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})\s*$/.exec(input);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = torontoToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi));
  if (Number.isNaN(date.getTime())) return null;
  // Reject nonsense like month 13 (Date would roll it over)
  const check = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  if (check !== `${y}-${mo}-${d}`) return null;
  return date;
}

/** Format a UTC instant as Toronto wall time for humans. */
export function formatToronto(utc: Date | string): string {
  const d = typeof utc === 'string' ? new Date(utc) : utc;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/** Calendar date containing an instant in Toronto, formatted for storage/select values. */
export function torontoDateKey(utc: Date | string): string {
  const d = typeof utc === 'string' ? new Date(utc) : utc;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export const iso = (d: Date) => d.toISOString();

/** Discord's native timestamp markup — renders in each viewer's local zone. */
export const discordTime = (d: Date | string, style: 'f' | 'R' = 'f') =>
  `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;
