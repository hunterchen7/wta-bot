import { useState } from 'react';
import { PageIntro, Panel, Tabs } from '../../components/AdminUI';
import { Button } from '../../components/ui/button';

const forms = {
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

export function FormsPage() {
  const [kind, setKind] = useState<FormKind>('interviewee_report');
  const form = forms[kind];
  return <div className="space-y-7">
    <PageIntro title="Forms" description="Inspect the exact participant-facing reports. These previews use the live form schemas and never write program data." actions={<Button asChild variant="outline"><a href={form.path} target="_blank" rel="noreferrer">Open full preview ↗</a></Button>} />
    <div className="flex"><Tabs value={kind} onChange={(value) => setKind(value as FormKind)} items={Object.entries(forms).map(([value, item]) => ({ value, label: item.label }))} /></div>
    <Panel title={form.label} description={form.description}>
      <iframe key={kind} title={`${form.label} interactive preview`} src={`${form.path}?embed=1`} className="h-[clamp(34rem,72vh,58rem)] w-full bg-[#f7f7f5] dark:bg-background" />
    </Panel>
  </div>;
}
