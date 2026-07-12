import { describe, expect, it } from 'vitest';
import { currentProgramPhase, programTimeline } from '../src/program-calendar';

describe('program calendar', () => {
  it('maps the sheet schedule around three two-week technical rounds', () => {
    const weeks = programTimeline('2026-07-26');
    expect(weeks).toHaveLength(9);
    expect(weeks[0]).toMatchObject({ index: 0, startsOn: '2026-07-12', endsOn: '2026-07-18', technicalRound: null });
    expect(weeks[2]).toMatchObject({ startsOn: '2026-07-26', technicalRound: 1 });
    expect(weeks[3]).toMatchObject({ endsOn: '2026-08-08', technicalRound: 1 });
    expect(weeks[6]).toMatchObject({ startsOn: '2026-08-23', technicalRound: 3 });
    expect(weeks[8]).toMatchObject({ startsOn: '2026-09-06', endsOn: '2026-09-12', technicalRound: null });
  });

  it('recognizes week zero in Toronto', () => {
    expect(currentProgramPhase({ start_date: '2026-07-26' }, new Date('2026-07-12T16:00:00Z')))
      .toMatchObject({ index: 0, title: 'Word-of-mouth marketing' });
  });
});
