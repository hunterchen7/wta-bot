import { useEffect, useState } from 'react';
import { getPracticeProblems, type PracticeProblemsData } from '../api';
import { Badge, EmptyState, ErrorState, LoadingState, PageIntro, Panel } from '../components/AdminUI';
import { MarkdownContent } from '../components/MarkdownContent';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';

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
        <Accordion type="multiple" className="space-y-4">
      {data.problems.filter((problem) => problem.round === period.round).map((problem) => <AccordionItem
        key={problem.id}
        value={`problem-${problem.id}`}
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow duration-200 data-[state=open]:shadow-md"
      >
        <AccordionTrigger className="cursor-pointer p-5 hover:bg-muted/50 hover:no-underline sm:p-6 [&>svg]:size-5 [&>svg]:self-center data-[state=open]:text-western-800 dark:data-[state=open]:text-western-300">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-3"><span className="text-xs font-black uppercase tracking-[0.15em] text-muted-foreground">{problem.number ? `#${problem.number}` : 'WTA'}</span><Badge value={problem.difficulty} /></div>
            <h3 className="text-lg font-black text-foreground">{problem.title}</h3>
          </div>
        </AccordionTrigger>
        <AccordionContent className="border-t border-border px-5 py-6 sm:px-7 sm:py-8">
          <div className="mb-6 text-sm text-muted-foreground"><a href={problem.url} target="_blank" rel="noreferrer" className="font-bold text-western-700 underline decoration-western-300 underline-offset-4 dark:text-western-300">Open on LeetCode ↗</a></div>
          <MarkdownContent>{problem.content}</MarkdownContent>
        </AccordionContent>
      </AccordionItem>)}
        </Accordion>
      </section>)}
    </div> : <Panel><EmptyState
      title="No practice problems published"
      description="Organizers have not added any practice sets yet."
    /></Panel>}
  </div>;
}

const formatDay = (value: string) => new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' }).format(new Date(`${value}T12:00:00Z`));
