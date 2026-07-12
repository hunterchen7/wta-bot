// /join intake flow (DESIGN.md §5): three chained modals, save-as-you-go,
// prefilled from the participant row on re-runs so /join doubles as "edit".

import { buttonRow, ephemeral, modal, stringSelect, textInput, TextStyle } from './discord/components';
import type { Participant } from './participants';
import type { SelectOption } from './discord/components';

export const IDS = {
  modal1: 'join:m1',
  modal2: 'join:m2',
  modal3: 'join:m3',
  // Standalone edit variants — same forms, no continue-chain afterwards.
  modal1Edit: 'join:m1e',
  modal2Edit: 'join:m2e',
  modal3Edit: 'join:m3e',
  continue2: 'join:continue2',
  continue3: 'join:continue3',
  edit1: 'join:edit1',
  edit2: 'join:edit2',
  edit3: 'join:edit3',
} as const;

export const BLURB_MIN_CHARS = 800; // ≈150–200 words; Discord enforces chars, not words
export const BLURB_MIN_WORDS = 150;

export const wordCount = (s: string | null | undefined) =>
  (s ?? '').trim().split(/\s+/).filter(Boolean).length;

export const YEARS = ['First', 'Second', 'Third', 'Fourth', 'Fifth or greater'];
export const PROGRAMS = ['Computer Science', 'Software Engineering', 'Data Science', 'Other'];
export const OPPORTUNITIES = [
  { label: 'Internships', value: 'internships' },
  { label: 'New Grad', value: 'new_grad' },
];
export const EXPERIENCE = ['0', '1-2', '3-4', '5+'];
export const TOPICS = [
  { label: 'Building a strong technical resume', value: 'resume' },
  { label: 'Data Structures & Algorithms interviews', value: 'dsa' },
  { label: 'System design interviews', value: 'system_design' },
  { label: 'Finding and applying to internships', value: 'applying' },
  { label: 'Practicing problem-solving effectively', value: 'practice' },
  { label: 'Networking with industry', value: 'networking' },
];

const opts = (labels: string[], selected: string | null): SelectOption[] =>
  labels.map((l) => ({ label: l, value: l, default: l === selected }));

const optsFromValues = (
  options: Array<{ label: string; value: string }>,
  selectedJson: string | null,
): SelectOption[] => {
  const selected: string[] = selectedJson ? JSON.parse(selectedJson) : [];
  return options.map((o) => ({ ...o, default: selected.includes(o.value) }));
};

export function modal1(existing: Participant | null, edit = false) {
  return modal(edit ? IDS.modal1Edit : IDS.modal1, edit ? 'Edit basics' : 'WTA sign-up — 1 of 3', [
    textInput({ id: 'name', label: 'Full name', value: existing?.name ?? undefined, maxLength: 100 }),
    textInput({
      id: 'preferred_email',
      label: 'Preferred email',
      value: existing?.preferred_email ?? undefined,
      placeholder: 'you@example.com',
      maxLength: 200,
    }),
    textInput({
      id: 'western_email',
      label: 'Western email',
      value: existing?.western_email ?? undefined,
      placeholder: 'you@uwo.ca',
      maxLength: 200,
    }),
    textInput({
      id: 'blurb',
      label: 'Dream company & role — what and why?',
      description: 'Minimum ~200 words — tell us properly!',
      style: TextStyle.PARAGRAPH,
      value: existing?.blurb ?? undefined,
      minLength: BLURB_MIN_CHARS,
      maxLength: 2000,
    }),
  ]);
}

export function modal2(existing: Participant | null, edit = false) {
  return modal(edit ? IDS.modal2Edit : IDS.modal2, edit ? 'Edit program info' : 'WTA sign-up — 2 of 3', [
    stringSelect({ id: 'year', label: 'Incoming year', options: opts(YEARS, existing?.year ?? null) }),
    stringSelect({
      id: 'program',
      label: 'Program',
      options: opts(PROGRAMS, existing?.program ?? null),
    }),
    stringSelect({
      id: 'opportunities',
      label: 'What are you looking for?',
      options: optsFromValues(OPPORTUNITIES, existing?.opportunities ?? null),
      minValues: 1,
      maxValues: OPPORTUNITIES.length,
    }),
    stringSelect({
      id: 'prior_wta',
      label: 'Participated in WTA before?',
      options: [
        { label: 'Yes', value: 'yes', default: existing?.prior_wta === 1 },
        { label: 'No', value: 'no', default: existing ? existing.prior_wta === 0 : false },
      ],
    }),
    stringSelect({
      id: 'experience_band',
      label: 'Technical interviews done so far',
      options: opts(EXPERIENCE, existing?.experience_band ?? null),
    }),
  ]);
}

export function modal3(existing: Participant | null, edit = false) {
  return modal(edit ? IDS.modal3Edit : IDS.modal3, edit ? 'Edit topics & extras' : 'WTA sign-up — 3 of 3', [
    stringSelect({
      id: 'topics',
      label: 'Which topics would help you most?',
      options: optsFromValues(TOPICS, existing?.topics ?? null),
      minValues: 1,
      maxValues: TOPICS.length,
    }),
    stringSelect({
      id: 'email_ok',
      label: 'Email reminders?',
      description: 'Key reminders by email on top of Discord DMs. Off unless you opt in.',
      options: [
        { label: 'Yes, email me reminders', value: 'yes', default: existing?.email_ok === 1 },
        { label: 'No — Discord only', value: 'no', default: existing ? existing.email_ok === 0 : false },
      ],
    }),
    textInput({
      id: 'interests',
      label: 'Anything else you want to learn?',
      style: TextStyle.PARAGRAPH,
      required: false,
      value: existing?.interests ?? undefined,
      maxLength: 1000,
    }),
    textInput({
      id: 'prior_feedback',
      label: 'Feedback from last year? (if you attended)',
      style: TextStyle.PARAGRAPH,
      required: false,
      value: existing?.prior_feedback ?? undefined,
      maxLength: 1000,
    }),
  ]);
}

export function afterModal1(warning = '') {
  return ephemeral(`Part 1 saved ✅${warning}`, [
    buttonRow([{ id: IDS.continue2, label: 'Continue — 2 of 3' }]),
  ]);
}

export function afterModal2() {
  return ephemeral('Part 2 saved ✅', [buttonRow([{ id: IDS.continue3, label: 'Continue — 3 of 3' }])]);
}

export function afterModal3() {
  return ephemeral(
    "You're enrolled in WTA 🎉\n\nRun `/join` anytime to edit your answers, and `/status` to see your progress once the program starts.",
  );
}

export function afterEdit(warning = '') {
  return ephemeral(`Saved ✅${warning}`);
}

export function blurbWarning(blurb: string | null): string {
  const n = wordCount(blurb);
  return n > 0 && n < BLURB_MIN_WORDS
    ? `\n⚠️ Your dream-company answer is ${n} words — we ask for ~200. Run \`/join\` → *Edit basics* to expand it.`
    : '';
}

/** Enrolled users get a pick-what-to-edit menu instead of the 3-step chain. */
export function profileMenu(p: Participant) {
  const topics = ((): string => {
    try {
      return (JSON.parse(p.topics ?? '[]') as string[]).join(', ');
    } catch {
      return '';
    }
  })();
  const lines = [
    `**Your WTA profile** — pick what to edit:`,
    `1️⃣ **Basics** — ${p.name ?? '?'} · ${p.preferred_email ?? '?'} · ${p.western_email ?? '?'} · dream-job blurb (${wordCount(p.blurb)} words)`,
    `2️⃣ **Program info** — ${p.year ?? '?'} year · ${p.program ?? '?'} · ${p.experience_band ?? '?'} interviews done`,
    `3️⃣ **Topics & extras** — ${topics || '?'} · email reminders ${p.email_ok ? 'ON 📧' : 'off'}`,
  ];
  return ephemeral(lines.join('\n'), [
    buttonRow([
      { id: IDS.edit1, label: 'Edit basics' },
      { id: IDS.edit2, label: 'Edit program info' },
      { id: IDS.edit3, label: 'Edit topics & extras' },
    ]),
  ]);
}

// --- submission parsing -----------------------------------------------------

type Values = Map<string, string | string[]>;
const str = (values: Values, key: string): string | undefined => {
  const v = values.get(key);
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
};
const arr = (values: Values, key: string): string[] | undefined => {
  const v = values.get(key);
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
};

export function parseModal1(values: Values) {
  return {
    name: str(values, 'name') ?? null,
    preferred_email: str(values, 'preferred_email') ?? null,
    western_email: str(values, 'western_email') ?? null,
    blurb: str(values, 'blurb') ?? null,
  };
}

export function parseModal2(values: Values) {
  return {
    year: str(values, 'year') ?? null,
    program: str(values, 'program') ?? null,
    opportunities: JSON.stringify(arr(values, 'opportunities') ?? []),
    prior_wta: str(values, 'prior_wta') === 'yes' ? 1 : 0,
    experience_band: str(values, 'experience_band') ?? null,
  };
}

export function parseModal3(values: Values) {
  return {
    topics: JSON.stringify(arr(values, 'topics') ?? []),
    email_ok: str(values, 'email_ok') === 'yes' ? 1 : 0,
    interests: str(values, 'interests') || null,
    prior_feedback: str(values, 'prior_feedback') || null,
  };
}
