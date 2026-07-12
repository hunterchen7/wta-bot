export type Choice = { label: string; value: string };

export type ParticipantSettings = {
  id: number;
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

export type SettingsPayload = Omit<ParticipantSettings, 'id' | 'status'>;

export async function getDashboard(): Promise<DashboardData> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
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
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) return;
  const response = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = (await response.json().catch(() => ({}))) as { message?: string };
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('Your session expired. Redirecting to login…');
  }
  if (!response.ok) throw new Error(result.message ?? 'Could not save your settings.');
}
