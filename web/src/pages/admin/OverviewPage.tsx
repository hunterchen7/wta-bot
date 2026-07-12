import { Link } from 'react-router-dom';
import type { OverviewData } from '../../admin-types';
import { Badge, ErrorState, formatDate, LoadingState, Metric, PageIntro, Panel, tdClass, thClass } from '../../components/AdminUI';
import { useAdminData } from '../../hooks/useAdminData';

const queueLinks: Array<[keyof OverviewData['queues'], string, string]> = [
  ['openForms', 'Reports outstanding', '/app/admin/rounds'], ['incidents', 'Open incidents', '/app/admin/participants'],
  ['repairs', 'Repair queue', '/app/admin/rounds'], ['reviews', 'Recording reviews', '/app/admin/reviews'],
  ['failedOutbox', 'Delivery failures', '/app/admin/operations'],
];

export function OverviewPage() {
  const { data, error, loading, reload } = useAdminData<OverviewData>('/overview');
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No overview data returned.'} onRetry={() => void reload()} />;
  const totalSessions = data.sessionStates.reduce((sum, row) => sum + Number(row.n), 0);
  const completed = Number(data.sessionStates.find((row) => row.state === 'completed')?.n ?? 0);
  const attention = queueLinks.reduce((sum, [key]) => sum + data.queues[key], 0);
  return <div className="space-y-7">
    <PageIntro title="Operational overview" description="The current cohort at a glance, with the exceptions that need an organizer—not a wall of vanity metrics." actions={<Link className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" to="/app/admin/operations">System activity</Link>} />

    {!data.cohort ? <Panel><div className="p-7"><h2 className="font-black text-slate-950">No active cohort</h2><p className="mt-1 text-sm text-slate-500">Create a cohort calendar in Program settings before opening enrollment.</p><Link to="/app/admin/settings" className="mt-4 inline-flex rounded-lg bg-western-700 px-3.5 py-2 text-sm font-bold text-white">Configure cohort</Link></div></Panel> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Active participants" value={data.activeParticipants} note={data.matchingReady ? 'Matching pool is viable' : 'At least 3 are needed to match'} tone={data.matchingReady ? 'good' : 'warn'} />
      <Metric label="Current round" value={data.currentWeek ? `R${data.currentWeek.idx}` : '—'} note={data.currentWeek ? `Reports due ${formatDate(data.currentWeek.reports_due_at, false)}` : 'No round selected'} />
      <Metric label="Session completion" value={totalSessions ? `${Math.round(completed / totalSessions * 100)}%` : '—'} note={`${completed} of ${totalSessions} sessions`} tone={completed === totalSessions && totalSessions ? 'good' : 'default'} />
      <Metric label="Needs attention" value={attention} note="Across operational queues" tone={attention ? 'warn' : 'good'} />
    </div>}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
      <Panel title="Action required" description="Queues are ordered by operational impact.">
        <div className="divide-y divide-slate-100">{queueLinks.map(([key, label, href]) => {
          const value = data.queues[key];
          return <Link key={key} to={href} className="group flex items-center gap-4 px-5 py-4 hover:bg-slate-50/80 dark:hover:bg-white/5"><span className={`grid size-9 shrink-0 place-items-center rounded-xl text-sm font-black tabular-nums ${value ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>{value}</span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-900">{label}</span><span className="block text-xs text-slate-500">{value ? 'Open the queue and resolve' : 'Nothing waiting'}</span></span><span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600">→</span></Link>;
        })}</div>
      </Panel>
      <Panel title="Round health" description={data.currentWeek ? `Round ${data.currentWeek.idx} session states` : 'No current round'}>
        <div className="space-y-4 p-5">{data.sessionStates.length ? data.sessionStates.map((row) => {
          const percentage = totalSessions ? Number(row.n) / totalSessions * 100 : 0;
          return <div key={row.state}><div className="mb-1.5 flex items-center justify-between gap-4"><Badge value={row.state} /><span className="text-xs font-bold tabular-nums text-slate-500">{row.n} · {Math.round(percentage)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-800 transition-[width] duration-500" style={{ width: `${percentage}%` }} /></div></div>;
        }) : <p className="text-sm text-slate-500">No sessions in this round yet.</p>}</div>
      </Panel>
    </div>

    <Panel title="Recent organizer activity" actions={<Link to="/app/admin/operations" className="text-xs font-bold text-western-700 hover:text-western-800">View audit log →</Link>}>
      <div className="overflow-x-auto"><table className="w-full min-w-[38rem] text-left text-sm"><thead><tr><th className={thClass}>When</th><th className={thClass}>Organizer</th><th className={thClass}>Action</th><th className={thClass}>Target</th></tr></thead><tbody>{data.recentAudit.map((row) => <tr key={row.id}><td className={tdClass}>{formatDate(row.created_at)}</td><td className={tdClass}>{row.actor_name ?? 'System'}</td><td className={`${tdClass} font-semibold text-slate-900`}>{row.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</td><td className={tdClass}>{row.target_type ? `${row.target_type} #${row.target_id ?? ''}` : '—'}</td></tr>)}</tbody></table></div>
    </Panel>
  </div>;
}
