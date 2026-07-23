import { useEffect, useMemo, useState } from 'react';
import type { ProblemRow, ProblemsData } from '../../admin-types';
import { adminRequest, sendPacketPreview } from '../../api';
import {
  Badge, Button, Dialog, DialogClose, EmptyState, ErrorState, inputClass,
  LoadingState, PageIntro, Panel, tableClass, tableWrapClass, tdClass, thClass, Tabs,
} from '../../components/AdminUI';
import { ProblemEditor } from '../../components/admin/ProblemEditor';
import { Checkbox } from '../../components/ui/checkbox';
import { ScrollArea } from '../../components/ui/scroll-area';
import { useAdminData } from '../../hooks/useAdminData';
import { SelectControl } from '../../components/SelectControl';
import { ProblemContentSection } from '../../components/ProblemContentSection';
import { createBlankProblem, type EditableProblem } from '../../lib/problem-editor';

export function ProblemsPage() {
  const { data, error, loading, reload } = useAdminData<ProblemsData>('/problems');
  const [tab, setTab] = useState('sets');
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('all');
  const [editor, setEditor] = useState<EditableProblem | null>(null);
  const [preview, setPreview] = useState<ProblemRow | null>(null);
  const [pendingPreviewId, setPendingPreviewId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => (data?.problems ?? []).filter((problem) =>
    (difficulty === 'all' || problem.difficulty === difficulty)
    && (!query.trim() || `${problem.number ?? ''} ${problem.title}`.toLowerCase().includes(query.trim().toLowerCase())),
  ), [data, difficulty, query]);

  useEffect(() => {
    if (!pendingPreviewId || !data) return;
    const created = data.problems.find((problem) => problem.id === pendingPreviewId);
    if (!created) return;
    setPreview(created);
    setPendingPreviewId(null);
  }, [data, pendingPreviewId]);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No question data returned.'} onRetry={() => void reload()} />;

  const save = async (problem: EditableProblem) => {
    setBusy(true);
    try {
      const existing = 'id' in problem;
      const response = await adminRequest<{ id?: number }>(existing ? `/problems/${problem.id}` : '/problems', {
        method: 'POST',
        body: JSON.stringify({
          source: problem.source, number: problem.number, title: problem.title, url: problem.url,
          difficulty: problem.difficulty, difficultyRank: problem.difficulty_rank,
          statementMarkdown: problem.statement_md,
          interviewerNotesMarkdown: problem.interviewer_notes_md,
          execution: problem.execution,
          availableWeeks: problem.available_weeks,
          active: Boolean(problem.active),
        }),
      });
      setEditor(null);
      setNotice(existing ? 'Question saved.' : 'Question added. You can create a session from its preview.');
      if (!existing && response.id) setPendingPreviewId(response.id);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-7">
    <PageIntro
      title="Question bank"
      description="Build reusable interview questions with private notes and optional portable test suites, then tag the rounds where they may appear."
      actions={<Button onClick={() => setEditor(createBlankProblem())}>Add question</Button>}
    />
    {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div> : null}
    <div className="flex"><Tabs value={tab} onChange={setTab} items={[
      { value: 'sets', label: 'Round sets', count: data.weeks.length },
      { value: 'library', label: 'Question library', count: data.problems.length },
    ]} /></div>
    {tab === 'sets'
      ? <RoundSets data={data} reload={reload} onNotice={setNotice} onPreview={setPreview} />
      : <Panel>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <input className={`${inputClass} sm:max-w-sm`} type="search" placeholder="Search title or number…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <SelectControl label="Filter by difficulty" className="sm:w-40" value={difficulty} onChange={setDifficulty} options={[{ value: 'all', label: 'All difficulties' }, { value: 'easy', label: 'easy' }, { value: 'medium', label: 'medium' }, { value: 'hard', label: 'hard' }]} />
          <div className="self-center text-xs font-semibold text-slate-500 sm:ml-auto">{rows.length} questions</div>
        </div>
        {rows.length ? <div className={tableWrapClass}><table className={tableClass}>
          <thead><tr><th className={thClass}>Question</th><th className={thClass}>Available</th><th className={thClass}>Difficulty</th><th className={thClass}>Usage</th><th className={thClass}>State</th><th className={thClass}></th></tr></thead>
          <tbody>{rows.map((problem) => <tr key={problem.id}>
            <td className={tdClass}><div className="font-bold text-slate-950">{problem.number ? `#${problem.number} · ` : ''}{problem.title}</div><div className="mt-0.5 text-xs text-slate-400">{problem.source} · {problem.execution.mode === 'stdin_tests' ? `${problem.execution.testCases.length} automated tests` : 'discussion only'}</div></td>
            <td className={tdClass}><WeekTags weeks={problem.available_weeks} /></td>
            <td className={tdClass}><Badge value={problem.difficulty} />{problem.difficulty_rank != null ? <span className="ml-2 text-xs font-bold tabular-nums text-slate-400">{problem.difficulty_rank}</span> : null}</td>
            <td className={tdClass}><span className="font-bold tabular-nums text-slate-800">{problem.uses}</span><span className="ml-1 text-xs">sessions</span></td>
            <td className={tdClass}><Badge value={problem.active ? 'active' : 'inactive'} /></td>
            <td className={`${tdClass} text-right`}><div className="flex items-center justify-end gap-3"><button className="cursor-pointer text-sm font-bold text-slate-600 transition hover:text-slate-950 dark:text-slate-300 dark:hover:text-white" onClick={() => setPreview(problem)}>Preview</button><button className="cursor-pointer text-sm font-bold text-western-700 transition hover:text-western-800 dark:text-western-300 dark:hover:text-western-200" onClick={() => setEditor(problem)}>Edit</button></div></td>
          </tr>)}</tbody>
        </table></div> : <EmptyState title="No questions match" description="Change the filters or add a question." />}
      </Panel>}
    {editor ? <ProblemEditor value={editor} weeks={data.weeks.map((week) => week.idx)} busy={busy} onClose={() => setEditor(null)} onSave={save} /> : null}
    {preview ? <QuestionPreview problem={preview} weeks={data.weeks} participants={data.participants} reload={reload} onClose={() => setPreview(null)} /> : null}
  </div>;
}

function QuestionPreview({ problem, weeks, participants, reload, onClose }: { problem: ProblemRow; weeks: ProblemsData['weeks']; participants: ProblemsData['participants']; reload: () => Promise<void>; onClose: () => void }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendToDiscord = async () => {
    setSending(true);
    setError(null);
    try {
      await sendPacketPreview(problem.id);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the packet.');
    } finally {
      setSending(false);
    }
  };
  return <Dialog
    wide
    title={`${problem.number ? `#${problem.number} · ` : ''}${problem.title}`}
    description="Participant-facing interviewer packet preview"
    onClose={onClose}
    actions={<>
      {error ? <span className="mr-auto self-center text-sm font-semibold text-red-600 dark:text-red-400">{error}</span> : null}
      <Button variant="secondary" disabled={sending || sent} onClick={() => void sendToDiscord()}>
        {sent ? 'Sent to your DMs ✓' : sending ? 'Sending…' : 'DM me this packet'}
      </Button>
      <DialogClose><Button variant="secondary">Close preview</Button></DialogClose>
    </>}
  >
    <div className="mb-5 flex flex-wrap items-center gap-2"><Badge value={problem.difficulty} /><WeekTags weeks={problem.available_weeks} />{problem.active ? null : <Badge value="inactive" />}{problem.url ? <a href={problem.url} target="_blank" rel="noreferrer" className="ml-auto font-bold text-western-700 underline decoration-western-300 underline-offset-4 dark:text-western-300">Open on LeetCode ↗</a> : null}</div>
    <div className="min-w-0 space-y-5">
      <ProblemContentSection title="Statement" value={problem.statement_md?.trim() || 'No statement has been added yet.'} />
      <ProblemContentSection title="Interviewer notes" value={problem.interviewer_notes_md.trim() || 'No interviewer notes have been added yet.'} />
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-card-foreground"><div className="font-black">Test harness</div><div className="mt-1 text-muted-foreground">{problem.execution.mode === 'stdin_tests' ? `${problem.execution.testCases.length} tests · ${problem.execution.languages.join(', ')}` : 'Discussion only'}</div></div>
      <ProblemSessionCreator problem={problem} weeks={weeks} participants={participants} reload={reload} />
    </div>
  </Dialog>;
}

function ProblemSessionCreator({ problem, weeks, participants, reload }: { problem: ProblemRow; weeks: ProblemsData['weeks']; participants: ProblemsData['participants']; reload: () => Promise<void> }) {
  const empty = '__none';
  const eligibleWeeks = weeks.filter((week) => problem.available_weeks.includes(week.idx));
  const [weekId, setWeekId] = useState(String(eligibleWeeks[0]?.id ?? empty));
  const [interviewerId, setInterviewerId] = useState(empty);
  const [intervieweeId, setIntervieweeId] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const participantOptions = participants.map((participant) => ({
    value: String(participant.id),
    label: `${participant.name ?? 'Unnamed'}${participant.discord_username ? ` · @${participant.discord_username}` : ''}`,
  }));
  const selected = {
    week: weekId !== empty,
    interviewer: interviewerId !== empty,
    interviewee: intervieweeId !== empty,
  };
  const canSubmit = selected.week && selected.interviewer && selected.interviewee && interviewerId !== intervieweeId && !busy;
  const create = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await adminRequest<{ sessionId: number }>(`/problems/${problem.id}/session`, {
        method: 'POST',
        body: JSON.stringify({ weekId: Number(weekId), interviewerId: Number(interviewerId), intervieweeId: Number(intervieweeId) }),
      });
      setResult(`Session #${response.sessionId} created. Thread and DMs are queued.`);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the session.');
    } finally {
      setBusy(false);
    }
  };
  return <section className="rounded-2xl border border-western-200 bg-western-50/70 p-4 text-sm dark:border-western-900/60 dark:bg-western-950/20">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="font-black text-foreground">Create a session with this question</div>
        <p className="mt-1 text-muted-foreground">Creates a real organizer-arranged session and pins this packet to the interviewer.</p>
      </div>
      {result ? <Badge value="queued" /> : null}
    </div>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <SelectControl label="Round" value={weekId} onChange={setWeekId} options={[{ value: empty, label: 'Choose round' }, ...eligibleWeeks.map((week) => ({ value: String(week.id), label: `Round ${week.idx}` }))]} />
      <SelectControl label="Interviewer" value={interviewerId} onChange={setInterviewerId} options={[{ value: empty, label: 'Choose interviewer' }, ...participantOptions]} />
      <SelectControl label="Interviewee" value={intervieweeId} onChange={setIntervieweeId} options={[{ value: empty, label: 'Choose interviewee' }, ...participantOptions]} />
    </div>
    {error ? <p className="mt-3 font-semibold text-rose-700 dark:text-rose-300">{error}</p> : null}
    {result ? <p className="mt-3 font-semibold text-emerald-700 dark:text-emerald-300">{result}</p> : null}
    <div className="mt-4 flex justify-end">
      <Button disabled={!canSubmit} onClick={() => void create()}>{busy ? 'Creating…' : 'Create session'}</Button>
    </div>
  </section>;
}

function RoundSets({ data, reload, onNotice, onPreview }: { data: ProblemsData; reload: () => Promise<void>; onNotice: (notice: string) => void; onPreview: (problem: ProblemRow) => void }) {
  const [weekId, setWeekId] = useState(data.weeks[0]?.id ?? 0);
  const [draft, setDraft] = useState<number[]>([]);
  const [size, setSize] = useState(5);
  const [busy, setBusy] = useState(false);
  const saved = useMemo(() => data.sets.filter((row) => row.week_id === weekId).map((row) => row.problem_id), [data.sets, weekId]);
  useEffect(() => setDraft(saved), [saved]);
  const selectedWeek = data.weeks.find((week) => week.id === weekId);
  const available = data.problems.filter((problem) => problem.active && problem.available_weeks.includes(selectedWeek?.idx ?? 0));
  const savedSet = new Set(saved);
  const dirty = draft.length !== saved.length || draft.some((id) => !savedSet.has(id));
  if (!data.cohort || !data.weeks.length) return <Panel><EmptyState title="No active cohort" description="Create a cohort calendar before staging round sets." /></Panel>;
  const toggle = (id: number) => setDraft((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const save = async () => {
    setBusy(true);
    try {
      await adminRequest(`/problem-sets/${weekId}`, { method: 'PUT', body: JSON.stringify({ problemIds: draft }) });
      await reload();
      onNotice(`Round ${selectedWeek?.idx} set saved with ${draft.length} question${draft.length === 1 ? '' : 's'}.`);
    } finally { setBusy(false); }
  };
  const generate = async () => {
    setBusy(true);
    try {
      await adminRequest(`/problem-sets/${weekId}/generate`, { method: 'POST', body: JSON.stringify({ size }) });
      await reload();
      onNotice(`Round ${selectedWeek?.idx} set auto-filled from its tagged questions.`);
    } finally { setBusy(false); }
  };
  return <Panel
    title={`${data.cohort.name} · Round ${selectedWeek?.idx ?? '—'}`}
    description={`Only active questions tagged for round ${selectedWeek?.idx ?? '—'} are shown. Future round sets can be staged now.`}
    actions={<div className="flex items-center gap-2"><SelectControl label="Auto-fill size" className="w-20" value={String(size)} onChange={(value) => setSize(Number(value))} options={[3, 4, 5, 6, 8, 10].map((value) => ({ value: String(value), label: String(value) }))} /><Button variant="secondary" disabled={busy || !available.length} onClick={() => void generate()}>Auto-fill</Button><Button disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save set'}</Button></div>}
  >
    <div className="border-b border-slate-100 p-4"><Tabs value={String(weekId)} onChange={(value) => setWeekId(Number(value))} items={data.weeks.map((week) => ({ value: String(week.id), label: `Round ${week.idx}`, count: data.sets.filter((row) => row.week_id === week.id).length }))} /></div>
    {available.length ? <ScrollArea className="h-[min(58vh,38rem)]"><div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">{available.map((problem) => {
      const checked = draft.includes(problem.id);
      return <div key={problem.id} className={`flex items-start gap-3 rounded-xl border p-3 transition ${checked ? 'border-western-300 bg-western-50 dark:bg-western-950/30' : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-border dark:bg-card dark:hover:bg-muted/50'}`}>
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
          <Checkbox className="mt-0.5" checked={checked} onCheckedChange={() => toggle(problem.id)} />
          <span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-900 dark:text-foreground">{problem.number ? `#${problem.number} · ` : ''}{problem.title}</span><span className="mt-1 flex items-center gap-2"><Badge value={problem.difficulty} /><span className="text-xs text-slate-500 dark:text-muted-foreground">rank {problem.difficulty_rank ?? 'default'} · {problem.uses} uses</span></span></span>
        </label>
        <button type="button" className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs font-bold text-western-700 transition hover:bg-western-100 hover:text-western-900 dark:text-western-300 dark:hover:bg-western-950/50" onClick={() => onPreview(problem)}>Preview</button>
      </div>;
    })}</div></ScrollArea> : <EmptyState title={`No questions tagged for round ${selectedWeek?.idx}`} description="Edit a question and add this round under Available rounds." />}
  </Panel>;
}

function WeekTags({ weeks }: { weeks: number[] }) {
  return <div className="flex flex-wrap gap-1">{weeks.map((week) => <span key={week} className="rounded-md bg-western-50 px-2 py-1 text-[0.68rem] font-black text-western-800">R{week}</span>)}</div>;
}
