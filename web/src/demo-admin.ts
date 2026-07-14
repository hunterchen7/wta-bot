import type { AdminMcpData, AdminSettingsData, AnalyticsData, OperationsData, OverviewData, ParticipantsData, ProblemsData, ReviewsData, RoundsData } from './admin-types';

const now = new Date('2026-08-13T14:00:00.000Z').toISOString();
const cohort = { id: 1, name: 'Summer 2026', start_date: '2026-07-26', weeks_count: 3, status: 'active' };
const weeks = [
  { id: 1, cohort_id: 1, idx: 1, optin_opens_at: '2026-07-26T20:00:00.000Z', optin_closes_at: '2026-07-30T22:00:00.000Z', match_at: '2026-07-30T22:15:00.000Z', reports_due_at: '2026-08-09T03:59:00.000Z', grace_until: null },
  { id: 2, cohort_id: 1, idx: 2, optin_opens_at: '2026-08-09T20:00:00.000Z', optin_closes_at: '2026-08-13T22:00:00.000Z', match_at: '2026-08-13T22:15:00.000Z', reports_due_at: '2026-08-23T03:59:00.000Z', grace_until: null },
  { id: 3, cohort_id: 1, idx: 3, optin_opens_at: '2026-08-23T20:00:00.000Z', optin_closes_at: '2026-08-27T22:00:00.000Z', match_at: '2026-08-27T22:15:00.000Z', reports_due_at: '2026-09-06T03:59:00.000Z', grace_until: '2026-09-10T03:59:00.000Z' },
];
const names = ['Alex Chen', 'Jordan Lee', 'Maya Singh', 'Sam Wilson', 'Taylor Kim', 'Priya Patel', 'Noah Martin', 'Amara Okafor', 'Leo Zhang', 'Sofia Rodriguez', 'Ethan Brown', 'Zoe Park'];
const demoResumeFormats = [
  { extension: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 18_640 },
  { extension: 'rtf', contentType: 'application/rtf', bytes: 2_480 },
  { extension: 'odt', contentType: 'application/vnd.oasis.opendocument.text', bytes: 12_800 },
];
const demoResumeFormat = (index: number) => demoResumeFormats[Math.floor(index / 2) % demoResumeFormats.length]!;
const participants = names.map((name, index) => ({
  id: index + 1, discord_id: `10000${index}`, discord_username: name.toLowerCase().replace(' ', ''), discord_nickname: index % 4 === 0 ? name.split(' ')[0] : name, name, preferred_email: `${name.toLowerCase().replace(' ', '.')}@example.com`, western_email: `student${index}@uwo.ca`,
  year: ['Second', 'Third', 'Fourth'][index % 3], program: index % 3 === 1 ? 'Software Engineering' : 'Computer Science',
  opportunities: index % 2 ? '["internships"]' : '["internships","new_grad"]', prior_wta: index % 3 === 0 ? 1 : 0, experience_band: ['0', '1-2', '3-4', '5+'][index % 4], topics: index % 2 ? '["dsa","networking"]' : '["system_design","applications"]',
  blurb: `Interested in ${index % 2 ? 'product engineering' : 'infrastructure'} roles and building stronger interview communication skills.`, interests: index % 2 ? 'System design and practical interview strategy.' : null, prior_feedback: index % 3 === 0 ? 'More detailed feedback after each round.' : null,
  linkedin_url: index % 2 ? `https://www.linkedin.com/in/student-${index}` : null, other_url: index % 3 === 0 ? `https://github.com/student-${index}` : null,
  resume_filename: index % 2 ? `${name.replace(' ', '-')}-resume.${demoResumeFormat(index).extension}` : null, resume_content_type: index % 2 ? demoResumeFormat(index).contentType : null, resume_bytes: index % 2 ? demoResumeFormat(index).bytes : null, resume_uploaded_at: index % 2 ? now : null,
  status: index === 8 ? 'held' : index === 10 ? 'paused' : 'active', email_ok: index % 3 ? 1 : 0, pairing_excluded: index === 0 ? 1 : 0, removed_reason: null, created_at: new Date(Date.UTC(2026, 6, 12 + index, 16)).toISOString(), updated_at: new Date(Date.UTC(2026, 7, 1 + index, 18)).toISOString(),
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
  { id: 41, round: 2, interviewer_name: 'Alex Chen', interviewee_name: 'Jordan Lee', state: 'completed', scheduled_at: '2026-08-10T23:00:00.000Z', origin: 'match', reports_in: 2, review_state: 'none', problem_number: 56, problem_title: 'Merge Intervals', problem_difficulty: 'medium', packet_sent_at: '2026-08-09T17:00:00.000Z' },
  { id: 42, round: 2, interviewer_name: 'Maya Singh', interviewee_name: 'Sam Wilson', state: 'scheduled', scheduled_at: '2026-08-15T18:30:00.000Z', origin: 'match', reports_in: 0, review_state: 'none', problem_number: 20, problem_title: 'Valid Parentheses', problem_difficulty: 'easy', packet_sent_at: '2026-08-13T14:00:00.000Z' },
  { id: 43, round: 2, interviewer_name: 'Taylor Kim', interviewee_name: 'Priya Patel', state: 'pending_schedule', scheduled_at: null, origin: 'match', reports_in: 0, review_state: 'none', problem_number: null, problem_title: null, problem_difficulty: null, packet_sent_at: null },
  { id: 44, round: 2, interviewer_name: 'Noah Martin', interviewee_name: 'Amara Okafor', state: 'broken', scheduled_at: null, origin: 'match', reports_in: 0, review_state: 'none', problem_number: 200, problem_title: 'Number of Islands', problem_difficulty: 'medium', packet_sent_at: null },
  { id: 45, round: 2, interviewer_name: 'Leo Zhang', interviewee_name: 'Sofia Rodriguez', state: 'scheduled', scheduled_at: '2026-08-16T20:00:00.000Z', origin: 'repair', reports_in: 0, review_state: 'none', problem_number: 238, problem_title: 'Product of Array Except Self', problem_difficulty: 'medium', packet_sent_at: null },
];

const problems: ProblemsData['problems'] = [
  { id: 1, source: 'leetcode', number: 56, title: 'Merge Intervals', url: 'https://leetcode.com/problems/merge-intervals/', difficulty: 'medium', difficulty_rank: 2.3, content_md: '## Statement\n\nGiven an array of intervals, merge overlapping intervals.\n\n## Hints\n\nSort by start time.\n\n## Solution\n\nSort, then scan once.', available_weeks: [2], statement_md: 'Given an array of intervals, merge overlapping intervals.', hints_md: 'Sort by start time.\nTrack the current merged interval.', solution_md: 'Sort, then scan once.', active: 1, uses: 8, exposures: 16 },
  { id: 2, source: 'leetcode', number: 20, title: 'Valid Parentheses', url: 'https://leetcode.com/problems/valid-parentheses/', difficulty: 'easy', difficulty_rank: 1.1, content_md: '## Statement\n\nDetermine whether brackets are balanced.\n\n## Hints\n\nUse a stack.\n\n## Solution\n\nPush openers and match closers.', available_weeks: [1, 2], statement_md: 'Determine whether brackets are balanced.', hints_md: 'Use a stack.', solution_md: 'Push openers and match closers.', active: 1, uses: 6, exposures: 12 },
  { id: 3, source: 'leetcode', number: 200, title: 'Number of Islands', url: 'https://leetcode.com/problems/number-of-islands/', difficulty: 'medium', difficulty_rank: 2.6, content_md: '## Statement\n\nCount connected land components.\n\n## Hints\n\nTry DFS or BFS.\n\n## Solution\n\nFlood-fill each unseen land cell.', available_weeks: [2, 3], statement_md: 'Count connected land components.', hints_md: 'Try DFS or BFS.', solution_md: 'Flood-fill each unseen land cell.', active: 1, uses: 5, exposures: 10 },
  { id: 4, source: 'manual', number: null, title: 'Legacy Graph Exercise', url: null, difficulty: 'hard', difficulty_rank: 3.2, content_md: '## Statement\n\nLegacy exercise.\n\n## Hints\n\n\n\n## Solution\n\n', available_weeks: [3], statement_md: null, hints_md: null, solution_md: null, active: 0, uses: 0, exposures: 0 },
];

const operations: OperationsData = {
  enrollmentFunnel: {
    generated: 18, linksIssued: 22, opened: 15, completed: 12,
    people: [
      { discord_id: '200003', display_name: 'Avery Brooks', discord_username: 'avery.brooks', generated_at: '2026-08-13T13:10:00.000Z', last_generated_at: '2026-08-13T13:10:00.000Z', links_issued: 1, opened_at: null, completed_at: null, last_event_at: '2026-08-13T13:10:00.000Z', status: 'link_generated' },
      { discord_id: '200002', display_name: 'Morgan Bell', discord_username: 'morgan.bell', generated_at: '2026-08-13T12:40:00.000Z', last_generated_at: '2026-08-13T12:40:00.000Z', links_issued: 1, opened_at: '2026-08-13T12:42:00.000Z', completed_at: null, last_event_at: '2026-08-13T12:42:00.000Z', status: 'in_progress' },
      { discord_id: '200001', display_name: 'Jamie Wu', discord_username: 'jamie.wu', generated_at: '2026-08-13T11:20:00.000Z', last_generated_at: '2026-08-13T11:20:00.000Z', links_issued: 2, opened_at: '2026-08-13T11:22:00.000Z', completed_at: '2026-08-13T11:31:00.000Z', last_event_at: '2026-08-13T11:31:00.000Z', status: 'completed' },
    ],
  },
  outbox: [
    { id: 203, kind: 'email', payload: JSON.stringify({ to: 'maya@example.com', subject: 'Your WTA pairing' }), participant_name: 'Maya Singh', attempts: 5, run_after: now, done_at: null, dismissed_at: null, last_error: 'Email binding rejected recipient', created_at: now },
    { id: 202, kind: 'dm', payload: JSON.stringify({ userId: '100000000000000002', message: { content: 'Choose a session time.' } }), participant_name: 'Jordan Lee', attempts: 1, run_after: '2026-08-13T14:05:00.000Z', done_at: null, dismissed_at: null, last_error: 'Discord API 429', created_at: now },
    { id: 201, kind: 'channel_msg', payload: JSON.stringify({ channelId: '100000000000000099', message: { content: 'Round 2 is open.' } }), participant_name: null, attempts: 0, run_after: now, done_at: '2026-08-13T13:59:00.000Z', dismissed_at: null, last_error: null, created_at: now },
  ],
  notifications: [{ id: 12, name: 'Maya Singh', channel: 'email', kind: 'pairing', status: 'sent', created_at: now }, { id: 11, name: 'Jordan Lee', channel: 'dm', kind: 'scheduling_nudge', status: 'sent', created_at: now }],
  jobs: [{ id: 4, job_key: 'tick:2026-08-13T14:00', ran_at: now }, { id: 3, job_key: 'nudge:12', ran_at: now }, { id: 2, job_key: 'match:12', ran_at: '2026-08-08T22:15:00.000Z' }],
  audit: overview.recentAudit,
  cron: { status: 'healthy', lastTickAt: now, ageMinutes: 2, expectedEveryMinutes: 15 },
};

export async function adminDemoRequest(path: string, init?: RequestInit): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, init?.method ? 180 : 80));
  if (path === '/mcp-token/reset' && init?.method === 'POST') return { mcpUrl: 'https://wta.hunterchen.ca/mcp', token: 'wta_admin_demo_personal_mcp_token_123456789', credential: { id: 2, tokenPrefix: 'wta_admin_demo_per', scopes: ['admin:read', 'participants:write', 'problems:write', 'program:write', 'operations:write'], lastUsedAt: null, createdAt: now } } satisfies AdminMcpData;
  if (init?.method && init.method !== 'GET') return { ok: true, updated: 1, queued: 1, skipped: 0, state: 'verified', id: 99, weeks };
  if (path === '/overview') return overview;
  if (path === '/participants') return { participants, cohort, currentWeek: weeks[1] } satisfies ParticipantsData;
  if (path.match(/^\/participants\/\d+$/)) {
    const id = Number(path.split('/').at(-1)); const participant = participants.find((row) => row.id === id) ?? participants[0]!;
    return { participant: { ...participant, opportunities: '["internships","new_grad"]', topics: '["dsa","system_design"]', prior_wta: id % 2, experience_band: '3-4', blurb: 'Interested in infrastructure and developer tools, especially work that improves how engineering teams build and operate software.', interests: 'System design practice and communicating tradeoffs clearly.', prior_feedback: id % 2 ? 'More structured mock-interview feedback would be helpful.' : null, resume: participant.resume_filename ? { filename: participant.resume_filename, contentType: participant.resume_content_type, bytes: participant.resume_bytes, uploadedAt: participant.resume_uploaded_at } : null, updated_at: now }, sessions: sessions.slice(0, 3).map((session, index) => ({ ...session, forms: index === 2 ? [] : [{ id: 500 + index, kind: index === 0 ? 'interviewer_report' as const : 'interviewee_report' as const, session_id: session.id, deadline_at: weeks[1]!.reports_due_at, submitted_at: index === 0 ? now : null, url: `/f/demo-${500 + index}` }] })), incidents: participant.strikes ? [{ id: 1, kind: 'unresponsive', state: 'confirmed', created_at: now, reporter_name: 'Jordan Lee' }] : [], audit: overview.recentAudit };
  }
  if (path.startsWith('/rounds')) return { cohort, weeks, selectedWeek: weeks[1], sessions, participants: participants.filter((p) => p.status === 'active').map((p) => ({ id: p.id, name: p.name, discord_username: p.discord_username })), optins: participants.filter((p) => p.opted_in).map((p) => ({ participant_id: p.id, name: p.name, regular_opt_in: 1, extra_interviewer: p.id === 4 ? 1 : 0, standby: p.id === 7 ? 1 : 0, wants_double: p.id === 4 ? 1 : 0, status: p.status })), repairs: [{ id: 1, participant_id: 8, name: 'Amara Okafor', need: 'interviewer', state: 'open', created_at: now }] } satisfies RoundsData;
  if (path === '/reviews') return { reviews: [
    { id: 71, review_state: 'pending', state: 'completed', round: 3, interviewer_name: 'Jordan Lee', interviewee_name: 'Maya Singh', interviewee_id: 3, video_url: 'https://example.com/recording' },
    { id: 70, review_state: 'flagged', state: 'completed', round: 3, interviewer_name: 'Alex Chen', interviewee_name: 'Sam Wilson', interviewee_id: 4, video_url: null },
    { id: 68, review_state: 'verified', state: 'completed', round: 3, interviewer_name: 'Taylor Kim', interviewee_name: 'Priya Patel', interviewee_id: 6, video_url: 'https://example.com/recording2' },
  ] } satisfies ReviewsData;
  if (path === '/problems') return { problems, sets: problems.filter((problem) => problem.available_weeks.includes(2)).map((problem) => ({ week_id: 2, round: 2, cohort_name: cohort.name, problem_id: problem.id, title: problem.title })), cohort, weeks } satisfies ProblemsData;
  if (path === '/analytics') return { participants: overview.participantStatuses.map((row) => ({ label: row.status, value: row.n })), sessions: overview.sessionStates.map((row) => ({ label: row.state, value: row.n })), reports: [{ label: 'interviewee_report', total: 18, submitted: 15 }, { label: 'interviewer_report', total: 18, submitted: 14 }], reviews: [{ label: 'verified', value: 9 }, { label: 'pending', value: 3 }, { label: 'flagged', value: 2 }], problems: problems.map((problem) => ({ id: problem.id, title: problem.title, difficulty: problem.difficulty, uses: problem.uses, avg_experience: problem.uses ? 4.2 - problem.id * .2 : null })), rounds: [{ cohort: cohort.name, round: 1, optins: 12, sessions: 20, completed: 18 }, { cohort: cohort.name, round: 2, optins: 10, sessions: 19, completed: 7 }, { cohort: cohort.name, round: 3, optins: 0, sessions: 0, completed: 0 }] } satisfies AnalyticsData;
  if (path === '/operations') return operations;
  if (path === '/mcp-token') return { mcpUrl: 'https://wta.hunterchen.ca/mcp', token: 'wta_admin_demo_personal_mcp_token_123456789', credential: { id: 1, tokenPrefix: 'wta_admin_demo_per', scopes: ['admin:read', 'participants:write', 'problems:write', 'program:write', 'operations:write'], lastUsedAt: now, createdAt: '2026-08-10T14:00:00.000Z' } } satisfies AdminMcpData;
  if (path === '/settings') return { settings: { announce_channel_id: '10829384012', organizer_channel_id: '10829384013', threads_channel_id: '10829384014', organizer_role_id: '10829384099', participant_role_id: '10829384098', packet_mode: 'on', question_bank_public: 'off' }, cohorts: [cohort, { id: 0, name: 'Summer 2025', start_date: '2025-07-20', weeks_count: 3, status: 'done' }], timeline: [
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

export async function adminDemoFile(path: string, signal?: AbortSignal): Promise<Blob> {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 260);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('The request was aborted.', 'AbortError'));
    }, { once: true });
  });
  const match = path.match(/^\/participants\/(\d+)\/resume$/);
  if (!match) throw new Error(`No demo file for ${path}`);
  const participant = participants.find((row) => row.id === Number(match[1]));
  if (!participant?.resume_filename) throw new Error('No resume is attached to this profile.');
  const displayName = participant.name ?? 'WTA participant';
  if (participant.resume_filename.endsWith('.docx')) return demoDocx(participant);
  if (participant.resume_filename.endsWith('.odt')) return demoOdt(participant);
  const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\fs34\\b ${displayName}\\b0\\par\\fs22 ${participant.preferred_email ?? ''}\\par\\par\\b EXPERIENCE\\b0\\par Software engineering student with experience building reliable web applications and developer tools.\\par\\par\\b PROJECTS\\b0\\par WTA Dashboard - React, TypeScript, Cloudflare Workers\\par Built accessible organizer workflows and durable notification infrastructure.\\par\\par\\b EDUCATION\\b0\\par Western University - ${participant.program ?? 'Computer Science'}\\par}`;
  return new Blob([rtf], { type: 'application/rtf' });
}

async function demoDocx(participant: typeof participants[number]) {
  const { default: JSZip } = await import('jszip');
  const archive = new JSZip();
  archive.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  archive.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  archive.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docxParagraph(participant.name ?? 'WTA participant', true)}${docxParagraph(participant.preferred_email ?? '')}${docxParagraph('EXPERIENCE', true)}${docxParagraph('Software engineering student with experience building reliable web applications and developer tools.')}${docxParagraph('PROJECTS', true)}${docxParagraph('WTA Dashboard — React, TypeScript, Cloudflare Workers')}${docxParagraph('Built accessible organizer workflows and durable notification infrastructure.')}${docxParagraph('EDUCATION', true)}${docxParagraph(`Western University — ${participant.program ?? 'Computer Science'}`)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`);
  return archive.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function demoOdt(participant: typeof participants[number]) {
  const { default: JSZip } = await import('jszip');
  const archive = new JSZip();
  archive.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  archive.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h>${escapeXml(participant.name ?? 'WTA participant')}</text:h><text:p>${escapeXml(participant.preferred_email ?? '')}</text:p><text:h>EXPERIENCE</text:h><text:p>Software engineering student with experience building reliable web applications and developer tools.</text:p><text:h>PROJECTS</text:h><text:p>WTA Dashboard — React, TypeScript, Cloudflare Workers</text:p><text:p>Built accessible organizer workflows and durable notification infrastructure.</text:p><text:h>EDUCATION</text:h><text:p>Western University — ${escapeXml(participant.program ?? 'Computer Science')}</text:p></office:text></office:body></office:document-content>`);
  return archive.generateAsync({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.text' });
}

function docxParagraph(value: string, bold = false) {
  return `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}
