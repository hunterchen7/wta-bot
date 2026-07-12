import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useBlocker, useParams, useSearchParams } from 'react-router-dom';
import { adminRequest, publicRequest, SettingsSaveError } from '../api';
import { PublicShell } from '../components/PublicShell';
import { CodeEditor } from '../components/CodeEditor';
import { VideoUploadField } from '../components/VideoUploadField';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';

export type ReportField = { id: string; label: string; type: 'radio' | 'select' | 'scale' | 'text' | 'textarea' | 'url'; options?: Array<{ value: string; label: string }>; required?: boolean; shared?: boolean; help?: string; mono?: boolean; low?: string; high?: string };
export type ReportData = { preview?: boolean; id: number; kind: string; round: number; role: string; assigneeName: string | null; partnerName: string | null; scheduledAt: string | null; deadlineAt: string; submittedAt: string | null; overdue: boolean; fields: ReportField[]; values: Record<string, string> };

export function ReportPage({ previewKind }: { previewKind?: string }) {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const embedded = Boolean(previewKind && searchParams.get('embed') === '1');
  const [data, setData] = useState<ReportData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState('{}');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = useMemo(() => !previewKind && JSON.stringify(values) !== baseline, [values, baseline, previewKind]);
  const blocker = useBlocker(dirty && !saved);

  useEffect(() => {
    const request = previewKind
      ? adminRequest<ReportData>(`/previews/${previewKind}`)
      : publicRequest<ReportData>(`/forms/${token}`);
    request.then((result) => { setData(result); setValues(result.values); setBaseline(JSON.stringify(result.values)); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open this report.'));
  }, [previewKind, token]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty && !saved) event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saved]);

  const set = (id: string, value: string) => { setSaved(false); setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))); setValues((current) => ({ ...current, [id]: value })); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (previewKind) return;
    setBusy(true); setError(''); setFieldErrors({});
    try {
      await publicRequest(`/forms/${token}`, { method: 'POST', body: JSON.stringify(values) });
      setBaseline(JSON.stringify(values)); setSaved(true); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      if (cause instanceof SettingsSaveError) {
        setFieldErrors(cause.fieldErrors); setError(cause.message);
        const first = Object.keys(cause.fieldErrors)[0];
        if (first) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-report-field="${first}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      } else setError('Could not submit this report.');
    } finally { setBusy(false); }
  };

  if (error && !data) return <ReportShell embedded={embedded}><StateCard title="This form can’t be opened" text={error} /></ReportShell>;
  if (!data) return <ReportShell embedded={embedded}><div className="animate-pulse space-y-5"><div className="h-28 rounded-3xl bg-slate-200" /><div className="h-96 rounded-3xl bg-slate-200" /></div></ReportShell>;

  return <ReportShell embedded={embedded}>
    <ReportIntro data={data} preview={Boolean(previewKind)} />
    {saved ? <div role="status" className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><div className="font-black">Report saved.</div><p className="mt-1 text-sm">Your credit and downstream notifications are being updated. You can keep this link and revise before the deadline.</p></div> : null}
    {data.submittedAt && !saved ? <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">Submitted {formatDate(data.submittedAt)}. Saving again replaces the prior answers.</div> : null}
    {data.overdue ? <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">This report is overdue. Submit it as soon as possible—credit remains on hold until it arrives.</div> : null}
    {previewKind ? <div className="mb-6 rounded-2xl border border-western-200 bg-western-50 p-4 text-sm font-semibold text-western-900">Preview mode: interact with the fields to inspect the experience; nothing can be submitted.</div> : null}
    {error ? <div role="alert" className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">{error}</div> : null}
    <form onSubmit={submit} className="space-y-4">{data.fields.map((field, index) => <ReportFieldInput key={field.id} field={field} value={values[field.id] ?? ''} error={fieldErrors[field.id]} index={index + 1} token={token} preview={Boolean(previewKind)} onChange={(value) => set(field.id, value)} />)}
      <div className={`${previewKind ? '' : 'sticky bottom-4 z-20 shadow-xl backdrop-blur'} rounded-2xl border border-slate-200 bg-white/95 p-3`}><Button size="lg" disabled={Boolean(previewKind) || busy || (!dirty && Boolean(data.submittedAt))} className="h-12 w-full cursor-pointer rounded-xl font-black disabled:cursor-not-allowed">{previewKind ? 'Submission disabled in preview' : busy ? 'Saving report…' : data.submittedAt ? 'Save revised report' : 'Submit report'}</Button></div>
    </form>
    {blocker.state === 'blocked' ? <LeaveDialog onStay={() => blocker.reset()} onLeave={() => blocker.proceed()} /> : null}
  </ReportShell>;
}

function ReportIntro({ data, preview }: { data: ReportData; preview: boolean }) {
  const interviewer = data.role === 'interviewer';
  return <header className="mb-8">
    <div className="text-[0.68rem] font-black uppercase tracking-[0.2em] text-western-700">{preview ? 'Read-only preview' : `Round ${data.round} report`}</div>
    <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-5xl">{interviewer ? 'Interviewer' : 'Interviewee'} report</h1>
    <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">Hi {data.assigneeName ?? 'there'}. {interviewer ? 'Review how the interview went and give your interviewee clear, useful feedback.' : 'Reflect on the interview while the details are fresh and tell us about your experience.'}</p>
    <dl className="mt-5 grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.025)] sm:grid-cols-3 dark:border-border dark:bg-card">
      <ReportMeta label={interviewer ? 'Interviewee' : 'Interviewer'} value={data.partnerName ?? 'Your partner'} />
      <ReportMeta label="Session" value={data.scheduledAt ? formatDate(data.scheduledAt) : 'Time not recorded'} dateTime={data.scheduledAt} />
      <ReportMeta label={data.overdue ? 'Overdue since' : 'Report due'} value={formatDate(data.deadlineAt)} dateTime={data.deadlineAt} urgent={data.overdue} />
    </dl>
  </header>;
}

function ReportMeta({ label, value, dateTime, urgent = false }: { label: string; value: string; dateTime?: string | null; urgent?: boolean }) {
  return <div className="border-b border-slate-100 px-4 py-3.5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 dark:border-border">
    <dt className={`text-[0.65rem] font-black uppercase tracking-[0.14em] ${urgent ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>{label}</dt>
    <dd className={`mt-1 text-sm font-bold leading-5 ${urgent ? 'text-rose-800 dark:text-rose-300' : 'text-slate-800'}`}>{dateTime ? <time dateTime={dateTime}>{value}</time> : value}</dd>
  </div>;
}

function ReportShell({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return embedded ? <main className="min-h-screen bg-background px-4 py-6 dark:bg-background sm:px-6"><div className="mx-auto max-w-3xl">{children}</div></main> : <PublicShell narrow>{children}</PublicShell>;
}

function ReportFieldInput({ field, value, error, index, token, preview, onChange }: { field: ReportField; value: string; error?: string; index: number; token?: string; preview: boolean; onChange: (value: string) => void }) {
  const shell = `rounded-2xl border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.025)] ${error ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'}`;
  const head = <><div className="flex items-start gap-3"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[0.68rem] font-black text-slate-500">{index}</span><div><div className="text-sm font-extrabold leading-6 text-slate-900">{field.label}{field.required ? <span className="ml-1 text-rose-600">*</span> : null}</div>{field.help ? <p className="mt-1 text-xs leading-5 text-slate-500">{field.help}</p> : null}</div></div></>;
  const alert = error ? <p role="alert" className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null;
  if (field.type === 'radio' || field.type === 'scale') {
    const options = field.type === 'scale' ? [1, 2, 3, 4, 5].map((number) => ({ value: String(number), label: String(number) })) : field.options ?? [];
    return <fieldset data-report-field={field.id} className={shell}>{head}<RadioGroup required={field.required} value={value} onValueChange={onChange} className={`mt-4 ${field.type === 'scale' ? 'grid-cols-5' : 'sm:grid-cols-2'}`}>{options.map((option) => <label key={option.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm font-bold transition ${field.type === 'scale' ? 'justify-center' : ''} ${value === option.value ? 'border-primary bg-primary/5 text-foreground shadow-sm' : 'border-input text-muted-foreground hover:border-primary/40 hover:bg-accent/50'}`}><RadioGroupItem value={option.value} aria-label={option.label} />{option.label}</label>)}</RadioGroup>{field.type === 'scale' ? <div className="mt-2 flex justify-between text-xs font-semibold text-slate-400"><span>{field.low}</span><span>{field.high}</span></div> : null}{alert}</fieldset>;
  }
  return <div data-report-field={field.id} className={`${shell} block`}>{head}<div className="mt-4">{field.id === 'video_url' ? <VideoUploadField token={token} value={value} preview={preview} invalid={Boolean(error)} onChange={onChange} /> : field.type === 'select' ? <Select required={field.required} value={value || undefined} onValueChange={onChange}><SelectTrigger aria-invalid={Boolean(error)} className="h-11 w-full cursor-pointer rounded-xl bg-background"><SelectValue placeholder="Choose an option…" /></SelectTrigger><SelectContent position="popper" align="start" className="min-w-[var(--radix-select-trigger-width)]">{field.options?.map((option) => <SelectItem key={option.value} value={option.value} className="cursor-pointer py-2.5">{option.label}</SelectItem>)}</SelectContent></Select> : field.type === 'textarea' && field.mono ? <CodeEditor value={value} invalid={Boolean(error)} onChange={onChange} /> : field.type === 'textarea' ? <Textarea aria-invalid={Boolean(error)} required={field.required} rows={5} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-32 resize-y rounded-xl bg-background" /> : <Input aria-invalid={Boolean(error)} required={field.required} type={field.type === 'url' ? 'url' : 'text'} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl bg-background" />}</div>{alert}</div>;
}

function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-labelledby="leave-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="leave-title" className="text-xl font-black text-slate-950">Leave with unsaved answers?</h2><p className="mt-2 text-sm leading-6 text-slate-600">Changes on this report have not been submitted.</p><div className="mt-6 flex justify-end gap-2"><Button variant="outline" className="cursor-pointer" onClick={onStay}>Stay here</Button><Button variant="destructive" className="cursor-pointer" onClick={onLeave}>Discard changes</Button></div></div></div>; }
function StateCard({ title, text }: { title: string; text: string }) { return <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black text-slate-950">{title}</h1><p className="mt-3 text-slate-600">{text}</p></div>; }
const formatDate = (value: string) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Toronto' }).format(new Date(value));
