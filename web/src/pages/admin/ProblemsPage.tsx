import { useEffect, useMemo, useState } from 'react';
import type { ProblemRow, ProblemsData } from '../../admin-types';
import { adminRequest } from '../../api';
import {
  Badge, Button, Dialog, DialogClose, EmptyState, ErrorState, inputClass,
  LoadingState, PageIntro, Panel, tableClass, tableWrapClass, tdClass, thClass, Tabs,
} from '../../components/AdminUI';
import { Checkbox } from '../../components/ui/checkbox';
import { ScrollArea } from '../../components/ui/scroll-area';
import { useAdminData } from '../../hooks/useAdminData';
import { SelectControl } from '../../components/SelectControl';
import { ProblemContentSection } from '../../components/ProblemContentSection';

const QUESTION_TEMPLATE = `## Statement



## Hints

1.

## Solution

`;

const blankProblem: Omit<ProblemRow, 'id' | 'uses' | 'exposures'> = {
  source: 'manual', number: null, title: '', url: null, difficulty: 'medium',
  difficulty_rank: 2, content_md: QUESTION_TEMPLATE, available_weeks: [2],
  statement_md: null, hints_md: null, solution_md: null, active: 1,
};

export function ProblemsPage() {
  const { data, error, loading, reload } = useAdminData<ProblemsData>('/problems');
  const [tab, setTab] = useState('sets');
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('all');
  const [editor, setEditor] = useState<ProblemRow | typeof blankProblem | null>(null);
  const [preview, setPreview] = useState<ProblemRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => (data?.problems ?? []).filter((problem) =>
    (difficulty === 'all' || problem.difficulty === difficulty)
    && (!query.trim() || `${problem.number ?? ''} ${problem.title}`.toLowerCase().includes(query.trim().toLowerCase())),
  ), [data, difficulty, query]);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No question data returned.'} onRetry={() => void reload()} />;

  const save = async (problem: ProblemRow | typeof blankProblem) => {
    setBusy(true);
    try {
      const existing = 'id' in problem;
      await adminRequest(existing ? `/problems/${problem.id}` : '/problems', {
        method: 'POST',
        body: JSON.stringify({
          source: problem.source, number: problem.number, title: problem.title, url: problem.url,
          difficulty: problem.difficulty, difficultyRank: problem.difficulty_rank,
          content: problem.content_md, availableWeeks: problem.available_weeks,
          active: Boolean(problem.active),
        }),
      });
      setEditor(null);
      setNotice(existing ? 'Question saved.' : 'Question added.');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-7">
    <PageIntro
      title="Question bank"
      description="Author each question as one Markdown document, then tag the rounds where it may appear."
      actions={<Button onClick={() => setEditor({ ...blankProblem })}>Add question</Button>}
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
            <td className={tdClass}><div className="font-bold text-slate-950">{problem.number ? `#${problem.number} · ` : ''}{problem.title}</div><div className="mt-0.5 text-xs text-slate-400">{problem.source} · Markdown</div></td>
            <td className={tdClass}><WeekTags weeks={problem.available_weeks} /></td>
            <td className={tdClass}><Badge value={problem.difficulty} />{problem.difficulty_rank != null ? <span className="ml-2 text-xs font-bold tabular-nums text-slate-400">{problem.difficulty_rank}</span> : null}</td>
            <td className={tdClass}><span className="font-bold tabular-nums text-slate-800">{problem.uses}</span><span className="ml-1 text-xs">sessions</span></td>
            <td className={tdClass}><Badge value={problem.active ? 'active' : 'inactive'} /></td>
            <td className={`${tdClass} text-right`}><div className="flex items-center justify-end gap-3"><button className="cursor-pointer text-sm font-bold text-slate-600 transition hover:text-slate-950 dark:text-slate-300 dark:hover:text-white" onClick={() => setPreview(problem)}>Preview</button><button className="cursor-pointer text-sm font-bold text-western-700 transition hover:text-western-800 dark:text-western-300 dark:hover:text-western-200" onClick={() => setEditor(problem)}>Edit</button></div></td>
          </tr>)}</tbody>
        </table></div> : <EmptyState title="No questions match" description="Change the filters or add a question." />}
      </Panel>}
    {editor ? <QuestionEditor value={editor} weeks={data.weeks.map((week) => week.idx)} busy={busy} onClose={() => setEditor(null)} onSave={save} /> : null}
    {preview ? <QuestionPreview problem={preview} onClose={() => setPreview(null)} /> : null}
  </div>;
}

function QuestionPreview({ problem, onClose }: { problem: ProblemRow; onClose: () => void }) {
  return <Dialog
    wide
    title={`${problem.number ? `#${problem.number} · ` : ''}${problem.title}`}
    description="Participant-facing interviewer packet preview"
    onClose={onClose}
    actions={<DialogClose><Button variant="secondary">Close preview</Button></DialogClose>}
  >
    <div className="mb-5 flex flex-wrap items-center gap-2"><Badge value={problem.difficulty} /><WeekTags weeks={problem.available_weeks} />{problem.active ? null : <Badge value="inactive" />}{problem.url ? <a href={problem.url} target="_blank" rel="noreferrer" className="ml-auto font-bold text-western-700 underline decoration-western-300 underline-offset-4 dark:text-western-300">Open on LeetCode ↗</a> : null}</div>
    <div className="min-w-0 space-y-5">
      <ProblemContentSection title="Statement" value={problem.statement_md?.trim() || 'No statement has been added yet.'} />
      <ProblemContentSection title="Hint ladder" value={problem.hints_md?.trim() || 'No hints have been added yet.'} />
      <ProblemContentSection title="Solution" value={problem.solution_md?.trim() || 'No solution notes have been added yet.'} />
    </div>
  </Dialog>;
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

function QuestionEditor({ value, weeks, busy, onClose, onSave }: { value: ProblemRow | typeof blankProblem; weeks: number[]; busy: boolean; onClose: () => void; onSave: (value: ProblemRow | typeof blankProblem) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const update = (key: string, next: unknown) => setDraft((current) => ({ ...current, [key]: next }));
  const weekOptions = [...new Set([1, 2, 3, ...weeks])].sort((a, b) => a - b);
  const toggleWeek = (week: number) => update('available_weeks', draft.available_weeks.includes(week) ? draft.available_weeks.filter((value) => value !== week) : [...draft.available_weeks, week].sort((a, b) => a - b));
  const valid = draft.title.trim() && draft.content_md.includes('## Statement') && draft.available_weeks.length > 0;
  return <Dialog wide title={'id' in draft ? `Edit ${draft.title}` : 'Add question'} description="The Markdown document is the canonical question content. Round tags control where it can be selected." onClose={onClose} actions={<><DialogClose><Button variant="secondary">Cancel</Button></DialogClose><Button disabled={busy || !valid} onClick={() => void onSave(draft)}>{busy ? 'Saving…' : 'Save question'}</Button></>}>
    <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <Field label="Number"><input type="number" className={inputClass} value={draft.number ?? ''} onChange={(event) => update('number', event.target.value ? Number(event.target.value) : null)} /></Field>
      <Field label="Title"><input autoFocus className={inputClass} value={draft.title} onChange={(event) => update('title', event.target.value)} /></Field>
      <Field label="Difficulty"><SelectControl label="Difficulty" value={draft.difficulty} onChange={(value) => update('difficulty', value)} options={[{ value: 'easy', label: 'easy' }, { value: 'medium', label: 'medium' }, { value: 'hard', label: 'hard' }]} /></Field>
      <Field label="Difficulty rank"><input type="number" step="0.1" className={inputClass} value={draft.difficulty_rank ?? ''} onChange={(event) => update('difficulty_rank', event.target.value ? Number(event.target.value) : null)} /></Field>
      <div className="sm:col-span-2"><Field label="Source URL"><input className={inputClass} value={draft.url ?? ''} onChange={(event) => update('url', event.target.value)} /></Field></div>
      <fieldset className="sm:col-span-2"><legend className="text-sm font-bold text-slate-800">Available rounds</legend><div className="mt-2 flex flex-wrap gap-2">{weekOptions.map((week) => <label key={week} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800"><Checkbox checked={draft.available_weeks.includes(week)} onCheckedChange={() => toggleWeek(week)} />Round {week}</label>)}</div></fieldset>
      <div className="sm:col-span-2"><Field label="Question Markdown"><textarea className={`${inputClass} min-h-[28rem] resize-y font-mono leading-6`} value={draft.content_md} onChange={(event) => update('content_md', event.target.value)} /><span className="mt-2 block text-xs font-medium text-slate-500">Use <code>## Statement</code>, <code>## Hints</code>, and <code>## Solution</code>. These headings control what each participant is allowed to see.</span></Field></div>
      <label className="sm:col-span-2 flex cursor-pointer items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-800"><Checkbox checked={Boolean(draft.active)} onCheckedChange={(checked) => update('active', checked ? 1 : 0)} />Active in the question bank</label>
    </div>
  </Dialog>;
}

function WeekTags({ weeks }: { weeks: number[] }) {
  return <div className="flex flex-wrap gap-1">{weeks.map((week) => <span key={week} className="rounded-md bg-western-50 px-2 py-1 text-[0.68rem] font-black text-western-800">R{week}</span>)}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-slate-800">{label}<div className="mt-2">{children}</div></label>;
}
