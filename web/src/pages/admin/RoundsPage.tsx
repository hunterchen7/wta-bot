import { useEffect, useMemo, useState } from 'react';
import type { RoundReport, RoundReportsData, RoundsData, RoundSession } from '../../admin-types';
import { adminRequest } from '../../api';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  formatDate,
  inputClass,
  LoadingState,
  Metric,
  PageIntro,
  Panel,
  tableClass,
  tableWrapClass,
  tdClass,
  thClass,
  Tabs,
} from '../../components/AdminUI';
import { ParticipantProfileDialog } from '../../components/ParticipantProfileDialog';
import { Icon } from '../../components/Icon';
import { SelectControl } from '../../components/SelectControl';
import { Checkbox } from '../../components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { useAdminData } from '../../hooks/useAdminData';
import { LIVE_REFRESH_INTERVAL_MS } from '../../hooks/useAutoRefresh';

type OpenParticipant = (participantId: number) => void;

const SESSION_COLUMN_STORAGE_KEY = 'wta:round-session-columns:v1';
const SESSION_SORT_STORAGE_KEY = 'wta:round-session-sort:v1';
const SESSION_COLUMNS = ['session', 'participants', 'scheduled', 'assignment', 'reports', 'state'] as const;
type SessionColumn = typeof SESSION_COLUMNS[number];
type SessionSortDirection = 'asc' | 'desc';
type SessionSort = { column: SessionColumn; direction: SessionSortDirection };
type SessionSortValue = string | number | null;
type SessionColumnDefinition = {
  label: string;
  defaultDirection?: SessionSortDirection;
  value: (session: RoundSession) => SessionSortValue;
};

const SESSION_COLUMN_DEFINITIONS: Record<SessionColumn, SessionColumnDefinition> = {
  session: { label: 'Session', defaultDirection: 'desc', value: (session) => session.id },
  participants: { label: 'Participants', value: (session) => `${session.interviewer_name}\u0000${session.interviewee_name}` },
  scheduled: { label: 'Scheduled', value: (session) => session.scheduled_at ? Date.parse(session.scheduled_at) : null },
  assignment: { label: 'Interviewer assignment', value: (session) => session.problem_number ?? session.problem_title },
  reports: { label: 'Reports', value: (session) => session.reports_in },
  state: { label: 'State', value: (session) => session.state },
};
const sessionSortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function RoundsPage() {
  const [weekId, setWeekId] = useState<number | null>(null);
  const [tab, setTab] = useState('sessions');
  const [profileParticipantId, setProfileParticipantId] = useState<number | null>(null);
  const path = weekId ? `/rounds?week=${weekId}` : '/rounds';
  const { data, error, loading, reload } = useAdminData<RoundsData>(path, LIVE_REFRESH_INTERVAL_MS);
  const counts = useMemo(() => ({
    completed: data?.sessions.filter((row) => row.state === 'completed').length ?? 0,
    unscheduled: data?.sessions.filter((row) => row.state === 'pending_schedule').length ?? 0,
    reports: data?.sessions.reduce((sum, row) => sum + Number(row.reports_in), 0) ?? 0,
    regularOptins: data?.optins.filter((row) => row.regular_opt_in === 1).length ?? 0,
    extraInterviewers: data?.optins.filter((row) => row.extra_interviewer === 1).length ?? 0,
  }), [data]);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No round data returned.'} onRetry={() => void reload()} />;
  if (!data.cohort) {
    return <div className="space-y-7">
      <PageIntro title="Rounds" description="Opt-ins, session execution, report completion, and re-pairing." />
      <Panel><EmptyState title="No active cohort" description="Create a cohort in Program settings to generate its round calendar." /></Panel>
    </div>;
  }

  const openParticipant: OpenParticipant = (participantId) => setProfileParticipantId(participantId);

  return <div className="space-y-7">
    <PageIntro
      title="Rounds"
      description="One operational board for opt-ins, matching results, session exceptions, reports, and re-pairing."
      actions={<SelectControl
        label="Select round"
        className="min-w-40"
        value={String(data.selectedWeek?.id ?? '')}
        onChange={(value) => setWeekId(Number(value))}
        options={data.weeks.map((week) => ({ value: String(week.id), label: `Round ${week.idx}` }))}
      />}
    />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric
        label="Opted in"
        value={counts.regularOptins}
        note={counts.extraInterviewers ? `${counts.extraInterviewers} extra interviewer${counts.extraInterviewers === 1 ? '' : 's'}` : 'No extra interviewers'}
        tone={counts.regularOptins >= 3 ? 'good' : 'warn'}
      />
      <Metric label="Sessions" value={data.sessions.length} note={`${counts.unscheduled} unscheduled`} tone={counts.unscheduled ? 'warn' : 'default'} />
      <Metric label="Completed" value={counts.completed} note={data.sessions.length ? `${Math.round(counts.completed / data.sessions.length * 100)}% of sessions` : 'No sessions yet'} />
      <Metric label="Reports filed" value={`${counts.reports}/${data.sessions.length * 2}`} note={`${Math.max(0, data.sessions.length * 2 - counts.reports)} outstanding`} />
    </div>
    {data.selectedWeek ? <Panel>
      <div className="grid gap-px bg-slate-100 dark:bg-border sm:grid-cols-4">
        <Timeline label="Opt-in opens" value={data.selectedWeek.optin_opens_at} />
        <Timeline label="Initial pairings" value={data.selectedWeek.match_at} />
        <Timeline label="Late opt-ins" value="FCFS through round" format={false} />
        <Timeline label="Reports due" value={data.selectedWeek.reports_due_at} />
      </div>
    </Panel> : null}
    <div className="flex">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'sessions', label: 'Sessions', count: data.sessions.length },
          { value: 'reports', label: 'Reports', count: counts.reports },
          { value: 'optins', label: 'Opt-ins', count: data.optins.length },
          { value: 'repairs', label: 'Re-pairs', count: data.repairs.filter((row) => row.state === 'open').length },
        ]}
      />
    </div>
    {tab === 'sessions'
      ? <SessionsPanel data={data} onOpenParticipant={openParticipant} />
      : tab === 'reports' && data.selectedWeek
        ? <ReportsPanel weekId={data.selectedWeek.id} onOpenParticipant={openParticipant} />
        : tab === 'optins'
          ? <OptinsPanel data={data} reload={reload} onOpenParticipant={openParticipant} />
          : <RepairsPanel data={data} onOpenParticipant={openParticipant} />}
    {profileParticipantId != null
      ? <ParticipantProfileDialog participantId={profileParticipantId} onClose={() => setProfileParticipantId(null)} />
      : null}
  </div>;
}

function Timeline({ label, value, format = true }: { label: string; value: string; format?: boolean }) {
  return <div className="bg-white px-5 py-4 dark:bg-card">
    <div className="text-[0.65rem] font-black uppercase tracking-wider text-slate-400">{label}</div>
    <div className="mt-1.5 text-sm font-bold text-slate-800 dark:text-foreground">{format ? formatDate(value) : value}</div>
  </div>;
}

function SessionsPanel({ data, onOpenParticipant }: { data: RoundsData; onOpenParticipant: OpenParticipant }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('all');
  const [attention, setAttention] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [visibleColumns, setVisibleColumns] = useState<SessionColumn[]>(readSessionColumns);
  const [sort, setSort] = useState<SessionSort>(readSessionSort);
  const stateOptions = useMemo(() => [...new Set(data.sessions.map((row) => row.state))].sort(), [data.sessions]);
  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return data.sessions.filter((row) => {
      if (state !== 'all' && row.state !== state) return false;
      if (origin === 'initial' && row.origin === 'repair') return false;
      if (origin === 'repair' && row.origin !== 'repair') return false;
      if (attention === 'unscheduled' && row.state !== 'pending_schedule') return false;
      if (attention === 'broken' && !['broken', 'cancelled'].includes(row.state)) return false;
      if (attention === 'reports' && row.reports_in >= 2) return false;
      if (attention === 'unassigned' && row.problem_title) return false;
      if (attention === 'clear' && (
        row.state === 'pending_schedule'
        || ['broken', 'cancelled'].includes(row.state)
        || !row.problem_title
      )) return false;
      if (!needle) return true;
      return [
        String(row.id),
        `#${row.id}`,
        row.interviewer_name,
        row.interviewee_name,
        row.problem_number == null ? '' : String(row.problem_number),
        row.problem_number == null ? '' : `#${row.problem_number}`,
        row.problem_title ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [attention, data.sessions, origin, query, state]);
  const sortedSessions = useMemo(() => {
    const rows = filteredSessions.slice();
    rows.sort((left, right) => compareSessions(left, right, sort));
    return rows;
  }, [filteredSessions, sort]);
  useEffect(() => {
    try { localStorage.setItem(SESSION_COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns)); } catch { /* storage unavailable */ }
  }, [visibleColumns]);
  useEffect(() => {
    try { localStorage.setItem(SESSION_SORT_STORAGE_KEY, JSON.stringify(sort)); } catch { /* storage unavailable */ }
  }, [sort]);
  useEffect(() => {
    if (visibleColumns.includes(sort.column)) return;
    const column = visibleColumns[0] ?? 'session';
    setSort({ column, direction: SESSION_COLUMN_DEFINITIONS[column].defaultDirection ?? 'asc' });
  }, [sort.column, visibleColumns]);
  const activeFilters = Number(Boolean(query.trim())) + Number(state !== 'all') + Number(attention !== 'all') + Number(origin !== 'all');
  const sortBy = (column: SessionColumn) => setSort((current) => current.column === column
    ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { column, direction: SESSION_COLUMN_DEFINITIONS[column].defaultDirection ?? 'asc' });
  const toggleColumn = (column: SessionColumn) => setVisibleColumns((current) => {
    if (current.includes(column)) {
      return current.length === 1 ? current : current.filter((candidate) => candidate !== column);
    }
    return SESSION_COLUMNS.filter((candidate) => candidate === column || current.includes(candidate));
  });
  const clearFilters = () => {
    setQuery('');
    setState('all');
    setAttention('all');
    setOrigin('all');
  };

  return <Panel title="Session board" description="Assignments are private to organizers here; participants only receive them through the interviewer packet.">
    {data.sessions.length ? <>
      <div className="space-y-3 border-b border-border bg-muted/15 p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <input
            type="search"
            className={`${inputClass} h-10 lg:max-w-sm`}
            aria-label="Search sessions"
            placeholder="Search participant, problem, or session…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-3 lg:flex lg:flex-1">
            <SelectControl
              label="Session state"
              className="h-10 lg:w-44"
              value={state}
              onChange={setState}
              options={[
                { value: 'all', label: 'All states' },
                ...stateOptions.map((value) => ({ value, label: value.replaceAll('_', ' ') })),
              ]}
            />
            <SelectControl
              label="Needs attention"
              className="h-10 lg:w-48"
              value={attention}
              onChange={setAttention}
              options={[
                { value: 'all', label: 'Any attention state' },
                { value: 'unscheduled', label: 'Not scheduled' },
                { value: 'broken', label: 'Broken or cancelled' },
                { value: 'reports', label: 'Fewer than 2 reports' },
                { value: 'unassigned', label: 'Problem unassigned' },
                { value: 'clear', label: 'No issues' },
              ]}
            />
            <SelectControl
              label="Pairing source"
              className="h-10 lg:w-40"
              value={origin}
              onChange={setOrigin}
              options={[
                { value: 'all', label: 'All pairings' },
                { value: 'initial', label: 'Initial pairings' },
                { value: 'repair', label: 'Re-pairs' },
              ]}
            />
          </div>
        </div>
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
          <div aria-live="polite" className="text-xs font-semibold tabular-nums text-muted-foreground">
            {filteredSessions.length} of {data.sessions.length} session{data.sessions.length === 1 ? '' : 's'}
            <span className="ml-1.5 text-muted-foreground/75">· Sorted by {SESSION_COLUMN_DEFINITIONS[sort.column].label} {sort.direction === 'asc' ? '↑' : '↓'}</span>
          </div>
          <div className="flex items-center gap-2">
            <SessionColumnsMenu visibleColumns={visibleColumns} onToggle={toggleColumn} onShowAll={() => setVisibleColumns([...SESSION_COLUMNS])} />
            {activeFilters ? <button type="button" className="cursor-pointer px-2 py-1.5 text-xs font-bold text-western-700 transition-colors hover:text-western-900 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-western-300 dark:hover:text-western-100" onClick={clearFilters}>Clear filters</button> : null}
          </div>
        </div>
      </div>
      {filteredSessions.length ? <div className={tableWrapClass}><table className={`${tableClass} ${visibleColumns.length <= 3 ? '!min-w-full' : ''}`}>
      <thead><tr>{visibleColumns.map((column) => <SessionColumnHeader key={column} column={column} sort={sort} onSort={sortBy} />)}</tr></thead>
      <tbody>{sortedSessions.map((row) => <tr key={row.id} className={row.state === 'pending_schedule' || row.state === 'broken' ? 'bg-amber-50/35 dark:bg-amber-950/10' : ''}>
        {visibleColumns.map((column) => <SessionCell key={column} column={column} row={row} onOpenParticipant={onOpenParticipant} />)}
      </tr>)}</tbody>
      </table></div> : <EmptyState title="No sessions match" description="Try a broader search or clear one of the filters." />}
    </> : <EmptyState title="No sessions yet" description="Sessions appear after matching runs for this round." />}
  </Panel>;
}

function SessionColumnsMenu({ visibleColumns, onToggle, onShowAll }: {
  visibleColumns: SessionColumn[];
  onToggle: (column: SessionColumn) => void;
  onShowAll: () => void;
}) {
  const allVisible = visibleColumns.length === SESSION_COLUMNS.length;
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="secondary" className="h-8 rounded-lg px-3 text-xs">
        <Icon name="menu" className="size-3.5" />
        Columns
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-black tabular-nums text-muted-foreground">
          {visibleColumns.length}/{SESSION_COLUMNS.length}
        </span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-64 overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3">
        <div className="text-sm font-black text-foreground">Visible columns</div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">Choose what appears on the session board.</p>
      </div>
      <div className="p-2">
        {SESSION_COLUMNS.map((column) => {
          const checked = visibleColumns.includes(column);
          const disabled = checked && visibleColumns.length === 1;
          return <label
            key={column}
            className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors motion-reduce:transition-none ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-muted'}`}
          >
            <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => onToggle(column)} />
            <span>{SESSION_COLUMN_DEFINITIONS[column].label}</span>
          </label>;
        })}
      </div>
      {!allVisible ? <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs font-bold text-western-700 transition-colors hover:bg-muted hover:text-western-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none dark:text-western-300 dark:hover:text-western-100"
          onClick={onShowAll}
        >
          Show all columns
        </button>
      </div> : null}
    </PopoverContent>
  </Popover>;
}

function SessionColumnHeader({ column, sort, onSort }: {
  column: SessionColumn;
  sort: SessionSort;
  onSort: (column: SessionColumn) => void;
}) {
  const definition = SESSION_COLUMN_DEFINITIONS[column];
  const active = sort.column === column;
  return <th
    aria-sort={active ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
    className={thClass}
  >
    <button
      type="button"
      aria-label={`Sort by ${definition.label}`}
      className="group/sort inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      onClick={() => onSort(column)}
    >
      {definition.label}
      <Icon
        name={active ? sort.direction === 'asc' ? 'sortAsc' : 'sortDesc' : 'sort'}
        className={`size-3.5 transition-opacity motion-reduce:transition-none ${active ? 'text-western-700 opacity-100 dark:text-western-300' : 'opacity-35 group-hover/sort:opacity-70'}`}
      />
    </button>
  </th>;
}

function SessionCell({ column, row, onOpenParticipant }: {
  column: SessionColumn;
  row: RoundSession;
  onOpenParticipant: OpenParticipant;
}) {
  switch (column) {
    case 'session':
      return <td className={`${tdClass} font-mono text-xs`}>#{row.id}{row.origin === 'repair' ? <span className="ml-1 text-amber-700 dark:text-amber-400">re-pair</span> : null}</td>;
    case 'participants':
      return <td className={`${tdClass} min-w-64`}>
        <div className="space-y-1">
          <div><span className="mr-2 text-[0.65rem] font-black uppercase tracking-wide text-slate-400">Interviewer</span><ParticipantNameButton participantId={row.interviewer_id} name={row.interviewer_name} onOpen={onOpenParticipant} /></div>
          <div><span className="mr-2 text-[0.65rem] font-black uppercase tracking-wide text-slate-400">Interviewee</span><ParticipantNameButton participantId={row.interviewee_id} name={row.interviewee_name} onOpen={onOpenParticipant} /></div>
        </div>
      </td>;
    case 'scheduled':
      return <td className={`${tdClass} whitespace-nowrap`}>{formatDate(row.scheduled_at)}</td>;
    case 'assignment':
      return <td className={tdClass}><ProblemAssignment row={row} /></td>;
    case 'reports':
      return <td className={tdClass}><span className={`font-black tabular-nums ${row.reports_in < 2 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{row.reports_in}/2</span></td>;
    case 'state':
      return <td className={tdClass}><Badge value={row.state} /></td>;
  }
}

function compareSessions(left: RoundSession, right: RoundSession, sort: SessionSort) {
  const definition = SESSION_COLUMN_DEFINITIONS[sort.column];
  const leftValue = definition.value(left);
  const rightValue = definition.value(right);
  const leftMissing = leftValue == null || leftValue === '' || (typeof leftValue === 'number' && Number.isNaN(leftValue));
  const rightMissing = rightValue == null || rightValue === '' || (typeof rightValue === 'number' && Number.isNaN(rightValue));
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return right.id - left.id;
    return leftMissing ? 1 : -1;
  }
  const compared = typeof leftValue === 'number' && typeof rightValue === 'number'
    ? leftValue - rightValue
    : sessionSortCollator.compare(String(leftValue), String(rightValue));
  return (sort.direction === 'asc' ? compared : -compared) || right.id - left.id;
}

function readSessionColumns(): SessionColumn[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_COLUMN_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [...SESSION_COLUMNS];
    const known = saved.map(String).filter((value): value is SessionColumn => asSessionColumn(value) != null);
    return known.length ? SESSION_COLUMNS.filter((column) => known.includes(column)) : [...SESSION_COLUMNS];
  } catch {
    return [...SESSION_COLUMNS];
  }
}

function readSessionSort(): SessionSort {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_SORT_STORAGE_KEY) ?? 'null');
    const column = asSessionColumn(saved?.column);
    const direction = saved?.direction;
    if (column && (direction === 'asc' || direction === 'desc')) return { column, direction };
  } catch { /* use default */ }
  return { column: 'session', direction: 'desc' };
}

function asSessionColumn(value: unknown): SessionColumn | null {
  return typeof value === 'string' && (SESSION_COLUMNS as readonly string[]).includes(value) ? value as SessionColumn : null;
}

function ReportsPanel({ weekId, onOpenParticipant }: { weekId: number; onOpenParticipant: OpenParticipant }) {
  const { data, error, loading, reload } = useAdminData<RoundReportsData>(`/rounds/${weekId}/reports`, LIVE_REFRESH_INTERVAL_MS);
  const [selectedReport, setSelectedReport] = useState<RoundReport | null>(null);

  return <Panel title="Submitted reports" description="Open the exact feedback participants submitted for this round.">
    {loading && !data ? <div className="p-5"><LoadingState /></div>
      : error || !data ? <div className="p-5"><ErrorState message={error ?? 'Could not load reports.'} onRetry={() => void reload()} /></div>
        : data.reports.length ? <div className={tableWrapClass}><table className={tableClass}>
          <thead><tr><th className={thClass}>Submitted by</th><th className={thClass}>Report</th><th className={thClass}>Session</th><th className={thClass}>Submitted</th><th className={`${thClass} text-right`}>Action</th></tr></thead>
          <tbody>{data.reports.map((report) => <tr key={report.id}>
            <td className={tdClass}>
              <ParticipantNameButton participantId={report.assignee_id} name={report.assignee_name ?? report.assignee_discord_username ?? `Participant #${report.assignee_id}`} onOpen={onOpenParticipant} />
              {report.assignee_discord_username ? <div className="mt-0.5 text-xs text-muted-foreground">@{report.assignee_discord_username}</div> : null}
            </td>
            <td className={tdClass}><Badge value={reportRole(report)} /></td>
            <td className={tdClass}>
              <div className="font-semibold text-foreground">Session #{report.session_id}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{report.interviewer_name} → {report.interviewee_name}</div>
            </td>
            <td className={tdClass}>{formatDate(report.submitted_at)}</td>
            <td className={`${tdClass} text-right`}><Button variant="secondary" onClick={() => setSelectedReport(report)}>View report</Button></td>
          </tr>)}</tbody>
        </table></div>
          : <EmptyState title="No reports submitted yet" description="Completed interviewer and interviewee reports will appear here automatically." />}
    {selectedReport ? <ReportDialog report={selectedReport} onClose={() => setSelectedReport(null)} onOpenParticipant={onOpenParticipant} /> : null}
  </Panel>;
}

function ReportDialog({ report, onClose, onOpenParticipant }: { report: RoundReport; onClose: () => void; onOpenParticipant: OpenParticipant }) {
  const role = reportRole(report);
  return <Dialog
    size="viewport"
    title={`${role} · Session #${report.session_id}`}
    description={`Submitted ${formatDate(report.submitted_at)}`}
    onClose={onClose}
  >
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <ReportFact label="Submitted by"><ParticipantNameButton participantId={report.assignee_id} name={report.assignee_name ?? `Participant #${report.assignee_id}`} onOpen={onOpenParticipant} /></ReportFact>
      <ReportFact label="Role" value={role} />
      <ReportFact label="Pair">
        <div className="space-y-1">
          <ParticipantNameButton participantId={report.interviewer_id} name={report.interviewer_name ?? `Participant #${report.interviewer_id}`} onOpen={onOpenParticipant} />
          <span className="mx-1 text-muted-foreground">→</span>
          <ParticipantNameButton participantId={report.interviewee_id} name={report.interviewee_name ?? `Participant #${report.interviewee_id}`} onOpen={onOpenParticipant} />
        </div>
      </ReportFact>
      <ReportFact label="Problem" value={report.problem_title ? `${report.problem_number ? `#${report.problem_number} · ` : ''}${report.problem_title}` : 'Not assigned'} />
    </div>
    <div className="mt-6 space-y-3">
      {report.answers.map((answer, index) => <section key={`${answer.id}-${index}`} className="rounded-xl border border-border bg-card p-4">
        <div className="text-[0.65rem] font-black uppercase tracking-wider text-muted-foreground">{answer.label}</div>
        <ReportAnswer answer={answer} />
      </section>)}
    </div>
  </Dialog>;
}

function ReportFact({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return <div className="rounded-xl bg-muted/60 p-3">
    <div className="text-[0.65rem] font-black uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="mt-1 min-w-0 break-words text-sm font-bold text-foreground">{children ?? value}</div>
  </div>;
}

function ReportAnswer({ answer }: { answer: RoundReport['answers'][number] }) {
  if (/^https?:\/\//i.test(answer.value)) {
    return <a href={answer.value} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm font-semibold text-western-700 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-western-300">{answer.value}</a>;
  }
  if (answer.id === 'code') {
    return <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">{answer.value}</pre>;
  }
  return <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/85">{answer.value}</p>;
}

function reportRole(report: RoundReport) {
  return report.kind === 'interviewer_report' ? 'Interviewer report' : 'Interviewee report';
}

function ProblemAssignment({ row }: { row: RoundsData['sessions'][number] }) {
  if (!row.problem_title) {
    return <div><div className="text-sm font-semibold text-slate-500">Unassigned</div><div className="mt-1 text-xs text-amber-700 dark:text-amber-400">No eligible problem was available</div></div>;
  }
  const delivery = row.packet_sent_at
    ? `Packet sent ${formatDate(row.packet_sent_at)}`
    : row.scheduled_at ? 'Packet not sent' : 'Reserved · sends when scheduled';
  return <div className="min-w-52">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-slate-900 dark:text-foreground">{row.problem_number ? `#${row.problem_number} · ` : ''}{row.problem_title}</span>
      {row.problem_difficulty ? <Badge value={row.problem_difficulty} /> : null}
    </div>
    <div className={`mt-1 text-xs ${row.packet_sent_at ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-muted-foreground'}`}>{delivery}</div>
  </div>;
}

function OptinsPanel({ data, reload, onOpenParticipant }: { data: RoundsData; reload: () => Promise<void>; onOpenParticipant: OpenParticipant }) {
  const [participantId, setParticipantId] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const extraIds = new Set(data.optins.filter((row) => row.extra_interviewer === 1).map((row) => Number(row.participant_id)));
  const candidates = data.participants.filter((participant) => !extraIds.has(participant.id));

  const setExtraInterviewer = async (id: number, enabled: boolean) => {
    if (!data.selectedWeek) return;
    setSavingId(id);
    setError(null);
    try {
      await adminRequest(`/rounds/${data.selectedWeek.id}/extra-interviewer`, {
        method: 'POST',
        body: JSON.stringify({ participantId: id, enabled }),
      });
      setParticipantId('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the extra interviewer.');
    } finally {
      setSavingId(null);
    }
  };

  return <Panel title="Opt-in pool" description="Round opt-ins, late first-come-first-served entries, and organizer-added interviewer capacity.">
    <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-border dark:bg-muted/20">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-sm font-extrabold text-slate-950 dark:text-foreground">Add an extra interviewer</div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 dark:text-muted-foreground">Adds one interviewer assignment for this round. It does not opt them in to be interviewed.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <SelectControl
            label="Participant"
            placeholder={candidates.length ? 'Choose a participant…' : 'Everyone eligible is already added'}
            className="w-full sm:w-72"
            value={participantId}
            onChange={setParticipantId}
            options={candidates.map((participant) => ({ value: String(participant.id), label: participant.name ?? (participant.discord_username ? `@${participant.discord_username}` : `Participant #${participant.id}`) }))}
          />
          <Button disabled={!participantId || savingId !== null} onClick={() => void setExtraInterviewer(Number(participantId), true)}>{savingId === Number(participantId) ? 'Adding…' : 'Add interviewer'}</Button>
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p> : null}
    </div>
    {data.optins.length ? <div className={tableWrapClass}><table className={tableClass}>
      <thead><tr><th className={thClass}>Participant</th><th className={thClass}>Participation</th><th className={thClass}>Roster status</th><th className={`${thClass} text-right`}>Action</th></tr></thead>
      <tbody>{data.optins.map((row) => <tr key={row.participant_id}>
        <td className={tdClass}><ParticipantNameButton participantId={Number(row.participant_id)} name={row.name} onOpen={onOpenParticipant} /></td>
        <td className={tdClass}><div className="flex flex-wrap gap-2">{row.regular_opt_in === 1 ? <Badge value="opted in" /> : <Badge value="extra only" />}{row.standby ? <Badge value="standby" /> : null}{row.wants_double ? <Badge value="double" /> : null}{row.extra_interviewer ? <Badge value="extra interviewer" /> : null}</div></td>
        <td className={tdClass}><Badge value={row.status} /></td>
        <td className={`${tdClass} text-right`}>{row.extra_interviewer ? <Button variant="quiet" className="text-rose-700 hover:text-rose-800 dark:text-rose-400" disabled={savingId !== null} onClick={() => void setExtraInterviewer(Number(row.participant_id), false)}>{savingId === Number(row.participant_id) ? 'Removing…' : 'Remove extra role'}</Button> : <span className="text-xs text-slate-400">—</span>}</td>
      </tr>)}</tbody>
    </table></div> : <EmptyState title="Nobody is in this round yet" description="Participants appear here after opting in, or after you add an extra interviewer above." />}
  </Panel>;
}

function RepairsPanel({ data, onOpenParticipant }: { data: RoundsData; onOpenParticipant: OpenParticipant }) {
  return <Panel title="Re-pair queue" description="Unmatched needs remain visible until paired or expired.">
    {data.repairs.length ? <div className={tableWrapClass}><table className={tableClass}>
      <thead><tr><th className={thClass}>Participant</th><th className={thClass}>Needs</th><th className={thClass}>State</th><th className={thClass}>Entered</th></tr></thead>
      <tbody>{data.repairs.map((row) => <tr key={row.id}>
        <td className={tdClass}><ParticipantNameButton participantId={Number(row.participant_id)} name={row.name} onOpen={onOpenParticipant} /></td>
        <td className={tdClass}>{row.need}</td>
        <td className={tdClass}><Badge value={row.state} /></td>
        <td className={tdClass}>{formatDate(row.created_at)}</td>
      </tr>)}</tbody>
    </table></div> : <EmptyState title="Re-pair queue is clear" description="Broken sessions and unmatched demand will appear here automatically." />}
  </Panel>;
}

function ParticipantNameButton({ participantId, name, onOpen }: { participantId: number; name: string; onOpen: OpenParticipant }) {
  return <button
    type="button"
    className="cursor-pointer rounded-sm font-semibold text-western-700 underline-offset-4 transition-colors hover:text-western-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-western-300 dark:hover:text-western-100"
    onClick={() => onOpen(participantId)}
  >
    {name}
  </button>;
}
