export type Choice = { label: string; value: string };

export type ResumeSummary = {
  filename: string;
  contentType: string;
  bytes: number;
  uploadedAt: string;
};

export type ParticipantSettings = {
  id: number;
  discordId: string;
  discordUsername: string;
  discordNickname: string;
  name: string;
  preferredEmail: string;
  westernEmail: string;
  year: string;
  program: string;
  opportunities: string[];
  priorWta: boolean;
  experience: string;
  topics: string[];
  blurb: string;
  interests: string;
  priorFeedback: string;
  linkedinUrl: string;
  otherUrl: string;
  resume: ResumeSummary | null;
  emailOk: boolean;
  status: string;
};

export type DashboardData = {
  viewer: { participantId: number; organizer: boolean };
  programWeek: ProgramWeek | null;
  participant: ParticipantSettings;
  progress: { interviewer: number; interviewee: number; strikes: number };
  sessions: Array<{
    id: number;
    round: number;
    role: 'interviewer' | 'interviewee';
    partnerName: string | null;
    scheduledAt: string | null;
    state: string;
    reportState: 'not_released' | 'waiting_both' | 'waiting_you' | 'waiting_partner' | 'complete';
  }>;
  owedReports: Array<{ id: number; kind: string; deadlineAt: string; url: string }>;
  minimumBlurbWords: number;
  options: {
    years: string[];
    programs: string[];
    experience: string[];
    opportunities: Choice[];
    topics: Choice[];
  };
};

export type ProgramWeek = {
  index: number;
  startsOn: string;
  endsOn: string;
  title: string;
  technicalRound: number | null;
};

export type PracticeProblemsData = {
  cohort: { name: string } | null;
  currentRound: number | null;
  rounds: Array<{ round: number; programWeeks: number[]; startsOn: string | null; endsOn: string | null }>;
  problems: Array<{
    id: number;
    round: number;
    number: number | null;
    title: string;
    url: string;
    difficulty: string;
    content: string;
  }>;
};

export type SettingsPayload = Omit<ParticipantSettings, 'id' | 'status' | 'discordId' | 'discordUsername' | 'discordNickname' | 'resume'>;

export class SettingsSaveError extends Error {
  constructor(message: string, readonly fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'SettingsSaveError';
  }
}

export async function getDashboard(): Promise<DashboardData> {
  if (import.meta.env.DEV && demoEnabled()) {
    return (await import('./demo')).demoDashboard;
  }
  const response = await fetch('/api/dashboard', { headers: { Accept: 'application/json' } });
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Your session expired. Redirecting to login…');
  }
  if (!response.ok) throw new Error('Could not load your dashboard.');
  return response.json();
}

export async function getPracticeProblems(): Promise<PracticeProblemsData> {
  if (import.meta.env.DEV && demoEnabled()) {
    return {
      cohort: { name: 'Summer 2026' },
      currentRound: 1,
      rounds: [
        { round: 1, programWeeks: [2, 3], startsOn: '2026-07-26', endsOn: '2026-08-08' },
        { round: 2, programWeeks: [4, 5], startsOn: '2026-08-09', endsOn: '2026-08-22' },
        { round: 3, programWeeks: [6, 7], startsOn: '2026-08-23', endsOn: '2026-09-05' },
      ],
      problems: [
        { id: 1, round: 1, number: 739, title: 'Daily Temperatures', url: 'https://leetcode.com/problems/daily-temperatures/', difficulty: 'medium', content: '## Problem\n\nFor each day, find how many days pass before a warmer temperature appears.\n\n## Approach\n\nUse a decreasing stack of unresolved day indices.' },
        { id: 2, round: 1, number: 11, title: 'Container With Most Water', url: 'https://leetcode.com/problems/container-with-most-water/description/', difficulty: 'medium', content: '## Problem\n\nChoose two vertical lines that hold the most water.\n\n## Approach\n\nStart with two pointers at the ends and move the shorter wall inward.' },
        { id: 3, round: 1, number: 3070, title: 'Count Submatrices with Top-Left Element and Sum Less Than or Equal to K', url: 'https://leetcode.com/problems/count-submatrices-with-top-left-element-and-sum-less-than-k/description', difficulty: 'easy', content: '## Problem\n\nCount top-left anchored submatrices whose sum is at most the limit.\n\n## Approach\n\nBuild a two-dimensional prefix sum.' },
        { id: 4, round: 2, number: 875, title: 'Koko Eating Bananas', url: 'https://leetcode.com/problems/koko-eating-bananas/', difficulty: 'medium', content: '## Problem\n\nFind the smallest eating speed that finishes every pile before the deadline.\n\n## Approach\n\nBinary-search the answer.' },
      ],
    };
  }
  const response = await fetch('/api/practice', { headers: { Accept: 'application/json' } });
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Your session expired. Redirecting to login…');
  }
  if (!response.ok) throw new Error('Could not load practice problems.');
  return response.json();
}

export async function saveSettings(payload: SettingsPayload): Promise<void> {
  if (import.meta.env.DEV && demoEnabled()) {
    const fieldErrors: Record<string, string> = {};
    if (payload.opportunities.length === 0) fieldErrors.opportunities = 'Choose at least one opportunity type.';
    if (payload.topics.length === 0) fieldErrors.topics = 'Choose at least one topic.';
    const blurbWords = payload.blurb.trim().split(/\s+/).filter(Boolean).length;
    if (blurbWords < 50) fieldErrors.blurb = `Dream company and role response must be at least 50 words (currently ${blurbWords}).`;
    if (Object.keys(fieldErrors).length) throw new SettingsSaveError('Check the highlighted profile fields.', fieldErrors);
    return;
  }
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => ({}))) as { message?: string; fieldErrors?: Record<string, string> };
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Your session expired. Redirecting to login…');
  }
  if (!response.ok) throw new SettingsSaveError(result.message ?? 'Could not save your settings.', result.fieldErrors);
}

export async function uploadResume(path: string, file: File): Promise<ResumeSummary> {
  const response = await fetch(`/api${path}`, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': file.type || 'application/octet-stream',
      'X-WTA-Filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  const result = await response.json().catch(() => ({})) as { message?: string; resume?: ResumeSummary };
  if (response.status === 401 && path.startsWith('/settings')) {
    window.location.assign('/login');
    throw new Error('Your session expired. Redirecting to login…');
  }
  if (!response.ok || !result.resume) throw new SettingsSaveError(result.message ?? 'Could not upload your resume.');
  return result.resume;
}

export async function removeResume(path: string): Promise<void> {
  const response = await fetch(`/api${path}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (response.status === 401 && path.startsWith('/settings')) {
    window.location.assign('/login');
    throw new Error('Your session expired. Redirecting to login…');
  }
  if (!response.ok) throw new SettingsSaveError(result.message ?? 'Could not remove your resume.');
}

export async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const result = await response.json().catch(() => ({})) as { message?: string; fieldErrors?: Record<string, string>; error?: string };
  if (!response.ok) throw new SettingsSaveError(result.message ?? result.error?.replaceAll('_', ' ') ?? 'The request failed.', result.fieldErrors);
  return result as T;
}

export async function logout(): Promise<void> {
  await fetch('/logout', { method: 'POST', headers: { Accept: 'application/json' } });
  window.location.assign('/login');
}

export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (import.meta.env.DEV && demoEnabled()) {
    const { adminDemoRequest } = await import('./demo-admin');
    return adminDemoRequest(path, init) as T;
  }
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Your session expired. Redirecting to login…');
  }
  const result = await response.json().catch(() => ({})) as { message?: string; error?: string };
  if (!response.ok) throw new Error(result.message ?? result.error?.replaceAll('_', ' ') ?? 'The admin request failed.');
  return result as T;
}

function demoEnabled() {
  if (!import.meta.env.DEV) return false;
  if (new URLSearchParams(window.location.search).has('demo')) {
    sessionStorage.setItem('wta:demo', '1');
    return true;
  }
  return sessionStorage.getItem('wta:demo') === '1';
}
