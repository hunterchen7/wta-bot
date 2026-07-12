import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useBlocker } from 'react-router-dom';
import { useDashboard } from '../App';
import { saveSettings, type SettingsPayload } from '../api';

export function SettingsPage() {
  const { data, refresh } = useDashboard();
  const [form, setForm] = useState<SettingsPayload>(() => fromParticipant(data.participant));
  const [baseline, setBaseline] = useState(() => JSON.stringify(fromParticipant(data.participant)));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const dirty = useMemo(() => JSON.stringify(form) !== baseline, [form, baseline]);
  const blocker = useBlocker(dirty);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof SettingsPayload>(key: K, value: SettingsPayload[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const toggle = (key: 'opportunities' | 'topics', value: string) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
    }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await saveSettings(form);
      setBaseline(JSON.stringify(form));
      setMessage({ kind: 'ok', text: form.emailOk && !data.participant.emailOk ? 'Settings saved. Check your inbox for the email opt-in confirmation.' : 'Settings saved.' });
      await refresh();
    } catch (cause) {
      setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : 'Could not save settings.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-700">Account</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Settings</h1>
        <p className="mt-2 text-slate-600">Update your profile and notification preferences, then save everything together.</p>
      </section>

      {message ? <div className={`rounded-2xl border p-4 font-semibold ${message.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>{message.text}</div> : null}

      <form className="space-y-6" onSubmit={(event) => void submit(event)}>
        <Card title="Notifications" description="Choose whether key reminders also arrive by email.">
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input type="checkbox" checked={form.emailOk} onChange={(event) => set('emailOk', event.target.checked)} className="mt-1 size-5 accent-emerald-600" />
            <span><span className="block font-bold text-slate-900">Email me reminders alongside Discord</span><span className="mt-1 block text-sm leading-6 text-slate-500">Pairings, opt-in reminders, and overdue reports. Turning this on and saving sends a confirmation email.</span></span>
          </label>
        </Card>

        <Card title="Profile" description="These answers are shared with your /join profile.">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Full name"><input required maxLength={100} value={form.name} onChange={(event) => set('name', event.target.value)} className={inputClass} /></Field>
            <Field label="Preferred email" help="Used for dashboard login and reminders."><input required type="email" maxLength={200} value={form.preferredEmail} onChange={(event) => set('preferredEmail', event.target.value)} className={inputClass} /></Field>
            <Field label="Western email"><input required type="email" maxLength={200} value={form.westernEmail} onChange={(event) => set('westernEmail', event.target.value)} className={inputClass} /></Field>
            <Field label="Incoming year"><select required value={form.year} onChange={(event) => set('year', event.target.value)} className={inputClass}><option value="">Choose…</option>{data.options.years.map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Program"><select required value={form.program} onChange={(event) => set('program', event.target.value)} className={inputClass}><option value="">Choose…</option>{data.options.programs.map((item) => <option key={item}>{item}</option>)}</select></Field>
            <Field label="Technical interviews completed"><select required value={form.experience} onChange={(event) => set('experience', event.target.value)} className={inputClass}><option value="">Choose…</option>{data.options.experience.map((item) => <option key={item}>{item}</option>)}</select></Field>
          </div>

          <ChoiceGroup title="What are you looking for?" choices={data.options.opportunities} selected={form.opportunities} onToggle={(value) => toggle('opportunities', value)} />
          <ChoiceGroup title="Topics that would help most" choices={data.options.topics} selected={form.topics} onToggle={(value) => toggle('topics', value)} />
          <label className="mt-6 flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.priorWta} onChange={(event) => set('priorWta', event.target.checked)} className="size-5 accent-emerald-600" /> I participated in WTA before</label>

          <div className="mt-6 space-y-5">
            <Field label="Dream company and role — what and why?" help="At least about 150–200 words."><textarea required minLength={800} maxLength={2000} rows={8} value={form.blurb} onChange={(event) => set('blurb', event.target.value)} className={inputClass} /></Field>
            <Field label="Anything else you want to learn?"><textarea maxLength={1000} rows={4} value={form.interests} onChange={(event) => set('interests', event.target.value)} className={inputClass} /></Field>
            <Field label="Feedback from last year"><textarea maxLength={1000} rows={4} value={form.priorFeedback} onChange={(event) => set('priorFeedback', event.target.value)} className={inputClass} /></Field>
          </div>
        </Card>

        <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur">
          <span className={`text-sm font-semibold ${dirty ? 'text-amber-700' : 'text-slate-500'}`}>{dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
          <button disabled={!dirty || saving} className="rounded-xl bg-emerald-600 px-5 py-2.5 font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">{saving ? 'Saving…' : 'Save all changes'}</button>
        </div>
      </form>

      {blocker.state === 'blocked' ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="unsaved-title" className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <h2 id="unsaved-title" className="text-xl font-black text-slate-950">Discard unsaved changes?</h2>
            <p className="mt-2 leading-6 text-slate-600">Your settings have changed but have not been saved yet.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button className="rounded-xl border border-slate-200 px-4 py-2 font-bold text-slate-700" onClick={() => blocker.reset()}>Stay here</button>
              <button className="rounded-xl bg-rose-600 px-4 py-2 font-bold text-white" onClick={() => blocker.proceed()}>Discard changes</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-xl font-black text-slate-950">{title}</h2><p className="mt-1 mb-6 text-sm text-slate-500">{description}</p>{children}</section>;
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>{help ? <span className="mb-2 block text-xs text-slate-500">{help}</span> : null}{children}</label>;
}

function ChoiceGroup({ title, choices, selected, onToggle }: { title: string; choices: Array<{ label: string; value: string }>; selected: string[]; onToggle: (value: string) => void }) {
  return <fieldset className="mt-6"><legend className="text-sm font-bold text-slate-700">{title}</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{choices.map((choice) => <label key={choice.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-semibold transition ${selected.includes(choice.value) ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}><input type="checkbox" checked={selected.includes(choice.value)} onChange={() => onToggle(choice.value)} className="size-4 accent-emerald-600" />{choice.label}</label>)}</div></fieldset>;
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-slate-900 shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500';

const fromParticipant = (participant: ReturnType<typeof useDashboard>['data']['participant']): SettingsPayload => ({
  name: participant.name,
  preferredEmail: participant.preferredEmail,
  westernEmail: participant.westernEmail,
  year: participant.year,
  program: participant.program,
  opportunities: participant.opportunities,
  priorWta: participant.priorWta,
  experience: participant.experience,
  topics: participant.topics,
  blurb: participant.blurb,
  interests: participant.interests,
  priorFeedback: participant.priorFeedback,
  emailOk: participant.emailOk,
});
