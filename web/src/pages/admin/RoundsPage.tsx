import { useMemo, useState } from 'react';
import type { RoundsData } from '../../admin-types';
import { adminRequest } from '../../api';
import { Badge, Button, EmptyState, ErrorState, formatDate, LoadingState, Metric, PageIntro, Panel, tableClass, tableWrapClass, tdClass, thClass, Tabs } from '../../components/AdminUI';
import { useAdminData } from '../../hooks/useAdminData';
import { LIVE_REFRESH_INTERVAL_MS } from '../../hooks/useAutoRefresh';
import { SelectControl } from '../../components/SelectControl';

export function RoundsPage() {
  const [weekId, setWeekId] = useState<number | null>(null); const [tab, setTab] = useState('sessions');
  const path = weekId ? `/rounds?week=${weekId}` : '/rounds';
  const { data, error, loading, reload } = useAdminData<RoundsData>(path, LIVE_REFRESH_INTERVAL_MS);
  const counts = useMemo(() => ({ completed: data?.sessions.filter((row) => row.state === 'completed').length ?? 0, unscheduled: data?.sessions.filter((row) => row.state === 'pending_schedule').length ?? 0, reports: data?.sessions.reduce((sum, row) => sum + Number(row.reports_in), 0) ?? 0, regularOptins: data?.optins.filter((row) => row.regular_opt_in === 1).length ?? 0, extraInterviewers: data?.optins.filter((row) => row.extra_interviewer === 1).length ?? 0 }), [data]);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No round data returned.'} onRetry={() => void reload()} />;
  if (!data.cohort) return <div className="space-y-7"><PageIntro title="Rounds" description="Opt-ins, session execution, report completion, and repair work." /><Panel><EmptyState title="No active cohort" description="Create a cohort in Program settings to generate its round calendar." /></Panel></div>;
  return <div className="space-y-7">
    <PageIntro title="Rounds" description="One operational board for opt-ins, matching results, session exceptions, reports, and repairs." actions={<SelectControl label="Select round" className="min-w-40" value={String(data.selectedWeek?.id ?? '')} onChange={(value) => setWeekId(Number(value))} options={data.weeks.map((week) => ({ value: String(week.id), label: `Round ${week.idx}` }))} />} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Opted in" value={counts.regularOptins} note={counts.extraInterviewers ? `${counts.extraInterviewers} extra interviewer${counts.extraInterviewers === 1 ? '' : 's'}` : 'No extra interviewers'} tone={counts.regularOptins >= 3 ? 'good' : 'warn'} /><Metric label="Sessions" value={data.sessions.length} note={`${counts.unscheduled} unscheduled`} tone={counts.unscheduled ? 'warn' : 'default'} /><Metric label="Completed" value={counts.completed} note={data.sessions.length ? `${Math.round(counts.completed / data.sessions.length * 100)}% of sessions` : 'No sessions yet'} /><Metric label="Reports filed" value={`${counts.reports}/${data.sessions.length * 2}`} note={`${Math.max(0, data.sessions.length * 2 - counts.reports)} outstanding`} /></div>
    {data.selectedWeek ? <Panel><div className="grid gap-px bg-slate-100 dark:bg-border sm:grid-cols-4"><Timeline label="Opt-in opens" value={data.selectedWeek.optin_opens_at} /><Timeline label="Initial pairings" value={data.selectedWeek.match_at} /><Timeline label="Late opt-ins" value="FCFS through round" format={false} /><Timeline label="Reports due" value={data.selectedWeek.reports_due_at} /></div></Panel> : null}
    <div className="flex"><Tabs value={tab} onChange={setTab} items={[{ value: 'sessions', label: 'Sessions', count: data.sessions.length }, { value: 'optins', label: 'Opt-ins', count: data.optins.length }, { value: 'repairs', label: 'Repairs', count: data.repairs.filter((row) => row.state === 'open').length }]} /></div>
    {tab === 'sessions' ? <SessionsPanel data={data} /> : tab === 'optins' ? <OptinsPanel data={data} reload={reload} /> : <RepairsPanel data={data} />}
  </div>;
}
function Timeline({ label, value, format = true }: { label: string; value: string; format?: boolean }) { return <div className="bg-white px-5 py-4 dark:bg-card"><div className="text-[0.65rem] font-black uppercase tracking-wider text-slate-400">{label}</div><div className="mt-1.5 text-sm font-bold text-slate-800 dark:text-foreground">{format ? formatDate(value) : value}</div></div>; }
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
function OptinsPanel({ data, reload }: { data: RoundsData; reload: () => Promise<void> }) {
  const [participantId, setParticipantId] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const extraIds = new Set(data.optins.filter((row) => row.extra_interviewer === 1).map((row) => Number(row.participant_id)));
  const candidates = data.participants.filter((participant) => !extraIds.has(participant.id));

  const setExtraInterviewer = async (id: number, enabled: boolean) => {
    if (!data.selectedWeek) return;
    setSavingId(id); setError(null);
    try {
      await adminRequest(`/rounds/${data.selectedWeek.id}/extra-interviewer`, {
        method: 'POST', body: JSON.stringify({ participantId: id, enabled }),
      });
      setParticipantId('');
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the extra interviewer.');
    } finally { setSavingId(null); }
  };

  return <Panel title="Opt-in pool" description="Round opt-ins, late first-come-first-served entries, and organizer-added interviewer capacity.">
    <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4 dark:border-border dark:bg-muted/20">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="text-sm font-extrabold text-slate-950 dark:text-foreground">Add an extra interviewer</div><p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 dark:text-muted-foreground">Adds one interviewer assignment for this round. It does not opt them in to be interviewed.</p></div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <SelectControl label="Participant" placeholder={candidates.length ? 'Choose a participant…' : 'Everyone eligible is already added'} className="w-full sm:w-72" value={participantId} onChange={setParticipantId} options={candidates.map((participant) => ({ value: String(participant.id), label: participant.name ?? (participant.discord_username ? `@${participant.discord_username}` : `Participant #${participant.id}`) }))} />
          <Button disabled={!participantId || savingId !== null} onClick={() => void setExtraInterviewer(Number(participantId), true)}>{savingId === Number(participantId) ? 'Adding…' : 'Add interviewer'}</Button>
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700 dark:text-rose-400">{error}</p> : null}
    </div>
    {data.optins.length ? <div className={tableWrapClass}><table className={tableClass}><thead><tr><th className={thClass}>Participant</th><th className={thClass}>Participation</th><th className={thClass}>Roster status</th><th className={`${thClass} text-right`}>Action</th></tr></thead><tbody>{data.optins.map((row) => <tr key={row.participant_id}><td className={`${tdClass} font-semibold text-slate-900 dark:text-foreground`}>{row.name}</td><td className={tdClass}><div className="flex flex-wrap gap-2">{row.regular_opt_in === 1 ? <Badge value="opted in" /> : <Badge value="extra only" />}{row.standby ? <Badge value="standby" /> : null}{row.wants_double ? <Badge value="double" /> : null}{row.extra_interviewer ? <Badge value="extra interviewer" /> : null}</div></td><td className={tdClass}><Badge value={row.status} /></td><td className={`${tdClass} text-right`}>{row.extra_interviewer ? <Button variant="quiet" className="text-rose-700 hover:text-rose-800 dark:text-rose-400" disabled={savingId !== null} onClick={() => void setExtraInterviewer(Number(row.participant_id), false)}>{savingId === Number(row.participant_id) ? 'Removing…' : 'Remove extra role'}</Button> : <span className="text-xs text-slate-400">—</span>}</td></tr>)}</tbody></table></div> : <EmptyState title="Nobody is in this round yet" description="Participants appear here after opting in, or after you add an extra interviewer above." />}
  </Panel>;
}
function RepairsPanel({ data }: { data: RoundsData }) { return <Panel title="Repair queue" description="Unmatched needs remain visible until paired or expired.">{data.repairs.length ? <div className={tableWrapClass}><table className={tableClass}><thead><tr><th className={thClass}>Participant</th><th className={thClass}>Needs</th><th className={thClass}>State</th><th className={thClass}>Entered</th></tr></thead><tbody>{data.repairs.map((row) => <tr key={row.id}><td className={`${tdClass} font-semibold text-slate-900`}>{row.name}</td><td className={tdClass}>{row.need}</td><td className={tdClass}><Badge value={row.state} /></td><td className={tdClass}>{formatDate(row.created_at)}</td></tr>)}</tbody></table></div> : <EmptyState title="Repair queue is clear" description="Broken sessions and unmatched demand will appear here automatically." />}</Panel>; }
