import type { DashboardData } from './api';

export const demoDashboard: DashboardData = {
  viewer: { participantId: 1, organizer: true },
  programWeek: { index: 4, startsOn: '2026-08-09', endsOn: '2026-08-15', title: 'Technical Round 2', technicalRound: 2 },
  participant: {
    id: 1,
    discordId: '100001',
    discordUsername: 'alexchen',
    discordNickname: 'Alex Chen',
    name: 'Alex Chen',
    preferredEmail: 'alex@example.com',
    westernEmail: 'achen@uwo.ca',
    year: 'Fourth',
    program: 'Computer Science',
    opportunities: ['internships', 'new_grad'],
    priorWta: true,
    experience: '3-4',
    topics: ['dsa', 'system_design', 'networking'],
    blurb: 'I want to work on developer infrastructure at a company where product quality and technical depth reinforce each other. '.repeat(8),
    interests: 'System design, technical leadership, and communicating tradeoffs clearly.',
    priorFeedback: 'More time for mock interviews and actionable partner feedback.',
    emailOk: true,
    status: 'active',
  },
  progress: { interviewer: 2, interviewee: 1, strikes: 0 },
  sessions: [
    { id: 1, round: 1, role: 'interviewer', partnerName: 'Jordan Lee', scheduledAt: '2026-07-30T23:30:00.000Z', state: 'completed', reportState: 'complete' as const },
    { id: 2, round: 1, role: 'interviewee', partnerName: 'Maya Singh', scheduledAt: '2026-08-02T18:00:00.000Z', state: 'scheduled', reportState: 'waiting_you' as const },
    { id: 3, round: 2, role: 'interviewer', partnerName: 'Sam Wilson', scheduledAt: '2026-08-13T22:30:00.000Z', state: 'scheduled', reportState: 'waiting_partner' as const },
    { id: 4, round: 2, role: 'interviewee', partnerName: 'Taylor Kim', scheduledAt: null, state: 'pending_schedule', reportState: 'not_released' as const },
  ],
  owedReports: [
    { id: 8, kind: 'interviewee_report', deadlineAt: '2026-08-08T03:59:00.000Z', url: '#' },
  ],
  minimumBlurbWords: 100,
  options: {
    years: ['First', 'Second', 'Third', 'Fourth', 'Fifth or greater'],
    programs: ['Computer Science', 'Software Engineering', 'Data Science', 'Other'],
    experience: ['0', '1-2', '3-4', '5+'],
    opportunities: [
      { label: 'Internships', value: 'internships' },
      { label: 'New Grad', value: 'new_grad' },
    ],
    topics: [
      { label: 'Building a strong technical resume', value: 'resume' },
      { label: 'Data Structures & Algorithms interviews', value: 'dsa' },
      { label: 'System design interviews', value: 'system_design' },
      { label: 'Finding and applying to internships', value: 'applying' },
      { label: 'Practicing problem-solving effectively', value: 'practice' },
      { label: 'Networking with industry', value: 'networking' },
    ],
  },
};
