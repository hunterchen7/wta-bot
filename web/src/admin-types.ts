export type CountRow = { label?: string; state?: string; status?: string; value?: number; n?: number };
export type Cohort = { id: number; name: string; start_date: string; weeks_count: number; status: string };
export type Week = { id: number; cohort_id: number; idx: number; optin_opens_at: string; optin_closes_at: string; match_at: string; reports_due_at: string; grace_until: string | null };
export type ProgramWeek = { index: number; startsOn: string; endsOn: string; title: string; technicalRound: number | null };

export type OverviewData = {
  cohort: Cohort | null;
  currentWeek: Week | null;
  programWeek: ProgramWeek | null;
  participantStatuses: Array<{ status: string; n: number }>;
  activeParticipants: number;
  matchingReady: boolean;
  sessionStates: Array<{ state: string; n: number }>;
  queues: { openForms: number; incidents: number; repairs: number; reviews: number; pendingOutbox: number; failedOutbox: number };
  recentAudit: AuditRow[];
};

export type EnrollmentFunnel = {
  generated: number;
  linksIssued: number;
  opened: number;
  completed: number;
  people: Array<{
    discord_id: string;
    display_name: string;
    discord_username: string | null;
    generated_at: string;
    last_generated_at: string;
    links_issued: number;
    opened_at: string | null;
    completed_at: string | null;
    last_event_at: string;
    status: 'link_generated' | 'in_progress' | 'completed';
  }>;
};

export type ParticipantRow = {
  id: number; discord_id: string; discord_username: string | null; discord_nickname: string | null; name: string | null; preferred_email: string | null; western_email: string | null;
  year: string | null; program: string | null; opportunities: string | null; prior_wta: number; experience_band: string | null; topics: string | null;
  blurb: string | null; interests: string | null; prior_feedback: string | null; status: string; email_ok: number; pairing_excluded: number; removed_reason: string | null; created_at: string; updated_at: string;
  linkedin_url: string | null; other_url: string | null; resume_filename: string | null; resume_content_type: string | null; resume_bytes: number | null; resume_uploaded_at: string | null;
  interviewer_credits: number; interviewee_credits: number; strikes: number; reports_owed: number; opted_in: number;
};
export type ParticipantsData = { participants: ParticipantRow[]; cohort: Cohort | null; currentWeek: Week | null };
export type ParticipantFormLink = { id: number; kind: 'interviewer_report' | 'interviewee_report'; session_id: number; deadline_at: string; submitted_at: string | null; url: string | null };
export type ParticipantDetail = { participant: Record<string, any>; sessions: Array<Record<string, any> & { forms: ParticipantFormLink[] }>; incidents: Array<Record<string, any>>; audit: AuditRow[] };

export type RoundSession = { id: number; interviewer_name: string; interviewee_name: string; state: string; scheduled_at: string | null; origin: string; reports_in: number; review_state: string; problem_number: number | null; problem_title: string | null; problem_difficulty: string | null; packet_sent_at: string | null };
export type RoundsData = { cohort: Cohort | null; weeks: Week[]; selectedWeek: Week | null; sessions: RoundSession[]; optins: Array<Record<string, any>>; participants: Array<{ id: number; name: string | null; discord_username: string | null }>; repairs: Array<Record<string, any>> };

export type ReviewRow = { id: number; review_state: string; state: string; round: number; interviewer_name: string; interviewee_name: string; interviewee_id: number; video_url: string | null };
export type ReviewsData = { reviews: ReviewRow[] };

export type ProblemRow = { id: number; source: string; number: number | null; title: string; url: string | null; difficulty: 'easy' | 'medium' | 'hard'; difficulty_rank: number | null; content_md: string; available_weeks: number[]; statement_md: string | null; solution_md: string | null; hints_md: string | null; active: number; uses: number; exposures: number };
export type ProblemsData = {
  problems: ProblemRow[];
  sets: Array<{ week_id: number; round: number; cohort_name: string; problem_id: number; title: string }>;
  cohort: Cohort | null;
  weeks: Week[];
};

export type AnalyticsData = {
  participants: CountRow[]; sessions: CountRow[];
  reports: Array<{ label: string; total: number; submitted: number }>;
  reviews: CountRow[];
  problems: Array<{ id: number; title: string; difficulty: string; uses: number; avg_experience: number | null }>;
  rounds: Array<{ cohort: string; round: number; optins: number; sessions: number; completed: number }>;
};

export type OutboxRow = { id: number; kind: string; payload: string; participant_name: string | null; attempts: number; run_after: string; done_at: string | null; dismissed_at: string | null; last_error: string | null; created_at: string };
export type AuditRow = { id: number; actor_participant_id: number | null; actor_name: string | null; action: string; target_type: string | null; target_id: string | null; detail: string | null; created_at: string };
export type CronHealth = { status: 'healthy' | 'late' | 'never_run'; lastTickAt: string | null; ageMinutes: number | null; expectedEveryMinutes: number };
export type OperationsData = { outbox: OutboxRow[]; notifications: Array<Record<string, any>>; jobs: Array<Record<string, any>>; audit: AuditRow[]; cron: CronHealth; enrollmentFunnel: EnrollmentFunnel };

export type AdminSettingsData = { settings: Record<string, string>; cohorts: Cohort[]; timeline: ProgramWeek[]; programWeek: ProgramWeek | null; activeParticipants: number; minimumMatchingPool: number };
export type AdminMcpData = {
  mcpUrl: string;
  token: string | null;
  credential: null | {
    id: number;
    tokenPrefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    createdAt: string;
  };
};
