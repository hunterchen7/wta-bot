import { useState } from 'react';
import { PageIntro, Panel, Tabs } from '../../components/AdminUI';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';

const forms = {
  enrollment: {
    label: 'Program enrollment',
    description: 'Discord-linked identity, program goals, experience, learning interests, and reminder preferences.',
    path: '/preview/enrollment',
  },
  interviewee_report: {
    label: 'Interviewee report',
    description: 'Attendance, recording and code links, experience ratings, and private or shared feedback.',
    path: '/preview/form/interviewee_report',
  },
  interviewer_report: {
    label: 'Interviewer report',
    description: 'Attendance, candidate ratings, hints, verdict, and structured strengths and improvements.',
    path: '/preview/form/interviewer_report',
  },
} as const;

type FormKind = keyof typeof forms;
const formEntries = Object.entries(forms) as Array<[FormKind, (typeof forms)[FormKind]]>;

export function FormsPage() {
  const [kind, setKind] = useState<FormKind>('enrollment');
  const [loading, setLoading] = useState<Record<FormKind, boolean>>({ enrollment: true, interviewee_report: true, interviewer_report: true });
  const form = forms[kind];
  return <div className="flex min-h-[34rem] flex-col gap-5 lg:h-[calc(100dvh-9rem)] lg:min-h-0">
    <PageIntro title="Forms" description="Inspect the exact participant-facing reports. These previews use the live form schemas and never write program data." actions={<Button asChild variant="outline"><a href={form.path} target="_blank" rel="noreferrer">Open full preview ↗</a></Button>} />
    <div className="flex shrink-0"><Tabs value={kind} onChange={(value) => setKind(value as FormKind)} items={formEntries.map(([value, item]) => ({ value, label: item.label }))} /></div>
    <Panel className="flex min-h-0 flex-1 flex-col" title={form.label} description={form.description}>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f7f7f5] dark:bg-background" aria-busy={loading[kind]}>
        {formEntries.map(([value, item]) => <iframe
          key={value}
          title={`${item.label} interactive preview`}
          src={`${item.path}?embed=1`}
          tabIndex={value === kind ? 0 : -1}
          aria-hidden={value === kind ? undefined : true}
          onLoad={() => setLoading((current) => current[value] ? { ...current, [value]: false } : current)}
          className={`absolute inset-0 size-full bg-[#f7f7f5] transition-opacity duration-150 dark:bg-background ${value === kind ? 'z-10 opacity-100' : 'pointer-events-none opacity-0'}`}
        />)}
        {loading[kind] ? <PreviewSkeleton /> : null}
      </div>
    </Panel>
  </div>;
}

function PreviewSkeleton() {
  return <div aria-label="Loading form preview" className="absolute inset-0 z-20 overflow-hidden bg-[#f7f7f5] p-6 dark:bg-background">
    <div className="mx-auto max-w-3xl animate-pulse space-y-5">
      <div className="space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-8 w-72 max-w-full" /><Skeleton className="h-4 w-full max-w-xl" /></div>
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /></div>
      <Skeleton className="h-52 rounded-2xl" />
    </div>
  </div>;
}
