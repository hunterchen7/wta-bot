export type Choice = { label: string; value: string };

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
  emailOk: boolean;
  status: string;
};

export type DashboardData = {
  viewer: { participantId: number; organizer: boolean };
  participant: ParticipantSettings;
  progress: { interviewer: number; interviewee: number; strikes: number };
  sessions: Array<{
    id: number;
    round: number;
    role: 'interviewer' | 'interviewee';
    partnerName: string | null;
    scheduledAt: string | null;
    state: string;
  }>;
  owedReports: Array<{ id: number; kind: string; deadlineAt: string; url: string }>;
  options: {
    years: string[];
    programs: string[];
    experience: string[];
    opportunities: Choice[];
    topics: Choice[];
  };
};

export type SettingsPayload = Omit<ParticipantSettings, 'id' | 'status' | 'discordId' | 'discordUsername' | 'discordNickname'>;

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

export async function saveSettings(payload: SettingsPayload): Promise<void> {
  if (import.meta.env.DEV && demoEnabled()) {
    const fieldErrors: Record<string, string> = {};
    if (payload.opportunities.length === 0) fieldErrors.opportunities = 'Choose at least one opportunity type.';
    if (payload.topics.length === 0) fieldErrors.topics = 'Choose at least one topic.';
    const blurbWords = payload.blurb.trim().split(/\s+/).filter(Boolean).length;
    if (blurbWords < 100) fieldErrors.blurb = `Dream company and role response must be at least 100 words (currently ${blurbWords}).`;
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
