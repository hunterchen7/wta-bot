import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ProblemExecution,
  ProblemLanguage,
  ProblemTestCase,
} from '../../admin-types';
import type { SupportedLanguage } from '../../lib/code-language';
import type { EditableProblem } from '../../lib/problem-editor';
import { Button, Dialog, DialogClose, Tabs } from '../AdminUI';
import { CodeEditor } from '../CodeEditor';
import { SelectControl } from '../SelectControl';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

const languageOptions: Array<{ value: ProblemLanguage; label: string; syntax: SupportedLanguage }> = [
  { value: 'python', label: 'Python', syntax: 'Python' },
  { value: 'javascript', label: 'JavaScript', syntax: 'JavaScript/TypeScript' },
  { value: 'typescript', label: 'TypeScript', syntax: 'JavaScript/TypeScript' },
  { value: 'java', label: 'Java', syntax: 'Java' },
  { value: 'cpp', label: 'C++', syntax: 'C/C++' },
];

export function ProblemEditor({
  value,
  weeks,
  busy,
  onClose,
  onSave,
}: {
  value: EditableProblem;
  weeks: number[];
  busy: boolean;
  onClose: () => void;
  onSave: (value: EditableProblem) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [tab, setTab] = useState('content');
  const bodyRef = useRef<HTMLDivElement>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<ProblemLanguage>(
    value.execution.mode === 'stdin_tests' ? value.execution.languages[0] ?? 'python' : 'python',
  );
  const update = <K extends keyof EditableProblem>(key: K, next: EditableProblem[K]) => {
    setDraft((current) => ({ ...current, [key]: next }));
  };
  const executionValid = draft.execution.mode === 'manual'
    || (draft.execution.languages.length > 0
      && draft.execution.languages.every((language) => draft.execution.mode === 'stdin_tests' && draft.execution.starterCode[language]?.trim())
      && draft.execution.testCases.length > 0
      && draft.execution.testCases.every((testCase) => testCase.description.trim()));
  const valid = Boolean(
    draft.title.trim()
      && draft.statement_md?.trim()
      && draft.available_weeks.length > 0
      && executionValid,
  );
  useLayoutEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [tab]);

  return <Dialog
    size="viewport"
    title={'id' in draft ? `Edit ${draft.title}` : 'Add question'}
    description="Create reusable participant content, private interviewer notes, and an optional portable test harness."
    onClose={onClose}
    bodyClassName="p-0"
    bodyRef={bodyRef}
    actions={<>
      <DialogClose><Button variant="secondary">Cancel</Button></DialogClose>
      <Button className="min-w-32" disabled={busy || !valid} onClick={() => void onSave(draft)}>{busy ? 'Saving…' : 'Save question'}</Button>
    </>}
  >
    <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 py-3 backdrop-blur-xl">
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'content', label: 'Content' },
        { value: 'tests', label: 'Test harness', count: draft.execution.mode === 'stdin_tests' ? draft.execution.testCases.length : undefined },
        { value: 'settings', label: 'Settings' },
      ]} />
    </div>
    <div className="mx-auto w-full max-w-5xl p-5 sm:p-7">
      {tab === 'content' ? <ContentFields draft={draft} update={update} /> : null}
      {tab === 'tests' ? <ExecutionFields draft={draft} selectedLanguage={selectedLanguage} onSelectLanguage={setSelectedLanguage} update={update} /> : null}
      {tab === 'settings' ? <SettingsFields draft={draft} weeks={weeks} update={update} /> : null}
    </div>
  </Dialog>;
}

function ContentFields({ draft, update }: EditorSectionProps) {
  return <div className="space-y-6">
    <Field label="Title" required><Input autoFocus value={draft.title} onChange={(event) => update('title', event.target.value)} className="h-11 rounded-xl" /></Field>
    <Field label="Statement" required hint="Markdown shown to the candidate and interviewer.">
      <Textarea value={draft.statement_md ?? ''} onChange={(event) => update('statement_md', event.target.value)} className="min-h-72 field-sizing-fixed resize-y rounded-xl font-mono leading-6" />
    </Field>
    <Field label="Interviewer notes" hint="Private Markdown shown only in the interviewer packet and imported private notes.">
      <Textarea value={draft.interviewer_notes_md} onChange={(event) => update('interviewer_notes_md', event.target.value)} className="min-h-60 field-sizing-fixed resize-y rounded-xl font-mono leading-6" />
    </Field>
  </div>;
}

function ExecutionFields({ draft, selectedLanguage, onSelectLanguage, update }: EditorSectionProps & { selectedLanguage: ProblemLanguage; onSelectLanguage: (language: ProblemLanguage) => void }) {
  const execution = draft.execution;
  const setExecution = (next: ProblemExecution) => update('execution', next);
  const enableTests = () => setExecution({ mode: 'stdin_tests', languages: ['python'], starterCode: {}, testCases: [blankTestCase()] });

  if (execution.mode === 'manual') {
    return <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-muted/30 p-8 text-center">
      <div className="rounded-full bg-western-100 p-3 text-western-700 dark:bg-western-950 dark:text-western-300"><Plus aria-hidden="true" /></div>
      <h3 className="mt-5 text-lg font-black text-foreground">Discussion-only question</h3>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">Add a standard-input harness when this problem should run in Pairy or another compatible interview tool.</p>
      <Button className="mt-5" onClick={enableTests}>Add test harness</Button>
    </div>;
  }

  const selected = execution.languages.includes(selectedLanguage) ? selectedLanguage : execution.languages[0] ?? 'python';
  const selectedOption = languageOptions.find((option) => option.value === selected)!;
  const toggleLanguage = (language: ProblemLanguage) => {
    const included = execution.languages.includes(language);
    const languages = included
      ? execution.languages.filter((value) => value !== language)
      : [...execution.languages, language];
    setExecution({ ...execution, languages });
    if (!included) onSelectLanguage(language);
    else if (selected === language && languages[0]) onSelectLanguage(languages[0]);
  };
  const updateStarter = (code: string) => setExecution({
    ...execution,
    starterCode: { ...execution.starterCode, [selected]: code },
  });
  const updateTest = (index: number, next: ProblemTestCase) => setExecution({
    ...execution,
    testCases: execution.testCases.map((testCase, testIndex) => testIndex === index ? next : testCase),
  });
  const removeTest = (index: number) => setExecution({
    ...execution,
    testCases: execution.testCases.filter((_, testIndex) => testIndex !== index),
  });

  return <div className="space-y-7">
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h3 className="font-black text-foreground">Runtime languages</h3><p className="mt-1 text-sm text-muted-foreground">The definition stays portable; each consumer decides how to execute these runtime IDs.</p></div>
        <Button variant="quiet" onClick={() => setExecution({ mode: 'manual' })}>Remove harness</Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{languageOptions.map((language) => {
        const checked = execution.languages.includes(language.value);
        return <label key={language.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${checked ? 'border-western-300 bg-western-50 text-western-900 dark:bg-western-950/40 dark:text-western-100' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}>
          <Checkbox checked={checked} onCheckedChange={() => toggleLanguage(language.value)} />{language.label}
        </label>;
      })}</div>
    </section>

    {execution.languages.length ? <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black text-foreground">Starter code <span className="text-destructive">*</span></h3><p className="mt-1 text-sm text-muted-foreground">Required for each selected language. Include any stdin/stdout adapter code here.</p></div><SelectControl label="Starter language" value={selected} onChange={(value) => onSelectLanguage(value as ProblemLanguage)} options={execution.languages.map((language) => ({ value: language, label: languageOptions.find((option) => option.value === language)?.label ?? language }))} className="w-44" /></div>
      <CodeEditor label={`${selectedOption.label} starter code`} language={selectedOption.syntax} value={execution.starterCode[selected] ?? ''} invalid={!execution.starterCode[selected]?.trim()} size="compact" onChange={updateStarter} />
    </section> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Select at least one runtime language.</div>}

    <section>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-black text-foreground">Test cases</h3><p className="mt-1 text-sm text-muted-foreground">Inputs and expected outputs are passed through exactly as written.</p></div><Button variant="secondary" onClick={() => setExecution({ ...execution, testCases: [...execution.testCases, blankTestCase()] })}><Plus aria-hidden="true" />Add test</Button></div>
      <div className="mt-4 space-y-4">{execution.testCases.map((testCase, index) => <TestCaseEditor key={index} index={index} value={testCase} onChange={(next) => updateTest(index, next)} onRemove={() => removeTest(index)} />)}</div>
      {!execution.testCases.length ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">Add at least one test case.</div> : null}
    </section>
  </div>;
}

function TestCaseEditor({ index, value, onChange, onRemove }: { index: number; value: ProblemTestCase; onChange: (value: ProblemTestCase) => void; onRemove: () => void }) {
  return <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
    <div className="flex items-center gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-black text-muted-foreground">{index + 1}</span><Input aria-label={`Test ${index + 1} description`} placeholder="Test description" value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} className="h-10 rounded-xl font-bold" /><button type="button" aria-label={`Remove test ${index + 1}`} className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" onClick={onRemove}><Trash2 className="size-4" /></button></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><Field label="Standard input"><Textarea aria-label={`Test ${index + 1} standard input`} value={value.input} onChange={(event) => onChange({ ...value, input: event.target.value })} className="min-h-36 field-sizing-fixed resize-y rounded-xl bg-[#0b1020] font-mono text-slate-100 caret-white" /></Field><Field label="Expected output"><Textarea aria-label={`Test ${index + 1} expected output`} value={value.expectedOutput} onChange={(event) => onChange({ ...value, expectedOutput: event.target.value })} className="min-h-36 field-sizing-fixed resize-y rounded-xl bg-[#0b1020] font-mono text-slate-100 caret-white" /></Field></div>
    <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-bold text-foreground"><Checkbox checked={value.isHidden} onCheckedChange={(checked) => onChange({ ...value, isHidden: checked === true })} />{value.isHidden ? <EyeOff className="size-4 text-muted-foreground" /> : <Eye className="size-4 text-muted-foreground" />}{value.isHidden ? 'Hidden from candidates' : 'Visible example'}</label>
  </div>;
}

function SettingsFields({ draft, weeks, update }: EditorSectionProps & { weeks: number[] }) {
  const weekOptions = useMemo(() => [...new Set([1, 2, 3, ...weeks])].sort((a, b) => a - b), [weeks]);
  const toggleWeek = (week: number) => update('available_weeks', draft.available_weeks.includes(week)
    ? draft.available_weeks.filter((value) => value !== week)
    : [...draft.available_weeks, week].sort((a, b) => a - b));
  return <div className="space-y-6">
    <div className="grid gap-5 sm:grid-cols-2"><Field label="Difficulty" required><SelectControl label="Difficulty" value={draft.difficulty} onChange={(value) => update('difficulty', value as EditableProblem['difficulty'])} options={[{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }]} /></Field><Field label="Difficulty rank"><Input type="number" step="0.1" value={draft.difficulty_rank ?? ''} onChange={(event) => update('difficulty_rank', event.target.value ? Number(event.target.value) : null)} className="h-10 rounded-xl" /></Field><Field label="Source"><Input value={draft.source} onChange={(event) => update('source', event.target.value)} className="h-10 rounded-xl" /></Field><Field label="Source number"><Input type="number" min="1" value={draft.number ?? ''} onChange={(event) => update('number', event.target.value ? Number(event.target.value) : null)} className="h-10 rounded-xl" /></Field></div>
    <Field label="Source URL"><Input type="url" value={draft.url ?? ''} onChange={(event) => update('url', event.target.value || null)} className="h-10 rounded-xl" /></Field>
    <fieldset><legend className="text-sm font-bold text-foreground">Available rounds <span className="text-destructive">*</span></legend><div className="mt-3 flex flex-wrap gap-2">{weekOptions.map((week) => <label key={week} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted"><Checkbox checked={draft.available_weeks.includes(week)} onCheckedChange={() => toggleWeek(week)} />Round {week}</label>)}</div></fieldset>
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm font-bold text-foreground"><Checkbox checked={Boolean(draft.active)} onCheckedChange={(checked) => update('active', checked ? 1 : 0)} />Active in the question bank</label>
  </div>;
}

type EditorSectionProps = {
  draft: EditableProblem;
  update: <K extends keyof EditableProblem>(key: K, next: EditableProblem[K]) => void;
};

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-foreground"><span>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</span>{hint ? <span className="mt-1 block text-xs font-medium leading-5 text-muted-foreground">{hint}</span> : null}<div className="mt-2">{children}</div></label>;
}

function blankTestCase(): ProblemTestCase {
  return { description: '', input: '', expectedOutput: '', isHidden: false };
}
