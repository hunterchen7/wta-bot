// Enrollment choices are shared by the public React form, participant settings,
// and server-side validation. Discord `/join` only mints a signed web link.

export const BLURB_MIN_CHARS = 800;

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
