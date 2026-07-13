import { describe, expect, it } from 'vitest';
import { formatToronto, parseTorontoLocal, torontoDateKey, torontoToUtc } from '../src/time';

describe('Toronto time helpers', () => {
  it('converts summer (EDT, UTC-4) wall time to UTC', () => {
    const d = torontoToUtc(2026, 9, 15, 19, 30);
    expect(d.toISOString()).toBe('2026-09-15T23:30:00.000Z');
  });

  it('converts winter (EST, UTC-5) wall time to UTC', () => {
    const d = torontoToUtc(2026, 1, 15, 19, 30);
    expect(d.toISOString()).toBe('2026-01-16T00:30:00.000Z');
  });

  it('parses schedule strings and rejects garbage', () => {
    expect(parseTorontoLocal('2026-09-15 19:30')?.toISOString()).toBe(
      '2026-09-15T23:30:00.000Z',
    );
    expect(parseTorontoLocal('2026-09-15T9:05')?.toISOString()).toBe('2026-09-15T13:05:00.000Z');
    expect(parseTorontoLocal('not a date')).toBeNull();
    expect(parseTorontoLocal('2026-13-40 19:30')).toBeNull();
    expect(parseTorontoLocal('')).toBeNull();
  });

  it('round-trips through the human formatter', () => {
    const d = torontoToUtc(2026, 9, 15, 19, 30);
    const s = formatToronto(d);
    expect(s).toContain('7:30');
    expect(s).toContain('Sep');
  });

  it('derives the Toronto calendar date around UTC midnight', () => {
    expect(torontoDateKey('2026-07-13T01:00:00.000Z')).toBe('2026-07-12');
    expect(torontoDateKey('2026-07-13T05:00:00.000Z')).toBe('2026-07-13');
  });
});
