import { useEffect, useState } from 'react';
import type { ParticipantDetail } from '../admin-types';
import { Badge, Dialog, ErrorState, formatDate, LoadingState } from './AdminUI';
import { ResumePreviewDialog, type ResumePreviewTarget } from './ResumePreviewDialog';
import { useAdminData } from '../hooks/useAdminData';

export function ParticipantProfileDialog({
  participantId,
  onClose,
}: {
  participantId: number;
  onClose: () => void;
}) {
  const { data, error, loading, reload } = useAdminData<ParticipantDetail>(`/participants/${participantId}`);
  const [resumePreview, setResumePreview] = useState<ResumePreviewTarget | null>(null);

  return <>
    <Dialog
      wide
      title={data?.participant.name ?? 'Participant'}
      description={data
        ? `Server nickname: ${data.participant.discord_nickname ?? 'not synced'} · Discord: ${data.participant.discord_username ? `@${data.participant.discord_username}` : 'not synced'} · ID ${data.participant.discord_id}`
        : 'Loading participant history…'}
      onClose={onClose}
    >
      {loading && !data ? <LoadingState /> : error || !data
        ? <ErrorState message={error ?? 'Could not load this participant.'} onRetry={() => void reload()} />
        : <ParticipantProfile detail={data} onPreviewResume={setResumePreview} />}
    </Dialog>
    {resumePreview ? <ResumePreviewDialog target={resumePreview} onClose={() => setResumePreview(null)} /> : null}
  </>;
}

function ParticipantProfile({
  detail,
  onPreviewResume,
}: {
  detail: ParticipantDetail;
  onPreviewResume: (target: ResumePreviewTarget) => void;
}) {
  return <div className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Fact label="Status"><Badge value={detail.participant.status} /></Fact>
      <Fact label="Program" value={`${detail.participant.year ?? '—'} · ${detail.participant.program ?? '—'}`} />
      <Fact label="Experience" value={detail.participant.experience_band ?? '—'} />
      <Fact label="Joined" value={formatDate(detail.participant.created_at, false)} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <DetailSection title="Contact">
        <DetailRow label="Preferred email" value={detail.participant.preferred_email} link="email" />
        <DetailRow label="UWO email" value={detail.participant.western_email} link="email" />
        <DetailRow label="Email reminders" value={detail.participant.email_ok ? 'Enabled' : 'Discord only'} />
        <DetailRow label="Profile updated" value={formatDate(detail.participant.updated_at)} />
      </DetailSection>
      <DetailSection title="Enrollment profile">
        <DetailRow label="Targeting" value={formatChoices(detail.participant.opportunities)} />
        <DetailRow label="Practice topics" value={formatChoices(detail.participant.topics)} />
        <DetailRow label="Prior WTA" value={detail.participant.prior_wta ? 'Yes' : 'No'} />
        {detail.participant.removed_reason ? <DetailRow label="Removal reason" value={detail.participant.removed_reason} /> : null}
      </DetailSection>
      <DetailSection title="Application materials" className="lg:col-span-2">
        <DetailRow label="LinkedIn profile" value={detail.participant.linkedin_url} link="url" />
        <DetailRow label="Other profile link" value={detail.participant.other_url} link="url" />
        <DetailRow
          label="Resume"
          value={detail.participant.resume?.filename}
          onAction={detail.participant.resume ? () => onPreviewResume({
            participantId: detail.participant.id,
            participantName: detail.participant.name ?? 'Unnamed participant',
            filename: detail.participant.resume.filename,
            contentType: detail.participant.resume.contentType,
            bytes: detail.participant.resume.bytes,
            uploadedAt: detail.participant.resume.uploadedAt,
          }) : undefined}
        />
        <DetailRow label="Resume size" value={detail.participant.resume ? formatBytes(detail.participant.resume.bytes) : null} />
        <DetailRow label="Resume uploaded" value={detail.participant.resume?.uploadedAt ? formatDate(detail.participant.resume.uploadedAt) : null} />
      </DetailSection>
    </div>
    {detail.participant.blurb || detail.participant.interests || detail.participant.prior_feedback ? <div>
      <SectionTitle>Enrollment context</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        {detail.participant.blurb ? <ProfileNote className="lg:col-span-2" label="Ideal role and motivation" value={detail.participant.blurb} /> : null}
        {detail.participant.interests ? <ProfileNote label="Other learning interests" value={detail.participant.interests} /> : null}
        {detail.participant.prior_feedback ? <ProfileNote label="Prior-program feedback" value={detail.participant.prior_feedback} /> : null}
      </div>
    </div> : null}
    <div>
      <SectionTitle>Sessions & survey links</SectionTitle>
      <div className="overflow-hidden rounded-xl border border-border">
        {detail.sessions.length ? detail.sessions.map((session) => <div key={session.id} className="border-b border-border px-4 py-3 last:border-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-bold text-foreground">R{session.round} · #{session.id}</span>
            <span className="text-sm text-muted-foreground">{session.interviewer_name} → {session.interviewee_name}</span>
            <Badge value={session.state} />
            <span className="ml-auto text-xs text-muted-foreground">{session.reports_in}/2 reports</span>
          </div>
          <ParticipantSurveyLinks session={session} />
        </div>) : <div className="p-4 text-sm text-muted-foreground">No sessions yet.</div>}
      </div>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <SectionTitle>Incidents</SectionTitle>
        {detail.incidents.length ? detail.incidents.map((incident) => <div key={incident.id} className="mb-2 rounded-xl border border-border p-3 text-sm">
          <Badge value={incident.kind} /> <span className="ml-2 text-muted-foreground">{incident.state} · {formatDate(incident.created_at)}</span>
        </div>) : <p className="text-sm text-muted-foreground">No incidents.</p>}
      </div>
      <div>
        <SectionTitle>Audit history</SectionTitle>
        {detail.audit.length ? detail.audit.map((row) => <div key={row.id} className="mb-2 text-sm">
          <span className="font-semibold text-foreground">{row.action.replaceAll('.', ' ')}</span>
          <span className="ml-2 text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
        </div>) : <p className="text-sm text-muted-foreground">No organizer actions recorded.</p>}
      </div>
    </div>
  </div>;
}

function ParticipantSurveyLinks({ session }: { session: ParticipantDetail['sessions'][number] }) {
  const [copyState, setCopyState] = useState<{ id: number; status: 'copied' | 'failed' } | null>(null);
  useEffect(() => {
    if (!copyState) return;
    const timer = window.setTimeout(() => setCopyState(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const copyLink = async (id: number, url: string) => {
    try {
      await copyText(new URL(url, window.location.origin).href);
      setCopyState({ id, status: 'copied' });
    } catch {
      setCopyState({ id, status: 'failed' });
    }
  };
  if (!session.forms.length) return <p className="mt-2 text-xs text-muted-foreground">This participant’s survey link will appear within 30 minutes of the scheduled session.</p>;
  return <div className="mt-2 flex flex-wrap gap-2">{session.forms.map((form) => {
    const label = form.kind === 'interviewer_report' ? 'Interviewer survey' : 'Interviewee survey';
    if (!form.url) return <span key={form.id} className="rounded-lg bg-muted px-2.5 py-1.5 text-xs font-bold text-muted-foreground">{label} · link expired</span>;
    const state = copyState?.id === form.id ? copyState.status : null;
    return <div key={form.id} className="flex items-center gap-1.5">
      <div className="inline-flex overflow-hidden rounded-lg border border-western-200 bg-western-50 dark:border-western-800/70 dark:bg-western-950/40">
        <button type="button" onClick={() => void copyLink(form.id, form.url!)} className="cursor-pointer px-2.5 py-1.5 text-xs font-bold text-western-800 transition hover:bg-western-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-western-500 focus-visible:ring-inset dark:text-western-200 dark:hover:bg-western-900/50">
          {state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : `Copy ${label.toLowerCase()} link`}
        </button>
        <a aria-label={`Open ${label.toLowerCase()}`} href={form.url} target="_blank" rel="noreferrer" title="Open survey" className="inline-flex items-center border-l border-western-200 px-2 py-1.5 text-xs font-black text-western-700 transition hover:bg-western-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-western-500 focus-visible:ring-inset dark:border-western-800/70 dark:text-western-300 dark:hover:bg-western-900/50">↗</a>
      </div>
      {form.submitted_at ? <span className="text-[0.68rem] font-bold text-emerald-700 dark:text-emerald-400">Submitted</span> : null}
    </div>;
  })}</div>;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; } catch { /* fall through */ }
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset:0 auto auto 0;opacity:0;pointer-events:none';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Clipboard access was denied.');
}

function Fact({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return <div className="rounded-xl bg-muted/60 p-3"><div className="text-[0.65rem] font-black uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-sm font-bold text-foreground">{children ?? value}</div></div>;
}
function DetailSection({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border p-4 ${className}`}><SectionTitle>{title}</SectionTitle><dl className="divide-y divide-border">{children}</dl></section>;
}
function DetailRow({ label, value, link, onAction }: { label: string; value?: string | null; link?: 'email' | 'url'; onAction?: () => void }) {
  const destination = link === 'email' && value ? `mailto:${value}` : link === 'url' && value ? value : null;
  const content = value || 'Not provided';
  return <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5 text-sm first:pt-0 last:pb-0"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words font-semibold text-foreground">{onAction ? <button type="button" className="cursor-pointer text-left text-western-700 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-western-300" onClick={onAction}>{content} · Preview</button> : destination ? <a className="text-western-700 hover:underline dark:text-western-300" href={destination} target={link === 'email' ? undefined : '_blank'} rel={link === 'email' ? undefined : 'noreferrer'}>{content}</a> : content}</dd></div>;
}
function ProfileNote({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return <div className={`rounded-xl border border-border bg-muted/40 p-4 ${className}`}><div className="text-[0.65rem] font-black uppercase tracking-wider text-muted-foreground">{label}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/80">{value}</p></div>;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">{children}</h3>;
}
function parseChoices(value: unknown): string[] {
  if (!value) return [];
  try {
    const choices = Array.isArray(value) ? value : JSON.parse(String(value));
    return Array.isArray(choices) ? choices.map(String) : [];
  } catch { return [String(value)]; }
}
function formatChoices(value: unknown) {
  const choices = parseChoices(value);
  return choices.length ? choices.map((choice) => choice.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())).join(', ') : 'Not provided';
}
function formatBytes(value: number | null | undefined) {
  if (value == null) return 'Size unavailable';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
