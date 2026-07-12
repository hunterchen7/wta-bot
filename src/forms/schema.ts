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
  low?: string; // scale: label under the 1 end
  high?: string; // scale: label under the 5 end
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
const scale = (
  id: string,
  label: string,
  low: string,
  high: string,
  help?: string,
): Field => ({ id, label, type: 'scale', required: true, low, high, help });

export const INTERVIEWEE_FIELDS: Field[] = [
  { id: 'attendance_self', label: 'Did you show up to your scheduled interview?', type: 'radio', options: attendance, required: true },
  { id: 'attendance_partner', label: 'Did your interviewer show up to the interview?', type: 'radio', options: attendance, required: true },
  { id: 'camera_self', label: 'Did you have your camera on?', type: 'radio', options: yesNo, required: true },
  { id: 'camera_partner', label: 'Did your interviewer have their camera on?', type: 'radio', options: yesNo, required: true },
  scale('rating_experience', 'Rate the quality of your experience', 'Terrible', 'Excellent'),
  scale(
    'rating_communication',
    'My interviewer clearly communicated and was easy to understand during the interview.',
    'Strongly disagree',
    'Strongly agree',
  ),
  scale(
    'rating_preparedness',
    'My interviewer was well prepared for the interview.',
    'Strongly disagree',
    'Strongly agree',
  ),
  {
    id: 'duration',
    label: 'How long was your interview?',
    type: 'select',
    required: true,
    options: ['0-5 minutes', '5-10 minutes', '10-20 minutes', '20-30 minutes', '30+ minutes'].map((l) => ({ value: l, label: l })),
  },
  {
    id: 'video_url',
    label: 'Paste a link to your session recording',
    type: 'url',
    required: true,
    help: 'A Zoom/Meet cloud recording or unlisted upload. Required — organizers review the final-round recording as part of the alumni-interview decision.',
  },
  { id: 'code', label: 'Paste the code you wrote in the interview', type: 'textarea', required: true, mono: true },
  {
    id: 'partner_feedback',
    label: 'Do you have any feedback for your interviewer?',
    type: 'textarea',
    shared: true,
    help: 'Your interviewer WILL see this once both of you have submitted.',
  },
  {
    id: 'org_note',
    label: 'Anything else you would like the organizers to know?',
    type: 'textarea',
    help: 'Your interviewer will NOT see this. Include any special permissions you were given, or other discrepancies in the process.',
  },
];

// NOTE: reconstruction — the legacy interviewer form was inaccessible. Wording
// mirrors the interviewee form's style; adjust freely once the original surfaces.
export const INTERVIEWER_FIELDS: Field[] = [
  { id: 'attendance_self', label: 'Did you show up to your scheduled interview?', type: 'radio', options: attendance, required: true },
  { id: 'attendance_partner', label: 'Did your interviewee show up to the interview?', type: 'radio', options: attendance, required: true },
  { id: 'camera_self', label: 'Did you have your camera on?', type: 'radio', options: yesNo, required: true },
  { id: 'camera_partner', label: 'Did your interviewee have their camera on?', type: 'radio', options: yesNo, required: true },
  scale('rating_problem_solving', 'How would you rate their problem-solving ability?', 'Weak', 'Excellent'),
  scale(
    'rating_communication',
    'The candidate clearly communicated their thinking as they solved the problem.',
    'Strongly disagree',
    'Strongly agree',
  ),
  scale('rating_code_quality', 'How would you rate the quality of the code they wrote?', 'Poor', 'Excellent'),
  {
    id: 'hints',
    label: 'How much help did the candidate need to get to a solution?',
    type: 'select',
    required: true,
    options: [
      { value: 'none', label: 'None — they drove it entirely themselves' },
      { value: 'few', label: 'A few small hints' },
      { value: 'several', label: 'Several hints' },
      { value: 'heavy', label: 'Heavy guidance throughout' },
    ],
  },
  {
    id: 'verdict',
    label: 'Overall, would you pass this candidate?',
    type: 'radio',
    required: true,
    options: [
      { value: 'pass', label: 'Pass — ready to move to the next level' },
      { value: 'borderline', label: 'Borderline — could go either way' },
      { value: 'fail', label: 'Not yet — needs more practice' },
    ],
    help: 'Recorded every round for signal, and binding in the final round — this verdict is half of the alumni-interview gate.',
  },
  { id: 'verdict_reason', label: 'What led you to that verdict?', type: 'textarea', required: true },
  {
    id: 'strengths',
    label: 'What did the candidate do well that they should keep doing?',
    type: 'textarea',
    shared: true,
    help: 'Your interviewee WILL see this once both of you have submitted.',
  },
  {
    id: 'improvements',
    label: 'What should the candidate work on before the real thing?',
    type: 'textarea',
    shared: true,
    help: 'Your interviewee WILL see this once both of you have submitted.',
  },
  {
    id: 'org_note',
    label: 'Anything else you would like the organizers to know?',
    type: 'textarea',
    help: 'Your interviewee will NOT see this. Flag any concerns, discrepancies, or special circumstances here.',
  },
];

export function fieldsFor(kind: string): Field[] | null {
  if (kind === 'interviewee_report') return INTERVIEWEE_FIELDS;
  if (kind === 'interviewer_report') return INTERVIEWER_FIELDS;
  return null;
}

export function validate(fields: Field[], body: Record<string, unknown>): { ok: boolean; errors: string[]; fieldErrors: Record<string, string>; payload: Record<string, string> } {
  const errors: string[] = [];
  const fieldErrors: Record<string, string> = {};
  const payload: Record<string, string> = {};
  for (const f of fields) {
    const raw = String(body[f.id] ?? '').trim();
    if (!raw) {
      if (f.required) {
        errors.push(`“${f.label}” is required.`);
        fieldErrors[f.id] = 'This field is required.';
      }
      continue;
    }
    if (f.type === 'scale') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        errors.push(`“${f.label}” must be 1–5.`);
        fieldErrors[f.id] = 'Choose a rating from 1 to 5.';
        continue;
      }
    }
    if ((f.type === 'radio' || f.type === 'select') && f.options && !f.options.some((o) => o.value === raw)) {
      errors.push(`“${f.label}” has an invalid choice.`);
      fieldErrors[f.id] = 'Choose one of the available options.';
      continue;
    }
    if (f.type === 'url' && !/^https?:\/\/\S+$/i.test(raw)) {
      errors.push(`“${f.label}” must be a link (https://…).`);
      fieldErrors[f.id] = 'Enter a complete http:// or https:// link.';
      continue;
    }
    if (f.minWords) {
      const words = raw.trim().split(/\s+/).filter(Boolean).length;
      if (words < f.minWords) {
        errors.push(`“${f.label}” needs at least ${f.minWords} words (currently ${words}).`);
        fieldErrors[f.id] = `Write at least ${f.minWords} words (currently ${words}).`;
        continue;
      }
    }
    payload[f.id] = raw.slice(0, f.type === 'textarea' ? 20000 : 500);
  }
  return { ok: errors.length === 0, errors, fieldErrors, payload };
}
