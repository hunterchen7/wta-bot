import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Flag, Play, Save, Video } from 'lucide-react';
import type { ReviewDetail, ReviewReport, ReviewRow, ReviewsData } from '../../admin-types';
import { adminRequest } from '../../api';
import { Badge, Button, Dialog, EmptyState, ErrorState, LoadingState, PageIntro, Panel, Tabs, formatDate } from '../../components/AdminUI';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Skeleton } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';
import { useAdminData } from '../../hooks/useAdminData';
import { LIVE_REFRESH_INTERVAL_MS } from '../../hooks/useAutoRefresh';

type ReviewTab = 'pending' | 'flagged' | 'verified' | 'all';
type ReviewAction = 'save' | 'approve' | 'flag';
type RubricDraft = {
  completionRating: number | null;
  communicationRating: number | null;
  problemSolvingRating: number | null;
  implementationRating: number | null;
  testingRating: number | null;
  recordingQuality: number | null;
  notes: string;
};

const emptyRubric: RubricDraft = {
  completionRating: null,
  communicationRating: null,
  problemSolvingRating: null,
  implementationRating: null,
  testingRating: null,
  recordingQuality: null,
  notes: '',
};

export function ReviewsPage() {
  const { data, error, loading, reload, setData } = useAdminData<ReviewsData>('/reviews', LIVE_REFRESH_INTERVAL_MS);
  const [tab, setTab] = useState<ReviewTab>('pending');
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const rows = useMemo(
    () => data?.reviews.filter((row) => tab === 'all' || row.review_state === tab) ?? [],
    [data, tab],
  );

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No reviews returned.'} onRetry={() => void reload()} />;

  const counts = {
    pending: data.reviews.filter((row) => row.review_state === 'pending').length,
    flagged: data.reviews.filter((row) => row.review_state === 'flagged').length,
    verified: data.reviews.filter((row) => row.review_state === 'verified').length,
  };
  const updateRow = (id: number, state: string, draft: RubricDraft) => {
    setData((current) => current ? {
      reviews: current.reviews.map((row) => row.id === id ? {
        ...row,
        review_state: state,
        completion_rating: draft.completionRating,
        rubric_updated_at: new Date().toISOString(),
      } : row),
    } : current);
  };

  return <div className="space-y-7">
    <PageIntro
      title="Round 3 reviews"
      description="Watch each submitted recording, compare both reports, and record a consistent completion decision with the organizer rubric."
    />
    <ReviewSummary pending={counts.pending} flagged={counts.flagged} verified={counts.verified} />
    <div className="flex">
      <Tabs
        value={tab}
        onChange={(value) => setTab(value as ReviewTab)}
        items={[
          { value: 'pending', label: 'To review', count: counts.pending },
          { value: 'flagged', label: 'Needs follow-up', count: counts.flagged },
          { value: 'verified', label: 'Completed', count: counts.verified },
          { value: 'all', label: 'All', count: data.reviews.length },
        ]}
      />
    </div>
    {rows.length ? <div className="space-y-3">{rows.map((row) => (
      <ReviewQueueRow key={row.id} row={row} onOpen={() => setSelected(row)} />
    ))}</div> : <Panel><EmptyState title={`No ${tab === 'pending' ? 'pending' : tab} reviews`} description="Round 3 submissions appear here as reports arrive." /></Panel>}
    {selected ? <ReviewWorkspace
      sessionId={selected.id}
      onClose={() => setSelected(null)}
      onSaved={(state, draft) => updateRow(selected.id, state, draft)}
    /> : null}
  </div>;
}

function ReviewSummary({ pending, flagged, verified }: { pending: number; flagged: number; verified: number }) {
  return <div className="grid gap-3 sm:grid-cols-3">
    <SummaryCard label="Waiting" value={pending} tone="text-amber-700 dark:text-amber-300" />
    <SummaryCard label="Needs follow-up" value={flagged} tone="text-rose-700 dark:text-rose-300" />
    <SummaryCard label="Completed" value={verified} tone="text-emerald-700 dark:text-emerald-300" />
  </div>;
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
    <div className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
    <div className={`mt-1 text-3xl font-black tabular-nums ${tone}`}>{value}</div>
  </div>;
}

function ReviewQueueRow({ row, onOpen }: { row: ReviewRow; onOpen: () => void }) {
  const problem = row.problem_title
    ? `${row.problem_number ? `#${row.problem_number} · ` : ''}${row.problem_title}`
    : 'Problem not recorded';
  return <button
    type="button"
    onClick={onOpen}
    className="group grid w-full cursor-pointer gap-4 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-western-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-western-500 motion-reduce:transform-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
  >
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge value={row.review_state} />
        <span className="text-xs font-bold text-muted-foreground">Session #{row.id}</span>
        <span className="text-xs text-muted-foreground">{row.reports_in}/2 reports</span>
        {row.video_url ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300"><Video className="size-3.5" /> Recording ready</span> : <span className="text-xs font-bold text-rose-700 dark:text-rose-300">No recording</span>}
      </div>
      <div className="mt-2 truncate text-base font-black text-foreground">{row.interviewee_name}</div>
      <div className="mt-0.5 truncate text-sm text-muted-foreground">Interviewed by {row.interviewer_name} · {problem}</div>
      <div className="mt-2 text-xs text-muted-foreground">{row.scheduled_at ? formatDate(row.scheduled_at) : 'Time not recorded'}{row.reviewer_name ? ` · Last reviewed by ${row.reviewer_name}` : ''}</div>
    </div>
    <span className="inline-flex items-center justify-center gap-2 rounded-xl bg-western-700 px-4 py-2.5 text-sm font-black text-white transition group-hover:bg-western-800">
      <Play className="size-4 fill-current" /> {row.review_state === 'pending' ? 'Start review' : 'Open review'}
    </span>
  </button>;
}

function ReviewWorkspace({ sessionId, onClose, onSaved }: { sessionId: number; onClose: () => void; onSaved: (state: string, draft: RubricDraft) => void }) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RubricDraft>(emptyRubric);
  const [baseline, setBaseline] = useState(JSON.stringify(emptyRubric));
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;

  useEffect(() => {
    const controller = new AbortController();
    adminRequest<ReviewDetail>(`/reviews/${sessionId}`, { signal: controller.signal })
      .then((value) => {
        const next = rubricFromDetail(value);
        setDetail(value);
        setDraft(next);
        setBaseline(JSON.stringify(next));
        setLoadError(null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'Could not load this review.');
      });
    return () => controller.abort();
  }, [sessionId]);

  const close = () => {
    if (dirty && !window.confirm('Discard the unsaved rubric changes?')) return;
    onClose();
  };
  const save = async (action: ReviewAction) => {
    setBusy(action);
    setSaveError(null);
    try {
      const result = await adminRequest<{ state: string }>(`/reviews/${sessionId}/rubric`, {
        method: 'POST',
        body: JSON.stringify({ action, ...draft }),
      });
      setBaseline(JSON.stringify(draft));
      setDetail((current) => current ? { ...current, session: { ...current.session, review_state: result.state } } : current);
      onSaved(result.state, draft);
      if (action !== 'save') onClose();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save this review.');
    } finally {
      setBusy(null);
    }
  };
  const complete = rubricComplete(draft);
  const approvable = complete && (draft.completionRating ?? 0) >= 3;

  return <Dialog
    title={detail ? `${detail.session.interviewee_name} · Round ${detail.session.round} review` : 'Loading review'}
    description={detail ? `Session #${detail.session.id} · interviewed by ${detail.session.interviewer_name}` : 'Loading the recording, reports, and saved rubric…'}
    onClose={close}
    size="viewport"
    bodyClassName="p-0"
    actions={detail ? <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <div className="text-xs font-semibold text-muted-foreground">{dirty ? 'Unsaved changes' : detail.rubric ? `Saved ${formatDate(detail.rubric.updated_at)}` : 'Not started'}</div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={Boolean(busy) || !dirty} onClick={() => void save('save')}><Save className="size-4" />{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
        <Button variant="danger" disabled={Boolean(busy) || !complete || !draft.notes.trim()} onClick={() => void save('flag')}><Flag className="size-4" />{busy === 'flag' ? 'Saving…' : 'Needs follow-up'}</Button>
        <Button disabled={Boolean(busy) || !approvable} onClick={() => void save('approve')}><CheckCircle2 className="size-4" />{busy === 'approve' ? 'Completing…' : 'Approve completion'}</Button>
      </div>
    </div> : undefined}
  >
    {loadError ? <div className="p-6"><ErrorState message={loadError} onRetry={() => window.location.reload()} /></div> : null}
    {!detail && !loadError ? <ReviewWorkspaceSkeleton /> : null}
    {detail ? <div className="grid min-h-full lg:grid-cols-[minmax(0,1.3fr)_minmax(23rem,.7fr)]">
      <div className="min-w-0 space-y-5 border-b border-border bg-slate-950 p-4 text-slate-100 lg:border-r lg:border-b-0 sm:p-5">
        <RecordingPanel url={detail.videoUrl} />
        <SessionContext detail={detail} />
        <SubmittedReports reports={detail.reports} />
      </div>
      <div className="min-w-0 bg-background p-5 sm:p-6">
        <RubricForm value={draft} onChange={setDraft} />
        {saveError ? <div role="alert" className="mt-5 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{saveError}</div> : null}
      </div>
    </div> : null}
  </Dialog>;
}

function ReviewWorkspaceSkeleton() {
  return <div className="grid min-h-[34rem] lg:grid-cols-[1.3fr_.7fr]">
    <div className="space-y-5 bg-slate-950 p-5"><Skeleton className="aspect-video w-full bg-slate-800" /><Skeleton className="h-28 bg-slate-800" /></div>
    <div className="space-y-4 p-6"><Skeleton className="h-8 w-48" />{[1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-24" />)}</div>
  </div>;
}

function RecordingPanel({ url }: { url: string | null }) {
  if (!url) return <div className="grid aspect-video place-items-center rounded-2xl border border-rose-400/30 bg-slate-900 p-8 text-center">
    <div><Video className="mx-auto size-8 text-rose-300" /><div className="mt-3 font-black">Recording missing</div><p className="mt-1 text-sm text-slate-400">The interviewee report does not contain a recording.</p></div>
  </div>;
  if (!isPlayableRecording(url)) return <div className="grid aspect-video place-items-center rounded-2xl border border-white/10 bg-slate-900 p-8 text-center">
    <div><ExternalLink className="mx-auto size-8 text-western-300" /><div className="mt-3 font-black">External recording</div><p className="mt-1 max-w-md text-sm text-slate-400">This provider cannot be played safely inside the dashboard.</p><a href={url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-western-400 px-4 py-2.5 text-sm font-black text-slate-950">Open recording <ExternalLink className="size-4" /></a></div>
  </div>;
  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
    <video key={url} controls preload="metadata" playsInline className="aspect-video w-full bg-black" src={url}>Your browser cannot play this recording.</video>
  </div>;
}

function isPlayableRecording(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/recordings/')
      || /\.(mp4|webm|mov|mkv)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function SessionContext({ detail }: { detail: ReviewDetail }) {
  const { session } = detail;
  return <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2">
    <ContextItem label="Interviewee" value={session.interviewee_name} />
    <ContextItem label="Interviewer" value={session.interviewer_name} />
    <ContextItem label="Problem" value={session.problem_title ? `${session.problem_number ? `#${session.problem_number} · ` : ''}${session.problem_title}` : 'Not recorded'} />
    <ContextItem label="Scheduled" value={session.scheduled_at ? formatDate(session.scheduled_at) : 'Not recorded'} />
  </div>;
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[0.65rem] font-black uppercase tracking-[0.15em] text-slate-500">{label}</div><div className="mt-1 text-sm font-bold text-slate-100">{value}</div></div>;
}

function SubmittedReports({ reports }: { reports: ReviewReport[] }) {
  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
    <div className="border-b border-white/10 px-4 py-3"><h3 className="text-sm font-black">Submitted reports</h3><p className="mt-0.5 text-xs text-slate-400">Use both perspectives as context; the recording remains the primary evidence.</p></div>
    <Accordion type="multiple" defaultValue={reports.filter((report) => report.submittedAt).map((report) => report.kind)}>
      {reports.map((report) => <AccordionItem key={report.id} value={report.kind} className="border-white/10 px-4">
        <AccordionTrigger className="text-slate-100 hover:no-underline"><span><span className="font-bold">{report.kind === 'interviewer_report' ? 'Interviewer report' : 'Interviewee report'}</span><span className="ml-2 text-xs font-normal text-slate-400">{report.submittedAt ? `Submitted ${formatDate(report.submittedAt)}` : 'Not submitted'}</span></span></AccordionTrigger>
        <AccordionContent className="space-y-3">
          {report.submittedAt ? report.answers.filter((answer) => answer.id !== 'video_url').map((answer) => <ReportAnswer key={answer.id} answer={answer} />) : <p className="pb-2 text-sm text-rose-300">This report has not been submitted.</p>}
        </AccordionContent>
      </AccordionItem>)}
    </Accordion>
  </div>;
}

function ReportAnswer({ answer }: { answer: ReviewReport['answers'][number] }) {
  const long = answer.type === 'textarea' || answer.id === 'code' || answer.value.length > 160;
  return <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
    <div className="text-xs font-bold text-slate-400">{answer.label}</div>
    {long ? <pre className={`mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-100 ${answer.id === 'code' ? 'font-mono' : 'font-sans'}`}>{answer.value}</pre> : <div className="mt-1 text-sm font-semibold text-slate-100">{answer.value}</div>}
  </div>;
}

function RubricForm({ value, onChange }: { value: RubricDraft; onChange: (value: RubricDraft) => void }) {
  const update = <K extends keyof RubricDraft>(key: K, next: RubricDraft[K]) => onChange({ ...value, [key]: next });
  return <div>
    <div><div className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-western-700">Organizer rubric</div><h2 className="mt-2 text-2xl font-black tracking-tight text-foreground">Assess the recording</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Rate what the video demonstrates. Save a draft at any point; completing the review requires every category.</p></div>
    <div className="mt-6 space-y-5">
      <RatingField label="Session completion" description="How much of a genuine technical interview was completed?" value={value.completionRating} onChange={(rating) => update('completionRating', rating)} labels={['Not completed', 'Partial', 'Mostly complete', 'Complete']} />
      <RatingField label="Communication" description="Clarity of thought process, questions, and explanations." value={value.communicationRating} onChange={(rating) => update('communicationRating', rating)} />
      <RatingField label="Problem solving" description="Progress from understanding through a defensible approach." value={value.problemSolvingRating} onChange={(rating) => update('problemSolvingRating', rating)} />
      <RatingField label="Implementation" description="Quality and completeness of the code attempted in-session." value={value.implementationRating} onChange={(rating) => update('implementationRating', rating)} />
      <RatingField label="Testing and complexity" description="Attention to examples, edge cases, and runtime trade-offs." value={value.testingRating} onChange={(rating) => update('testingRating', rating)} />
      <RatingField label="Recording quality" description="Whether the recording provides enough clear evidence to assess." value={value.recordingQuality} onChange={(rating) => update('recordingQuality', rating)} labels={['Unusable', 'Limited', 'Usable', 'Clear']} />
      <label className="block rounded-2xl border border-border bg-card p-4"><span className="text-sm font-black text-foreground">Internal review notes</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Required when marking a review for follow-up. Participants cannot see this.</span><Textarea value={value.notes} maxLength={4000} onChange={(event) => update('notes', event.target.value)} className="mt-3 min-h-32 resize-y rounded-xl" placeholder="Capture evidence, follow-up questions, or the reason for your decision…" /><span className="mt-1 block text-right text-xs tabular-nums text-muted-foreground">{value.notes.length}/4000</span></label>
    </div>
  </div>;
}

function RatingField({ label, description, value, onChange, labels = ['Insufficient', 'Developing', 'Meets', 'Strong'] }: { label: string; description: string; value: number | null; onChange: (value: number) => void; labels?: string[] }) {
  return <fieldset className="rounded-2xl border border-border bg-card p-4">
    <legend className="sr-only">{label}</legend>
    <div className="text-sm font-black text-foreground">{label}</div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    <RadioGroup value={value ? String(value) : ''} onValueChange={(next) => onChange(Number(next))} className="mt-4 grid grid-cols-2 gap-2">
      {labels.map((option, index) => {
        const rating = index + 1;
        return <label key={option} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${value === rating ? 'border-western-500 bg-western-50 text-western-900 dark:bg-western-950/40 dark:text-western-200' : 'border-border bg-background text-muted-foreground hover:border-western-300 hover:text-foreground'}`}>
          <RadioGroupItem value={String(rating)} />{option}
        </label>;
      })}
    </RadioGroup>
  </fieldset>;
}

function rubricFromDetail(detail: ReviewDetail): RubricDraft {
  const rubric = detail.rubric;
  return rubric ? {
    completionRating: rubric.completion_rating,
    communicationRating: rubric.communication_rating,
    problemSolvingRating: rubric.problem_solving_rating,
    implementationRating: rubric.implementation_rating,
    testingRating: rubric.testing_rating,
    recordingQuality: rubric.recording_quality,
    notes: rubric.notes,
  } : emptyRubric;
}

function rubricComplete(value: RubricDraft) {
  return [value.completionRating, value.communicationRating, value.problemSolvingRating, value.implementationRating, value.testingRating, value.recordingQuality]
    .every((rating) => rating !== null);
}
