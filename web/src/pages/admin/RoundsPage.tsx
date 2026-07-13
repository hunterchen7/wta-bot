import { useMemo, useState } from 'react';
import type { RoundsData } from '../../admin-types';
import { Badge, EmptyState, ErrorState, formatDate, LoadingState, Metric, PageIntro, Panel, tableClass, tableWrapClass, tdClass, thClass, Tabs } from '../../components/AdminUI';
import { useAdminData } from '../../hooks/useAdminData';
import { SelectControl } from '../../components/SelectControl';

export function RoundsPage() {
  const [weekId, setWeekId] = useState<number | null>(null); const [tab, setTab] = useState('sessions');
  const path = weekId ? `/rounds?week=${weekId}` : '/rounds';
  const { data, error, loading, reload } = useAdminData<RoundsData>(path);
  const counts = useMemo(() => ({ completed: data?.sessions.filter((row) => row.state === 'completed').length ?? 0, unscheduled: data?.sessions.filter((row) => row.state === 'pending_schedule').length ?? 0, reports: data?.sessions.reduce((sum, row) => sum + Number(row.reports_in), 0) ?? 0 }), [data]);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No round data returned.'} onRetry={() => void reload()} />;
  if (!data.cohort) return <div className="space-y-7"><PageIntro title="Rounds" description="Opt-ins, session execution, report completion, and repair work." /><Panel><EmptyState title="No active cohort" description="Create a cohort in Program settings to generate its round calendar." /></Panel></div>;
  return <div className="space-y-7">
    <PageIntro title="Rounds" description="One operational board for opt-ins, matching results, session exceptions, reports, and repairs." actions={<SelectControl label="Select round" className="min-w-40" value={String(data.selectedWeek?.id ?? '')} onChange={(value) => setWeekId(Number(value))} options={data.weeks.map((week) => ({ value: String(week.id), label: `Round ${week.idx}` }))} />} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Opted in" value={data.optins.length} note={data.optins.length >= 3 ? 'Matching pool is viable' : 'At least 3 required'} tone={data.optins.length >= 3 ? 'good' : 'warn'} /><Metric label="Sessions" value={data.sessions.length} note={`${counts.unscheduled} unscheduled`} tone={counts.unscheduled ? 'warn' : 'default'} /><Metric label="Completed" value={counts.completed} note={data.sessions.length ? `${Math.round(counts.completed / data.sessions.length * 100)}% of sessions` : 'No sessions yet'} /><Metric label="Reports filed" value={`${counts.reports}/${data.sessions.length * 2}`} note={`${Math.max(0, data.sessions.length * 2 - counts.reports)} outstanding`} /></div>
    {data.selectedWeek ? <Panel><div className="grid gap-px bg-slate-100 sm:grid-cols-4"><Timeline label="Opt-in opens" value={data.selectedWeek.optin_opens_at} /><Timeline label="Opt-in closes" value={data.selectedWeek.optin_closes_at} /><Timeline label="Matching" value={data.selectedWeek.match_at} /><Timeline label="Reports due" value={data.selectedWeek.reports_due_at} /></div></Panel> : null}
    <div className="flex"><Tabs value={tab} onChange={setTab} items={[{ value: 'sessions', label: 'Sessions', count: data.sessions.length }, { value: 'optins', label: 'Opt-ins', count: data.optins.length }, { value: 'repairs', label: 'Repairs', count: data.repairs.filter((row) => row.state === 'open').length }]} /></div>
    {tab === 'sessions' ? <SessionsPanel data={data} /> : tab === 'optins' ? <OptinsPanel data={data} /> : <RepairsPanel data={data} />}
  </div>;
}
function Timeline({ label, value }: { label: string; value: string }) { return <div className="bg-white px-5 py-4"><div className="text-[0.65rem] font-black uppercase tracking-wider text-slate-400">{label}</div><div className="mt-1.5 text-sm font-bold text-slate-800">{formatDate(value)}</div></div>; }
function SessionsPanel({ data }: { data: RoundsData }) {
  return <Panel title="Session board" description="Assignments are private to organizers here; participants only receive them through the interviewer packet.">
    {data.sessions.length ? <div className={tableWrapClass}><table className={tableClass}>
      <thead><tr><th className={thClass}>Session</th><th className={thClass}>Participants</th><th className={thClass}>Scheduled</th><th className={thClass}>Interviewer assignment</th><th className={thClass}>Reports</th><th className={thClass}>State</th></tr></thead>
      <tbody>{data.sessions.map((row) => <tr key={row.id} className={row.state === 'pending_schedule' || row.state === 'broken' ? 'bg-amber-50/35 dark:bg-amber-950/10' : ''}>
        <td className={`${tdClass} font-mono text-xs`}>#{row.id}{row.origin === 'repair' ? <span className="ml-1 text-amber-700 dark:text-amber-400">repair</span> : null}</td>
        <td className={tdClass}><div className="space-y-1"><div><span className="mr-2 text-[0.65rem] font-black uppercase tracking-wide text-slate-400">Interviewer</span><span className="font-semibold text-slate-900 dark:text-foreground">{row.interviewer_name}</span></div><div><span className="mr-2 text-[0.65rem] font-black uppercase tracking-wide text-slate-400">Interviewee</span><span className="text-slate-700 dark:text-muted-foreground">{row.interviewee_name}</span></div></div></td>
        <td className={tdClass}>{formatDate(row.scheduled_at)}</td>
        <td className={tdClass}><ProblemAssignment row={row} /></td>
        <td className={tdClass}><span className={`font-black tabular-nums ${row.reports_in < 2 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{row.reports_in}/2</span></td>
        <td className={tdClass}><Badge value={row.state} /></td>
      </tr>)}</tbody>
    </table></div> : <EmptyState title="No sessions yet" description="Sessions appear after matching runs for this round." />}
  </Panel>;
}

function ProblemAssignment({ row }: { row: RoundsData['sessions'][number] }) {
  if (!row.problem_title) return <div><div className="text-sm font-semibold text-slate-500">Unassigned</div><div className="mt-1 text-xs text-amber-700 dark:text-amber-400">No eligible problem was available</div></div>;
  const delivery = row.packet_sent_at
    ? `Packet sent ${formatDate(row.packet_sent_at)}`
    : row.scheduled_at ? 'Packet not sent' : 'Reserved · sends when scheduled';
  return <div className="min-w-52"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900 dark:text-foreground">{row.problem_number ? `#${row.problem_number} · ` : ''}{row.problem_title}</span>{row.problem_difficulty ? <Badge value={row.problem_difficulty} /> : null}</div><div className={`mt-1 text-xs ${row.packet_sent_at ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-muted-foreground'}`}>{delivery}</div></div>;
}
function OptinsPanel({ data }: { data: RoundsData }) { return <Panel title="Opt-in pool" description="Standby and double volunteers are called out explicitly.">{data.optins.length ? <div className={tableWrapClass}><table className={tableClass}><thead><tr><th className={thClass}>Participant</th><th className={thClass}>Participation</th><th className={thClass}>Roster status</th></tr></thead><tbody>{data.optins.map((row) => <tr key={row.participant_id}><td className={`${tdClass} font-semibold text-slate-900`}>{row.name}</td><td className={tdClass}><div className="flex gap-2">{row.standby ? <Badge value="standby" /> : <Badge value="in" />}{row.wants_double ? <Badge value="double" /> : null}</div></td><td className={tdClass}><Badge value={row.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="Nobody has opted in" description="The pool stays empty until participants respond to the Discord opt-in panel." />}</Panel>; }
function RepairsPanel({ data }: { data: RoundsData }) { return <Panel title="Repair queue" description="Unmatched needs remain visible until paired or expired.">{data.repairs.length ? <div className={tableWrapClass}><table className={tableClass}><thead><tr><th className={thClass}>Participant</th><th className={thClass}>Needs</th><th className={thClass}>State</th><th className={thClass}>Entered</th></tr></thead><tbody>{data.repairs.map((row) => <tr key={row.id}><td className={`${tdClass} font-semibold text-slate-900`}>{row.name}</td><td className={tdClass}>{row.need}</td><td className={tdClass}><Badge value={row.state} /></td><td className={tdClass}>{formatDate(row.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState title="Repair queue is clear" description="Broken sessions and unmatched demand will appear here automatically." />}</Panel>; }
