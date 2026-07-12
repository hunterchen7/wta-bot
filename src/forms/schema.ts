// Data-driven report templates (DESIGN §5). Rendering and validation share
// these specs. `shared: true` fields are relayed to the partner once both
// reports are in; everything else is organizer-only or structural.
//
// NOTE: the interviewer template is a reasoned reconstruction — the legacy
// interviewer form was inaccessible. Marked fields are easy to adjust.

export type Field = {
  id: string;
  label: string;
  type: 'radio' | 'select' | 'scale' | 'text' | 'textarea' | 'url';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  shared?: boolean; // relayed to the partner
  help?: string;
  mono?: boolean; // code-style textarea
  minWords?: number; // enforced server-side on submit
};

const yesNo = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
const attendance = [
  { value: 'yes', label: 'Yes' },
  { value: 'late', label: 'Yes, but late' },
  { value: 'no', label: 'No' },
];
const scale = (id: string, label: string, help?: string): Field => ({
  id,
  label,
  type: 'scale',
  required: true,
  help,
});

export const INTERVIEWEE_FIELDS: Field[] = [
  { id: 'attendance_self', label: 'Did you show up to the scheduled session?', type: 'radio', options: attendance, required: true },
  { id: 'attendance_partner', label: 'Did your interviewer show up?', type: 'radio', options: attendance, required: true },
  { id: 'camera_self', label: 'Was your camera on?', type: 'radio', options: yesNo, required: true },
  { id: 'camera_partner', label: "Was your interviewer's camera on?", type: 'radio', options: yesNo, required: true },
  scale('rating_experience', 'Rate the overall experience'),
  scale('rating_communication', 'My interviewer communicated clearly'),
  scale('rating_preparedness', 'My interviewer was well prepared'),
  {
    id: 'language',
    label: 'What language did you use?',
    type: 'select',
    required: true,
    options: ['Python', 'Java', 'JavaScript/TypeScript', 'C/C++', 'Rust', 'Go', 'Other'].map((l) => ({ value: l, label: l })),
  },
  {
    id: 'duration',
    label: 'How long was the interview?',
    type: 'select',
    required: true,
    options: ['0-15 minutes', '15-30 minutes', '30-45 minutes', '45-60 minutes', '60+ minutes'].map((l) => ({ value: l, label: l })),
  },
  { id: 'video_url', label: 'Link to the session recording', type: 'url', required: true, help: 'Zoom/Meet cloud recording or an unlisted upload — required for the week-3 qualifying review.' },
  { id: 'code', label: 'Paste the code you wrote', type: 'textarea', required: true, mono: true },
  { id: 'partner_feedback', label: 'Feedback for your interviewer', type: 'textarea', shared: true, help: 'They WILL see this once both reports are in.' },
  { id: 'org_note', label: 'Anything else for the organizers?', type: 'textarea', help: 'Your interviewer will NOT see this.' },
];

export const INTERVIEWER_FIELDS: Field[] = [
  { id: 'attendance_self', label: 'Did you show up to the scheduled session?', type: 'radio', options: attendance, required: true },
  { id: 'attendance_partner', label: 'Did your interviewee show up?', type: 'radio', options: attendance, required: true },
  { id: 'camera_self', label: 'Was your camera on?', type: 'radio', options: yesNo, required: true },
  { id: 'camera_partner', label: "Was your interviewee's camera on?", type: 'radio', options: yesNo, required: true },
  scale('rating_problem_solving', 'Problem-solving ability'),
  scale('rating_communication', 'Communication while solving'),
  scale('rating_code_quality', 'Code quality'),
  {
    id: 'hints',
    label: 'How much help did they need?',
    type: 'select',
    required: true,
    options: [
      { value: 'none', label: 'None — drove it themselves' },
      { value: 'few', label: 'A few small hints' },
      { value: 'several', label: 'Several hints' },
      { value: 'heavy', label: 'Heavy guidance throughout' },
    ],
  },
  {
    id: 'verdict',
    label: 'Verdict',
    type: 'radio',
    required: true,
    options: [
      { value: 'pass', label: 'Pass — ready for the next level' },
      { value: 'borderline', label: 'Borderline' },
      { value: 'fail', label: 'Not yet' },
    ],
    help: 'Required every week for signal; binding in week 3 (half the alumni-round gate).',
  },
  { id: 'verdict_reason', label: 'Why that verdict?', type: 'textarea', required: true },
  { id: 'strengths', label: 'Strengths to keep', type: 'textarea', shared: true, help: 'They WILL see this.' },
  { id: 'improvements', label: 'What to improve before the real thing', type: 'textarea', shared: true, help: 'They WILL see this.' },
  { id: 'org_note', label: 'Anything else for the organizers?', type: 'textarea', help: 'Your interviewee will NOT see this.' },
];

export function fieldsFor(kind: string): Field[] | null {
  if (kind === 'interviewee_report') return INTERVIEWEE_FIELDS;
  if (kind === 'interviewer_report') return INTERVIEWER_FIELDS;
  return null;
}

export function validate(fields: Field[], body: Record<string, unknown>): { ok: boolean; errors: string[]; payload: Record<string, string> } {
  const errors: string[] = [];
  const payload: Record<string, string> = {};
  for (const f of fields) {
    const raw = String(body[f.id] ?? '').trim();
    if (!raw) {
      if (f.required) errors.push(`“${f.label}” is required.`);
      continue;
    }
    if (f.type === 'scale') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 5) errors.push(`“${f.label}” must be 1–5.`);
    }
    if ((f.type === 'radio' || f.type === 'select') && f.options && !f.options.some((o) => o.value === raw)) {
      errors.push(`“${f.label}” has an invalid choice.`);
      continue;
    }
    if (f.type === 'url' && !/^https?:\/\/\S+$/i.test(raw)) {
      errors.push(`“${f.label}” must be a link (https://…).`);
      continue;
    }
    if (f.minWords) {
      const words = raw.trim().split(/\s+/).filter(Boolean).length;
      if (words < f.minWords) {
        errors.push(`“${f.label}” needs at least ${f.minWords} words (currently ${words}).`);
        continue;
      }
    }
    payload[f.id] = raw.slice(0, f.type === 'textarea' ? 20000 : 500);
  }
  return { ok: errors.length === 0, errors, payload };
}
