export function reportDocumentTitle(kind?: string, preview = false): string {
  const role = kind === 'interviewer_report'
    ? 'Interviewer'
    : kind === 'interviewee_report'
      ? 'Interviewee'
      : 'Interview';
  return `${role} report${preview ? ' preview' : ''}`;
}
