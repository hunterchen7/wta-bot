import type { AdminSettingsData, AnalyticsData, OperationsData, OverviewData, ParticipantsData, ProblemsData, ReviewsData, RoundsData } from './admin-types';

const now = new Date('2026-08-13T14:00:00.000Z').toISOString();
const cohort = { id: 1, name: 'Summer 2026', start_date: '2026-07-26', weeks_count: 3, status: 'active' };
const weeks = [
  { id: 1, cohort_id: 1, idx: 1, optin_opens_at: '2026-07-26T20:00:00.000Z', optin_closes_at: '2026-07-30T22:00:00.000Z', match_at: '2026-07-30T22:15:00.000Z', reports_due_at: '2026-08-09T03:59:00.000Z', grace_until: null },
  { id: 2, cohort_id: 1, idx: 2, optin_opens_at: '2026-08-09T20:00:00.000Z', optin_closes_at: '2026-08-13T22:00:00.000Z', match_at: '2026-08-13T22:15:00.000Z', reports_due_at: '2026-08-23T03:59:00.000Z', grace_until: null },
  { id: 3, cohort_id: 1, idx: 3, optin_opens_at: '2026-08-23T20:00:00.000Z', optin_closes_at: '2026-08-27T22:00:00.000Z', match_at: '2026-08-27T22:15:00.000Z', reports_due_at: '2026-09-06T03:59:00.000Z', grace_until: '2026-09-10T03:59:00.000Z' },
];
const names = ['Alex Chen', 'Jordan Lee', 'Maya Singh', 'Sam Wilson', 'Taylor Kim', 'Priya Patel', 'Noah Martin', 'Amara Okafor', 'Leo Zhang', 'Sofia Rodriguez', 'Ethan Brown', 'Zoe Park'];
const participants = names.map((name, index) => ({
  id: index + 1, discord_id: `10000${index}`, discord_username: name.toLowerCase().replace(' ', ''), discord_nickname: index % 4 === 0 ? name.split(' ')[0] : name, name, preferred_email: `${name.toLowerCase().replace(' ', '.')}@example.com`, western_email: `student${index}@uwo.ca`,
  year: ['Second', 'Third', 'Fourth'][index % 3], program: index % 3 === 1 ? 'Software Engineering' : 'Computer Science',
  opportunities: index % 2 ? '["internships"]' : '["internships","new_grad"]', prior_wta: index % 3 === 0 ? 1 : 0, experience_band: ['0', '1-2', '3-4', '5+'][index % 4], topics: index % 2 ? '["dsa","networking"]' : '["system_design","applications"]',
  blurb: `Interested in ${index % 2 ? 'product engineering' : 'infrastructure'} roles and building stronger interview communication skills.`, interests: index % 2 ? 'System design and practical interview strategy.' : null, prior_feedback: index % 3 === 0 ? 'More detailed feedback after each round.' : null,
  status: index === 8 ? 'held' : index === 10 ? 'paused' : 'active', email_ok: index % 3 ? 1 : 0, pairing_excluded: index === 0 ? 1 : 0, removed_reason: null, created_at: '2026-07-12 12:00:00', updated_at: now,
  interviewer_credits: Math.min(3, index % 4), interviewee_credits: Math.min(3, (index + 1) % 4), strikes: index === 8 ? 2 : index === 5 ? 1 : 0,
  reports_owed: index === 2 || index === 7 ? 1 : 0, opted_in: index < 9 ? 1 : 0,
}));

const overview: OverviewData = {
  cohort, currentWeek: weeks[1]!, programWeek: { index: 4, startsOn: '2026-08-09', endsOn: '2026-08-15', title: 'Technical Round 2', technicalRound: 2 }, activeParticipants: 10, matchingReady: true,
  participantStatuses: [{ status: 'active', n: 10 }, { status: 'held', n: 1 }, { status: 'paused', n: 1 }],
  sessionStates: [{ state: 'completed', n: 7 }, { state: 'scheduled', n: 8 }, { state: 'pending_schedule', n: 3 }, { state: 'broken', n: 1 }],
  queues: { openForms: 4, incidents: 2, repairs: 1, reviews: 3, pendingOutbox: 6, failedOutbox: 1 },
  recentAudit: [
    { id: 3, actor_participant_id: 1, actor_name: 'Alex Chen', action: 'review.verify', target_type: 'session', target_id: '42', detail: null, created_at: now },
    { id: 2, actor_participant_id: 1, actor_name: 'Alex Chen', action: 'participants.status_changed', target_type: 'participant_batch', target_id: '9', detail: '{"status":"held"}', created_at: '2026-08-13T12:20:00.000Z' },
    { id: 1, actor_participant_id: 1, actor_name: 'Alex Chen', action: 'problem.updated', target_type: 'problem', target_id: '7', detail: null, created_at: '2026-08-12T20:00:00.000Z' },
  ],
};

const sessions = [
  { id: 41, round: 2, interviewer_name: 'Alex Chen', interviewee_name: 'Jordan Lee', state: 'completed', scheduled_at: '2026-08-10T23:00:00.000Z', origin: 'match', reports_in: 2, review_state: 'none', problem_title: 'Merge Intervals' },
  { id: 42, round: 2, interviewer_name: 'Maya Singh', interviewee_name: 'Sam Wilson', state: 'scheduled', scheduled_at: '2026-08-15T18:30:00.000Z', origin: 'match', reports_in: 0, review_state: 'none', problem_title: 'Valid Parentheses' },
  { id: 43, round: 2, interviewer_name: 'Taylor Kim', interviewee_name: 'Priya Patel', state: 'pending_schedule', scheduled_at: null, origin: 'match', reports_in: 0, review_state: 'none', problem_title: null },
  { id: 44, round: 2, interviewer_name: 'Noah Martin', interviewee_name: 'Amara Okafor', state: 'broken', scheduled_at: null, origin: 'match', reports_in: 0, review_state: 'none', problem_title: 'Number of Islands' },
  { id: 45, round: 2, interviewer_name: 'Leo Zhang', interviewee_name: 'Sofia Rodriguez', state: 'scheduled', scheduled_at: '2026-08-16T20:00:00.000Z', origin: 'repair', reports_in: 0, review_state: 'none', problem_title: 'Product of Array Except Self' },
];

const problems: ProblemsData['problems'] = [
  { id: 1, source: 'leetcode', number: 56, title: 'Merge Intervals', url: 'https://leetcode.com/problems/merge-intervals/', difficulty: 'medium', difficulty_rank: 2.3, content_md: '## Statement\n\nGiven an array of intervals, merge overlapping intervals.\n\n## Hints\n\nSort by start time.\n\n## Solution\n\nSort, then scan once.', available_weeks: [2], statement_md: 'Given an array of intervals, merge overlapping intervals.', hints_md: 'Sort by start time.\nTrack the current merged interval.', solution_md: 'Sort, then scan once.', active: 1, uses: 8, exposures: 16 },
  { id: 2, source: 'leetcode', number: 20, title: 'Valid Parentheses', url: 'https://leetcode.com/problems/valid-parentheses/', difficulty: 'easy', difficulty_rank: 1.1, content_md: '## Statement\n\nDetermine whether brackets are balanced.\n\n## Hints\n\nUse a stack.\n\n## Solution\n\nPush openers and match closers.', available_weeks: [1, 2], statement_md: 'Determine whether brackets are balanced.', hints_md: 'Use a stack.', solution_md: 'Push openers and match closers.', active: 1, uses: 6, exposures: 12 },
  { id: 3, source: 'leetcode', number: 200, title: 'Number of Islands', url: 'https://leetcode.com/problems/number-of-islands/', difficulty: 'medium', difficulty_rank: 2.6, content_md: '## Statement\n\nCount connected land components.\n\n## Hints\n\nTry DFS or BFS.\n\n## Solution\n\nFlood-fill each unseen land cell.', available_weeks: [2, 3], statement_md: 'Count connected land components.', hints_md: 'Try DFS or BFS.', solution_md: 'Flood-fill each unseen land cell.', active: 1, uses: 5, exposures: 10 },
  { id: 4, source: 'manual', number: null, title: 'Legacy Graph Exercise', url: null, difficulty: 'hard', difficulty_rank: 3.2, content_md: '## Statement\n\nLegacy exercise.\n\n## Hints\n\n\n\n## Solution\n\n', available_weeks: [3], statement_md: null, hints_md: null, solution_md: null, active: 0, uses: 0, exposures: 0 },
];

const operations: OperationsData = {
  outbox: [
    { id: 203, kind: 'email', payload: JSON.stringify({ to: 'maya@example.com', subject: 'Your WTA pairing' }), participant_name: 'Maya Singh', attempts: 5, run_after: now, done_at: null, dismissed_at: null, last_error: 'Email binding rejected recipient', created_at: now },
    { id: 202, kind: 'dm', payload: JSON.stringify({ userId: '100000000000000002', message: { content: 'Choose a session time.' } }), participant_name: 'Jordan Lee', attempts: 1, run_after: '2026-08-13T14:05:00.000Z', done_at: null, dismissed_at: null, last_error: 'Discord API 429', created_at: now },
    { id: 201, kind: 'channel_msg', payload: JSON.stringify({ channelId: '100000000000000099', message: { content: 'Round 2 is open.' } }), participant_name: null, attempts: 0, run_after: now, done_at: '2026-08-13T13:59:00.000Z', dismissed_at: null, last_error: null, created_at: now },
  ],
  notifications: [{ id: 12, name: 'Maya Singh', channel: 'email', kind: 'pairing', status: 'sent', created_at: now }, { id: 11, name: 'Jordan Lee', channel: 'dm', kind: 'scheduling_nudge', status: 'sent', created_at: now }],
  jobs: [{ id: 3, job_key: 'round:2:nudge:1', ran_at: now }, { id: 2, job_key: 'round:2:match', ran_at: '2026-08-08T22:15:00.000Z' }],
  audit: overview.recentAudit,
};

export async function adminDemoRequest(path: string, init?: RequestInit): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, init?.method ? 180 : 80));
  if (init?.method && init.method !== 'GET') return { ok: true, updated: 1, queued: 1, skipped: 0, state: 'verified', id: 99, weeks };
  if (path === '/overview') return overview;
  if (path === '/participants') return { participants, cohort, currentWeek: weeks[1] } satisfies ParticipantsData;
  if (path.match(/^\/participants\/\d+$/)) {
    const id = Number(path.split('/').at(-1)); const participant = participants.find((row) => row.id === id) ?? participants[0]!;
    return { participant: { ...participant, opportunities: '["internships","new_grad"]', topics: '["dsa","system_design"]', prior_wta: id % 2, experience_band: '3-4', blurb: 'Interested in infrastructure and developer tools, especially work that improves how engineering teams build and operate software.', interests: 'System design practice and communicating tradeoffs clearly.', prior_feedback: id % 2 ? 'More structured mock-interview feedback would be helpful.' : null, updated_at: now }, sessions: sessions.slice(0, 3), incidents: participant.strikes ? [{ id: 1, kind: 'unresponsive', state: 'confirmed', created_at: now, reporter_name: 'Jordan Lee' }] : [], audit: overview.recentAudit };
  }
  if (path.startsWith('/rounds')) return { cohort, weeks, selectedWeek: weeks[1], sessions, optins: participants.filter((p) => p.opted_in).map((p) => ({ participant_id: p.id, name: p.name, standby: p.id === 7 ? 1 : 0, wants_double: p.id === 4 ? 1 : 0, status: p.status })), repairs: [{ id: 1, participant_id: 8, name: 'Amara Okafor', need: 'interviewer', state: 'open', created_at: now }] } satisfies RoundsData;
  if (path === '/reviews') return { reviews: [
    { id: 71, review_state: 'pending', state: 'completed', round: 3, interviewer_name: 'Jordan Lee', interviewee_name: 'Maya Singh', interviewee_id: 3, video_url: 'https://example.com/recording' },
    { id: 70, review_state: 'flagged', state: 'completed', round: 3, interviewer_name: 'Alex Chen', interviewee_name: 'Sam Wilson', interviewee_id: 4, video_url: null },
    { id: 68, review_state: 'verified', state: 'completed', round: 3, interviewer_name: 'Taylor Kim', interviewee_name: 'Priya Patel', interviewee_id: 6, video_url: 'https://example.com/recording2' },
  ] } satisfies ReviewsData;
  if (path === '/problems') return { problems, sets: problems.filter((problem) => problem.available_weeks.includes(2)).map((problem) => ({ week_id: 2, round: 2, cohort_name: cohort.name, problem_id: problem.id, title: problem.title })), cohort, weeks } satisfies ProblemsData;
  if (path === '/analytics') return { participants: overview.participantStatuses.map((row) => ({ label: row.status, value: row.n })), sessions: overview.sessionStates.map((row) => ({ label: row.state, value: row.n })), reports: [{ label: 'interviewee_report', total: 18, submitted: 15 }, { label: 'interviewer_report', total: 18, submitted: 14 }], reviews: [{ label: 'verified', value: 9 }, { label: 'pending', value: 3 }, { label: 'flagged', value: 2 }], problems: problems.map((problem) => ({ id: problem.id, title: problem.title, difficulty: problem.difficulty, uses: problem.uses, avg_experience: problem.uses ? 4.2 - problem.id * .2 : null })), rounds: [{ cohort: cohort.name, round: 1, optins: 12, sessions: 20, completed: 18 }, { cohort: cohort.name, round: 2, optins: 10, sessions: 19, completed: 7 }, { cohort: cohort.name, round: 3, optins: 0, sessions: 0, completed: 0 }] } satisfies AnalyticsData;
  if (path === '/operations') return operations;
  if (path === '/settings') return { settings: { announce_channel_id: '10829384012', organizer_channel_id: '10829384013', threads_channel_id: '10829384014', organizer_role_id: '10829384099', participant_role_id: '10829384098', packet_mode: 'off' }, cohorts: [cohort, { id: 0, name: 'Summer 2025', start_date: '2025-07-20', weeks_count: 3, status: 'done' }], timeline: [
    { index: 0, startsOn: '2026-07-12', endsOn: '2026-07-18', title: 'Word-of-mouth marketing', technicalRound: null },
    { index: 1, startsOn: '2026-07-19', endsOn: '2026-07-25', title: 'Preparing for applicants', technicalRound: null },
    { index: 2, startsOn: '2026-07-26', endsOn: '2026-08-01', title: 'Intro call + Technical Round 1', technicalRound: 1 },
    { index: 3, startsOn: '2026-08-02', endsOn: '2026-08-08', title: 'Resume lesson + roast sessions', technicalRound: 1 },
    { index: 4, startsOn: '2026-08-09', endsOn: '2026-08-15', title: 'Technical Round 2', technicalRound: 2 },
    { index: 5, startsOn: '2026-08-16', endsOn: '2026-08-22', title: 'Behavioral lesson', technicalRound: 2 },
    { index: 6, startsOn: '2026-08-23', endsOn: '2026-08-29', title: 'Technical Round 3', technicalRound: 3 },
    { index: 7, startsOn: '2026-08-30', endsOn: '2026-09-05', title: 'Review footage + draft list', technicalRound: 3 },
    { index: 8, startsOn: '2026-09-06', endsOn: '2026-09-12', title: 'Referrals + alumni coordination', technicalRound: null },
  ], programWeek: { index: 4, startsOn: '2026-08-09', endsOn: '2026-08-15', title: 'Technical Round 2', technicalRound: 2 }, activeParticipants: 10, minimumMatchingPool: 3 } satisfies AdminSettingsData;
  throw new Error(`No demo response for ${path}`);
}
