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
  const rounds = data.organizer
    ? [...new Set(data.problems.map((problem) => problem.round))]
    : data.round ? [data.round] : [];
  return <div className="space-y-7">
    <PageIntro
      eyebrow="Personal"
      title={data.organizer ? 'All practice problems' : data.round ? `Round ${data.round} practice` : 'Practice problems'}
      description={data.organizer
        ? 'Organizer view of every published practice set. Participants only see the set for their current round.'
        : data.cohort
        ? `${data.cohort.name}. These problems reinforce the skills used this round and are separate from the interview question pool.`
        : 'Practice problems for the current program round.'}
    />
    {data.problems.length ? <div className="space-y-8">
      {rounds.map((round) => <section key={round}>
        {data.organizer ? <div className="mb-4 flex items-center gap-3"><h2 className="text-lg font-black text-foreground">Technical Round {round}</h2>{round === data.round ? <Badge value="Current" /> : null}</div> : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.problems.filter((problem) => problem.round === round).map((problem) => <a
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
      title={data.round ? `No practice problems for round ${data.round}` : 'No active round yet'}
      description={data.round ? 'Organizers have not published practice problems for this round yet.' : 'Practice problems will appear when the cohort begins.'}
    /></Panel>}
  </div>;
}
