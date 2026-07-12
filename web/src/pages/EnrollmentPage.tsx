import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useBlocker, useParams, useSearchParams } from "react-router-dom";
import {
  publicRequest,
  SettingsSaveError,
  type Choice,
  type SettingsPayload,
} from "../api";
import {
  PublicIntro,
  PublicShell,
  publicInputClass,
} from "../components/PublicShell";
import { ProfileSelect } from "../components/ProfileSelect";
import { PriorParticipationCheckbox } from "../components/PriorParticipationCheckbox";
import {
  profileBlurbHelp,
  profileFormContent,
} from "../profile-form-content";

type EnrollmentData = {
  discord: { id: string; username: string | null };
  profile: SettingsPayload | null;
  options: {
    years: string[];
    programs: string[];
    experience: string[];
    opportunities: Choice[];
    topics: Choice[];
  };
  minimumBlurbWords: number;
};
const emptyProfile: SettingsPayload = {
  name: "",
  preferredEmail: "",
  westernEmail: "",
  year: "",
  program: "",
  opportunities: [],
  priorWta: false,
  experience: "",
  topics: [],
  blurb: "",
  interests: "",
  priorFeedback: "",
  emailOk: false,
};

export function EnrollmentPage({ preview = false }: { preview?: boolean }) {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const embedded = preview && searchParams.get("embed") === "1";
  const [data, setData] = useState<EnrollmentData | null>(
    preview ? previewEnrollment : null,
  );
  const [form, setForm] = useState(emptyProfile);
  const [baseline, setBaseline] = useState(JSON.stringify(emptyProfile));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = useMemo(
    () => !preview && JSON.stringify(form) !== baseline,
    [form, baseline, preview],
  );
  const blocker = useBlocker(dirty && !saved);
  useEffect(() => {
    if (!preview)
      publicRequest<EnrollmentData>(`/enrollment/${token}`)
        .then((result) => {
          const profile = result.profile ?? emptyProfile;
          setData(result);
          setForm(profile);
          setBaseline(JSON.stringify(profile));
        })
        .catch((cause) =>
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not open enrollment.",
          ),
        );
  }, [preview, token]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty && !saved) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saved]);
  const set = <K extends keyof SettingsPayload>(
    key: K,
    value: SettingsPayload[K],
  ) => {
    setSaved(false);
    setFieldErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([field]) => field !== key),
      ),
    );
    setForm((current) => ({ ...current, [key]: value }));
  };
  const toggle = (key: "opportunities" | "topics", value: string) =>
    set(
      key,
      form[key].includes(value)
        ? form[key].filter((item) => item !== value)
        : [...form[key], value],
    );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (preview) return;
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      await publicRequest(`/enrollment/${token}`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setBaseline(JSON.stringify(form));
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      if (cause instanceof SettingsSaveError) {
        setError(cause.message);
        setFieldErrors(cause.fieldErrors);
        const first = Object.keys(cause.fieldErrors)[0];
        if (first)
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(
                `[data-field="${first}"], [name="${first}"]`,
              )
              ?.scrollIntoView({ behavior: "smooth", block: "center" }),
          );
      } else setError("Could not save enrollment.");
    } finally {
      setBusy(false);
    }
  };
  if (error && !data)
    return (
      <EnrollmentShell embedded={embedded}>
        <div className="rounded-3xl border border-rose-200 bg-white p-8 text-center">
          <h1 className="text-2xl font-black">
            This enrollment link can’t be opened
          </h1>
          <p className="mt-3 text-slate-600">{error}</p>
          <p className="mt-4 text-sm text-slate-500">
            Run <code>/join</code> in Discord for a fresh link.
          </p>
        </div>
      </EnrollmentShell>
    );
  if (!data)
    return (
      <EnrollmentShell embedded={embedded}>
        <div className="h-160 animate-pulse rounded-3xl bg-slate-200" />
      </EnrollmentShell>
    );
  return (
    <EnrollmentShell embedded={embedded}>
      <PublicIntro
        eyebrow={
          preview
            ? "Read-only preview"
            : data.profile
              ? "Edit enrollment"
              : "Program enrollment"
        }
        title={
          data.profile
            ? "Update your WTA profile."
            : "Tell us what you want to practice."
        }
        description="This profile guides matching and program content. Every change stays local until you save at the bottom."
      />
      {preview ? (
        <div className="mb-6 rounded-2xl border border-western-200 bg-western-50 p-4 text-sm font-semibold text-western-900">
          Preview mode: fields are interactive, but no enrollment data can be
          saved.
        </div>
      ) : null}
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        <span className="grid size-10 place-items-center rounded-full bg-indigo-950 text-xs font-black text-indigo-200">
          DC
        </span>
        <div>
          <div className="text-xs font-black uppercase tracking-[0.12em] text-indigo-500">
            Linked Discord account
          </div>
          <div className="font-extrabold text-indigo-950">
            {data.discord.username
              ? `@${data.discord.username}`
              : "Discord user"}{" "}
            <span className="font-mono text-xs font-semibold text-indigo-500">
              {data.discord.id}
            </span>
          </div>
        </div>
      </div>
      {saved ? (
        <div
          role="status"
          className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"
        >
          <div className="font-black">Profile saved.</div>
          <p className="mt-1 text-sm">
            Your Discord role and dashboard mapping are being updated. You can
            close this page.
          </p>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900"
        >
          {error}
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-5">
        <Section
          title={profileFormContent.sections.profile.title}
          description={profileFormContent.sections.profile.description}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={profileFormContent.fields.name.label}
              error={fieldErrors.name}
            >
              <input
                name="name"
                required
                maxLength={100}
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                className={fieldClass(fieldErrors.name)}
              />
            </Field>
            <Field
              label={profileFormContent.fields.preferredEmail.label}
              help={profileFormContent.fields.preferredEmail.help}
              error={fieldErrors.preferredEmail}
            >
              <input
                name="preferredEmail"
                required
                type="email"
                value={form.preferredEmail}
                onChange={(event) => set("preferredEmail", event.target.value)}
                className={fieldClass(fieldErrors.preferredEmail)}
              />
            </Field>
            <Field
              label={profileFormContent.fields.westernEmail.label}
              error={fieldErrors.westernEmail}
            >
              <input
                name="westernEmail"
                required
                type="email"
                value={form.westernEmail}
                onChange={(event) => set("westernEmail", event.target.value)}
                className={fieldClass(fieldErrors.westernEmail)}
              />
            </Field>
            <Field
              label={profileFormContent.fields.year.label}
              error={fieldErrors.year}
            >
              <ProfileSelect
                name="year"
                label={profileFormContent.fields.year.label}
                value={form.year}
                options={data.options.years}
                placeholder={profileFormContent.selectPlaceholder}
                invalid={Boolean(fieldErrors.year)}
                onChange={(value) => set("year", value)}
                className={fieldClass(fieldErrors.year)}
              />
            </Field>
            <Field
              label={profileFormContent.fields.program.label}
              error={fieldErrors.program}
            >
              <ProfileSelect
                name="program"
                label={profileFormContent.fields.program.label}
                value={form.program}
                options={data.options.programs}
                placeholder={profileFormContent.selectPlaceholder}
                invalid={Boolean(fieldErrors.program)}
                onChange={(value) => set("program", value)}
                className={fieldClass(fieldErrors.program)}
              />
            </Field>
            <Field
              label={profileFormContent.fields.experience.label}
              error={fieldErrors.experience}
            >
              <ProfileSelect
                name="experience"
                label={profileFormContent.fields.experience.label}
                value={form.experience}
                options={data.options.experience}
                placeholder={profileFormContent.selectPlaceholder}
                invalid={Boolean(fieldErrors.experience)}
                onChange={(value) => set("experience", value)}
                className={fieldClass(fieldErrors.experience)}
              />
            </Field>
          </div>
        </Section>
        <Section
          title={profileFormContent.sections.goals.title}
          description={profileFormContent.sections.goals.description}
        >
          <Choices
            field="opportunities"
            title={profileFormContent.fields.opportunities.label}
            choices={data.options.opportunities}
            selected={form.opportunities}
            error={fieldErrors.opportunities}
            onToggle={(value) => toggle("opportunities", value)}
          />
          <Choices
            field="topics"
            title={profileFormContent.fields.topics.label}
            choices={data.options.topics}
            selected={form.topics}
            error={fieldErrors.topics}
            onToggle={(value) => toggle("topics", value)}
          />
          <PriorParticipationCheckbox
            checked={form.priorWta}
            label={profileFormContent.fields.priorWta.label}
            onChange={(checked) => set("priorWta", checked)}
          />
        </Section>
        <Section
          title={profileFormContent.sections.context.title}
          description={profileFormContent.sections.context.description}
        >
          <Field
            label={profileFormContent.fields.blurb.label}
            help={profileBlurbHelp(
              wordCount(form.blurb),
              data.minimumBlurbWords,
            )}
            error={fieldErrors.blurb}
          >
            <textarea
              name="blurb"
              required
              maxLength={2000}
              rows={10}
              value={form.blurb}
              onChange={(event) => set("blurb", event.target.value)}
              className={fieldClass(fieldErrors.blurb)}
              placeholder={profileFormContent.fields.blurb.placeholder}
            />
          </Field>
          <div className="mt-5">
            <Field
              label={profileFormContent.fields.interests.label}
              error={fieldErrors.interests}
            >
              <textarea
                name="interests"
                maxLength={1000}
                rows={4}
                value={form.interests}
                onChange={(event) => set("interests", event.target.value)}
                className={fieldClass(fieldErrors.interests)}
              />
            </Field>
          </div>
          <div className="mt-5">
            <Field
              label={profileFormContent.fields.priorFeedback.label}
              error={fieldErrors.priorFeedback}
            >
              <textarea
                name="priorFeedback"
                maxLength={1000}
                rows={4}
                value={form.priorFeedback}
                onChange={(event) => set("priorFeedback", event.target.value)}
                className={fieldClass(fieldErrors.priorFeedback)}
              />
            </Field>
          </div>
        </Section>
        <Section
          title={profileFormContent.sections.notifications.title}
          description={profileFormContent.sections.notifications.description}
        >
          <label
            className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-western-500 focus-within:ring-offset-2 dark:focus-within:ring-offset-background ${form.emailOk ? "border-western-300 bg-western-50 dark:border-western-700 dark:bg-western-950/35" : "border-slate-200 hover:bg-slate-50 dark:border-border dark:hover:bg-accent"}`}
          >
            <input
              type="checkbox"
              checked={form.emailOk}
              onChange={(event) => set("emailOk", event.target.checked)}
              className="mt-0.5 size-5 accent-western-600"
            />
            <span>
              <span
                className={`block text-sm font-black ${form.emailOk ? "text-western-950 dark:text-western-100" : "text-slate-900"}`}
              >
                {profileFormContent.emailOptIn.label}
              </span>
              <span
                className={`mt-1 block text-xs leading-5 ${form.emailOk ? "text-western-800/80 dark:text-western-300/75" : "text-slate-500"}`}
              >
                {profileFormContent.emailOptIn.description}
              </span>
            </span>
          </label>
        </Section>
        <div
          className={`${preview ? "" : "sticky bottom-4 z-20 shadow-xl backdrop-blur"} rounded-2xl border border-slate-200 bg-white/95 p-3`}
        >
          <button
            disabled={preview || busy || !dirty}
            className="w-full cursor-pointer rounded-xl bg-western-700 px-4 py-3.5 text-sm font-black text-white hover:bg-western-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {preview
              ? "Enrollment disabled in preview"
              : busy
                ? "Saving profile…"
                : data.profile
                  ? "Save all changes"
                  : "Complete enrollment"}
          </button>
        </div>
      </form>
      {blocker.state === "blocked" ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <h2 className="text-xl font-black">Leave with unsaved changes?</h2>
            <p className="mt-2 text-sm text-slate-600">
              Your enrollment edits have not been saved.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="cursor-pointer rounded-lg border px-4 py-2 text-sm font-bold"
                onClick={() => blocker.reset()}
              >
                Stay here
              </button>
              <button
                className="cursor-pointer rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white"
                onClick={() => blocker.proceed()}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </EnrollmentShell>
  );
}

function EnrollmentShell({
  embedded,
  children,
}: {
  embedded: boolean;
  children: React.ReactNode;
}) {
  return embedded ? (
    <main className="min-h-screen bg-background px-4 py-6 dark:bg-background sm:px-6">
      <div className="mx-auto max-w-3xl">{children}</div>
    </main>
  ) : (
    <PublicShell narrow>{children}</PublicShell>
  );
}
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-black text-slate-950">{title}</h2>
      <p className="mt-1 mb-6 text-sm text-slate-500">{description}</p>
      {children}
    </section>
  );
}
function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-extrabold text-slate-800 sm:min-h-10">
        {label}
      </span>
      {children}
      {help ? (
        <span className="mt-2 block text-xs leading-5 text-slate-500">{help}</span>
      ) : null}
      {error ? (
        <span
          role="alert"
          className="mt-2 block text-sm font-bold text-rose-700"
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}
function Choices({
  field,
  title,
  choices,
  selected,
  error,
  onToggle,
}: {
  field: string;
  title: string;
  choices: Choice[];
  selected: string[];
  error?: string;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset
      data-field={field}
      className={`mt-5 rounded-2xl ${error ? "ring-2 ring-rose-300 ring-offset-4" : ""}`}
    >
      <legend className="text-sm font-extrabold text-slate-800">{title}</legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm font-bold transition focus-within:ring-2 focus-within:ring-western-500 focus-within:ring-offset-2 dark:focus-within:ring-offset-background ${selected.includes(choice.value) ? "border-western-300 bg-western-50 text-western-900 dark:border-western-700 dark:bg-western-950/35 dark:text-western-100" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border dark:hover:bg-accent"}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(choice.value)}
              onChange={() => onToggle(choice.value)}
              className="size-4 accent-western-600"
            />
            {choice.label}
          </label>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm font-bold text-rose-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
const fieldClass = (error?: string) =>
  `${publicInputClass} ${error ? "border-rose-400 bg-rose-50/30 focus:border-rose-500" : ""}`;
const wordCount = (value: string) =>
  value.trim().split(/\s+/).filter(Boolean).length;
const previewEnrollment: EnrollmentData = {
  discord: { id: "100000000000000001", username: "alex.example" },
  profile: null,
  minimumBlurbWords: 100,
  options: {
    years: ["First", "Second", "Third", "Fourth", "Fifth or greater"],
    programs: [
      "Computer Science",
      "Software Engineering",
      "Data Science",
      "Other",
    ],
    experience: ["0", "1-2", "3-4", "5+"],
    opportunities: [
      { label: "Internships", value: "internships" },
      { label: "New Grad", value: "new_grad" },
    ],
    topics: [
      { label: "Building a strong technical resume", value: "resume" },
      { label: "Data Structures & Algorithms interviews", value: "dsa" },
      { label: "System design interviews", value: "system_design" },
      { label: "Finding and applying to internships", value: "applying" },
      { label: "Practicing problem-solving effectively", value: "practice" },
      { label: "Networking with industry", value: "networking" },
    ],
  },
};
