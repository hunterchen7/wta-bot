import { useEffect } from 'react';
import { useDashboard } from '../dashboard-context';

const REFRESH_INTERVAL_MS = 15_000;

const stateStyles: Record<string, string> = {
  complete: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-emerald-100 text-emerald-800',
  waiting_partner: 'bg-violet-100 text-violet-800',
  waiting_you: 'bg-amber-100 text-amber-800',
  waiting_both: 'bg-orange-100 text-orange-800',
  scheduled: 'bg-sky-100 text-sky-800',
  pending_schedule: 'bg-amber-100 text-amber-800',
  broken: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-200 text-slate-700',
};

export function ProgressPage() {
  const { data, refresh } = useDashboard();
  const { participant, progress, sessions, owedReports, programWeek } = data;

  useEffect(() => {
    let refreshing = false;
    const poll = async () => {
      if (document.visibilityState !== 'visible' || refreshing) return;
      refreshing = true;
      try { await refresh({ silent: true }); } finally { refreshing = false; }
    };
    const interval = window.setInterval(() => void poll(), REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  return (
    <div className="space-y-8">
      <section>
        <div className="text-sm font-bold uppercase tracking-[0.2em] text-western-700">Your dashboard</div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Hey {participant.name.split(' ')[0] || 'there'} 👋</h1>
            <p className="mt-2 text-slate-600">Keep both sides of your interview practice moving.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-800">Server nickname: {participant.discordNickname || 'Not synced'}</span><span className="rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-800">Discord: {participant.discordUsername ? `@${participant.discordUsername}` : participant.discordId}</span><span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold capitalize text-slate-700 shadow-sm">{participant.status}</span></div>
        </div>
      </section>

      {programWeek ? <section className="rounded-3xl border border-western-200 bg-western-50/70 p-5 dark:border-western-800 dark:bg-western-950/30">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-western-700 dark:text-western-300">Program week {programWeek.index}</div>
        <div className="mt-1 text-lg font-black text-slate-950 dark:text-foreground">{programWeek.title}</div>
        <div className="mt-1 text-sm text-slate-600 dark:text-muted-foreground">{formatDay(programWeek.startsOn)}–{formatDay(programWeek.endsOn)}{programWeek.technicalRound ? ` · Technical Round ${programWeek.technicalRound} questions are active` : ''}</div>
      </section> : null}

      {owedReports.length ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="font-bold text-amber-950">{owedReports.length} report{owedReports.length === 1 ? '' : 's'} waiting for you</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {owedReports.map((report) => (
              <a key={report.id} href={report.url} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white hover:bg-amber-800">
                {label(report.kind)} · due {formatDate(report.deadlineAt)}
              </a>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 font-semibold text-emerald-900">All caught up — no reports owed.</section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <ProgressCard label="As interviewer" value={progress.interviewer} />
        <ProgressCard label="As interviewee" value={progress.interviewee} />
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-bold uppercase tracking-wider text-slate-500">Standing</div>
          <div className="mt-4 text-4xl font-black text-slate-950">{progress.strikes}</div>
          <div className="mt-1 text-sm text-slate-500">recorded strike{progress.strikes === 1 ? '' : 's'}</div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-black tracking-tight text-slate-950">Sessions</h2>
          <span className="flex items-center gap-2 text-sm text-slate-500"><span className="size-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />Live · {sessions.length} total</span>
        </div>
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {sessions.length ? (
            <div className="divide-y divide-slate-100">
              {sessions.map((session) => {
                const displayedState = session.state === 'broken' || session.state === 'cancelled'
                  ? session.state
                  : session.reportState === 'not_released' ? session.state : session.reportState;
                return <div key={session.id} className="grid gap-3 p-5 sm:grid-cols-[5rem_1fr_12rem_9rem] sm:items-center">
                  <div className="text-sm font-black text-western-700">Round {session.round}</div>
                  <div>
                    <div className="font-bold text-slate-900">{session.role === 'interviewer' ? `You interview ${session.partnerName ?? 'TBD'}` : `${session.partnerName ?? 'TBD'} interviews you`}</div>
                    <div className="mt-1 text-sm capitalize text-slate-500">Your role: {session.role}</div>
                  </div>
                  <div className="text-sm text-slate-600">{session.scheduledAt ? formatDate(session.scheduledAt) : 'Time not set'}</div>
                  <div><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${stateStyles[displayedState] ?? 'bg-slate-100 text-slate-700'}`}>{sessionStatusLabel(displayedState)}</span></div>
                </div>;
              })}
            </div>
          ) : <div className="p-8 text-center text-slate-500">No sessions yet. Your pairings will appear here.</div>}
        </div>
      </section>
    </div>
  );
}

function ProgressCard({ label: text, value }: { label: string; value: number }) {
  const percent = Math.min(100, (value / 3) * 100);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-sm font-bold uppercase tracking-wider text-slate-500">{text}</div>
      <div className="mt-4 flex items-end justify-between"><span className="text-4xl font-black text-slate-950">{value}<span className="text-xl text-slate-400">/3</span></span><span className="text-sm font-semibold text-western-700">{Math.round(percent)}%</span></div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-western-500 transition-all" style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const sessionStatusLabel = (value: string) => ({ complete: 'Complete', completed: 'Complete', waiting_both: 'Waiting on both submissions', waiting_you: 'Waiting on your submission', waiting_partner: 'Waiting for partner' }[value] ?? label(value));
const formatDate = (value: string) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(value));
const formatDay = (value: string) => new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' }).format(new Date(`${value}T12:00:00Z`));
