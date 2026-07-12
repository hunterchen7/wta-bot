import type { Cohort } from './engine/weeks';

export type ProgramWeek = {
  index: number;
  startsOn: string;
  endsOn: string;
  title: string;
  technicalRound: number | null;
};

const WEEK_TITLES = [
  'Word-of-mouth marketing',
  'Preparing for applicants',
  'Intro call + Technical Round 1',
  'Resume lesson + roast sessions',
  'Technical Round 2',
  'Behavioral lesson',
  'Technical Round 3',
  'Review footage + draft list',
  'Referrals + alumni coordination',
] as const;

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days, 12));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

export function programTimeline(roundOneStartsOn: string): ProgramWeek[] {
  const programStartsOn = addDays(roundOneStartsOn, -14);
  return WEEK_TITLES.map((title, index) => ({
    index,
    startsOn: addDays(programStartsOn, index * 7),
    endsOn: addDays(programStartsOn, index * 7 + 6),
    title,
    technicalRound: index >= 2 && index <= 7 ? Math.floor((index - 2) / 2) + 1 : null,
  }));
}

export function currentProgramPhase(cohort: Pick<Cohort, 'start_date'>, now = new Date()): ProgramWeek | null {
  const today = torontoDate(now);
  const timeline = programTimeline(cohort.start_date);
  return timeline.find((week) => today >= week.startsOn && today <= week.endsOn)
    ?? (today < timeline[0]!.startsOn ? timeline[0]! : null);
}

function torontoDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
