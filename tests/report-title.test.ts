import { describe, expect, it } from 'vitest';
import { reportDocumentTitle } from '../web/src/report-title';

describe('reportDocumentTitle', () => {
  it('labels interviewer reports', () => {
    expect(reportDocumentTitle('interviewer_report')).toBe('Interviewer report');
  });

  it('labels interviewee reports', () => {
    expect(reportDocumentTitle('interviewee_report')).toBe('Interviewee report');
  });

  it('keeps a neutral title while the report is loading', () => {
    expect(reportDocumentTitle()).toBe('Interview report');
  });

  it('preserves the preview suffix for organizer previews', () => {
    expect(reportDocumentTitle('interviewer_report', true)).toBe('Interviewer report preview');
  });
});
