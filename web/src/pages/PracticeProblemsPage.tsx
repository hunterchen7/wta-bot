import { useEffect, useState } from 'react';
import { getPracticeProblems, type PracticeProblemsData } from '../api';
import { Badge, EmptyState, ErrorState, LoadingState, PageIntro, Panel } from '../components/AdminUI';

export function PracticeProblemsPage() {
  const [data, setData] = useState<PracticeProblemsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    getPracticeProblems().then(setData).catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not load practice problems.'));
  };
  useEffect(load, []);
  if (!data && !error) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No practice data returned.'} onRetry={load} />;
  const rounds = data.rounds.filter((round) => data.problems.some((problem) => problem.round === round.round));
  return <div className="space-y-7">
    <PageIntro
      eyebrow="Personal"
      title="Practice problems"
      description={data.cohort
        ? `${data.cohort.name}. Every practice set stays visible so you can prepare ahead or revisit earlier material.`
        : 'Practice sets are separate from the private interview question pool.'}
    />
    {data.problems.length ? <div className="space-y-8">
      {rounds.map((period) => <section key={period.round}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-3"><h2 className="text-lg font-black text-foreground">Prep for Technical Round {period.round}</h2>{period.round === data.currentRound ? <Badge value="Current" /> : null}</div><p className="mt-1 text-sm text-muted-foreground">{period.programWeeks.length ? `Program Weeks ${period.programWeeks.join('–')}` : 'Technical round'}{period.startsOn && period.endsOn ? ` · ${formatDay(period.startsOn)}–${formatDay(period.endsOn)}` : ''}</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.problems.filter((problem) => problem.round === period.round).map((problem) => <a
        key={`${problem.number}-${problem.title}`}
        href={problem.url}
        target="_blank"
        rel="noreferrer"
        className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-western-300 hover:shadow-lg dark:border-border dark:bg-card dark:hover:border-western-700"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">{problem.number ? `#${problem.number}` : 'WTA'}</span>
          <Badge value={problem.difficulty} />
        </div>
        <h2 className="mt-5 text-lg font-black text-slate-950 transition group-hover:text-western-800 dark:text-foreground dark:group-hover:text-western-300">{problem.title}</h2>
        <div className="mt-3 text-xs font-bold text-western-700 dark:text-western-300">Practice on LeetCode ↗</div>
      </a>)}
        </div>
      </section>)}
    </div> : <Panel><EmptyState
      title="No practice problems published"
      description="Organizers have not added any practice sets yet."
    /></Panel>}
  </div>;
}

const formatDay = (value: string) => new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' }).format(new Date(`${value}T12:00:00Z`));
