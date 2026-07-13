import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ParticipantDetail, ParticipantRow, ParticipantsData } from '../../admin-types';
import { adminRequest } from '../../api';
import { Badge, Button, Dialog, DialogClose, EmptyState, ErrorState, formatDate, inputClass, LoadingState, PageIntro, Panel, tableClass, tdClass, thClass } from '../../components/AdminUI';
import { ScrollArea } from '../../components/ui/scroll-area';
import { useAdminData } from '../../hooks/useAdminData';
import { SelectControl } from '../../components/SelectControl';

const PARTICIPANT_STATUSES = ['active', 'paused', 'held', 'removed', 'completed'];
const STATUS_OPTIONS = PARTICIPANT_STATUSES.map((value) => ({ value, label: value }));

export function ParticipantsPage() {
  const { data, error, loading, reload } = useAdminData<ParticipantsData>('/participants');
  const [query, setQuery] = useState(''); const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState('all'); const [year, setYear] = useState('all'); const [program, setProgram] = useState('all');
  const [experience, setExperience] = useState('all'); const [opportunity, setOpportunity] = useState('all'); const [topic, setTopic] = useState('all');
  const [roundState, setRoundState] = useState('all'); const [attention, setAttention] = useState('all'); const [email, setEmail] = useState('all');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [detail, setDetail] = useState<ParticipantDetail | null>(null); const [detailLoading, setDetailLoading] = useState(false);
  const [bulkOpen, setBulkOpen] = useState<'status' | 'message' | null>(null); const [busy, setBusy] = useState(false); const [syncing, setSyncing] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  const options = useMemo(() => ({
    years: uniqueValues(data?.participants.map((row) => row.year) ?? []),
    programs: uniqueValues(data?.participants.map((row) => row.program) ?? []),
    experience: uniqueValues(data?.participants.map((row) => row.experience_band) ?? []),
    opportunities: uniqueValues(data?.participants.flatMap((row) => parseChoices(row.opportunities)) ?? []),
    topics: uniqueValues(data?.participants.flatMap((row) => parseChoices(row.topics)) ?? []),
  }), [data]);
  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return (data?.participants ?? []).filter((participant) => {
      const hasAttention = participant.strikes > 0 || participant.reports_owed > 0;
      const searchable = [participant.name, participant.discord_nickname, participant.discord_username, participant.discord_id, participant.preferred_email, participant.western_email, participant.program, participant.year, participant.experience_band, participant.opportunities, participant.topics, participant.blurb, participant.interests, participant.prior_feedback, participant.removed_reason];
      return (status === 'all' || participant.status === status)
        && (year === 'all' || participant.year === year)
        && (program === 'all' || participant.program === program)
        && (experience === 'all' || participant.experience_band === experience)
        && (opportunity === 'all' || parseChoices(participant.opportunities).includes(opportunity))
        && (topic === 'all' || parseChoices(participant.topics).includes(topic))
        && (roundState === 'all' || (roundState === 'in' ? participant.opted_in > 0 : participant.opted_in === 0))
        && (email === 'all' || (email === 'enabled' ? participant.email_ok > 0 : participant.email_ok === 0))
        && (attention === 'all' || (attention === 'any' && hasAttention) || (attention === 'reports' && participant.reports_owed > 0) || (attention === 'strikes' && participant.strikes > 0) || (attention === 'clear' && !hasAttention))
        && (!needle || searchable.some((value) => String(value ?? '').toLowerCase().includes(needle)));
    });
  }, [attention, data, deferredQuery, email, experience, opportunity, program, roundState, status, topic, year]);
  const activeFilters = [status, year, program, experience, opportunity, topic, roundState, attention, email].filter((value) => value !== 'all').length;
  const clearFilters = () => { setStatus('all'); setYear('all'); setProgram('all'); setExperience('all'); setOpportunity('all'); setTopic('all'); setRoundState('all'); setAttention('all'); setEmail('all'); };
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No roster returned.'} onRetry={() => void reload()} />;

  const allVisibleSelected = filtered.length > 0 && filtered.every((row) => selected.has(row.id));
  const toggleAll = () => setSelected((current) => { const next = new Set(current); if (allVisibleSelected) filtered.forEach((row) => next.delete(row.id)); else filtered.forEach((row) => next.add(row.id)); return next; });
  const openDetail = async (participant: ParticipantRow) => { setDetailLoading(true); setDetail(null); try { setDetail(await adminRequest<ParticipantDetail>(`/participants/${participant.id}`)); } finally { setDetailLoading(false); } };
  const runStatus = async (value: string, note: string) => { setBusy(true); try { const result = await adminRequest<{ updated: number }>('/participants/status', { method: 'POST', body: JSON.stringify({ ids: [...selected], status: value, note }) }); setNotice(`${result.updated} participant${result.updated === 1 ? '' : 's'} updated.`); setSelected(new Set()); setBulkOpen(null); await reload(); } finally { setBusy(false); } };
  const runMessage = async (channel: string, message: string) => { setBusy(true); try { const result = await adminRequest<{ queued: number; skipped: number }>('/participants/message', { method: 'POST', body: JSON.stringify({ ids: [...selected], channel, message }) }); setNotice(`${result.queued} message${result.queued === 1 ? '' : 's'} queued${result.skipped ? `; ${result.skipped} skipped` : ''}.`); setSelected(new Set()); setBulkOpen(null); } finally { setBusy(false); } };
  const syncDiscord = async () => { setSyncing(true); try { const result = await adminRequest<{ queued: number }>('/participants/sync-discord', { method: 'POST', body: '{}' }); setNotice(`${result.queued} Discord identit${result.queued === 1 ? 'y' : 'ies'} queued for refresh. Updated names will appear as the outbox drains.`); } finally { setSyncing(false); } };

  return <div className="space-y-7 xl:flex xl:h-[calc(100dvh-9rem)] xl:min-h-[38rem] xl:flex-col xl:space-y-0 xl:gap-7">
    <PageIntro title="Participants" description="Search the roster, inspect a participant’s full history, and take deliberate bulk actions." actions={<><Button variant="secondary" disabled={syncing} onClick={() => void syncDiscord()}>{syncing ? 'Queueing sync…' : 'Sync Discord identities'}</Button><a href="/api/admin/participants.csv" className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Export CSV</a></>} />
    {notice ? <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div> : null}
    <Panel className="relative xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
      <div className="space-y-3 border-b border-slate-100 p-4 dark:border-border">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input className={`${inputClass} lg:max-w-md`} type="search" placeholder="Search any participant field…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="text-xs font-semibold text-muted-foreground lg:ml-auto">{filtered.length} of {data.participants.length}</div>
          {activeFilters ? <button className="text-xs font-bold text-western-700 hover:text-western-900 dark:text-western-300" onClick={clearFilters}>Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}</button> : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <SelectControl label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, ...STATUS_OPTIONS]} />
          <SelectControl label="Incoming year" value={year} onChange={setYear} options={filterOptions('All years', options.years)} />
          <SelectControl label="Program" value={program} onChange={setProgram} options={filterOptions('All programs', options.programs)} />
          <SelectControl label="Interview experience" value={experience} onChange={setExperience} options={filterOptions('All experience levels', options.experience)} />
          <SelectControl label="Opportunity" value={opportunity} onChange={setOpportunity} options={filterOptions('All opportunities', options.opportunities)} />
          <SelectControl label="Topic" value={topic} onChange={setTopic} options={filterOptions('All topics', options.topics)} />
          <SelectControl label="Current round" value={roundState} onChange={setRoundState} options={[{ value: 'all', label: 'Any round status' }, { value: 'in', label: 'Opted in' }, { value: 'out', label: 'Not opted in' }]} />
          <SelectControl label="Needs attention" value={attention} onChange={setAttention} options={[{ value: 'all', label: 'Any attention state' }, { value: 'any', label: 'Anything outstanding' }, { value: 'reports', label: 'Reports owed' }, { value: 'strikes', label: 'Has strikes' }, { value: 'clear', label: 'Nothing outstanding' }]} />
          <SelectControl label="Email reminders" value={email} onChange={setEmail} options={[{ value: 'all', label: 'Any reminder setting' }, { value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }]} />
        </div>
      </div>
      {selected.size ? <div className="absolute inset-x-4 bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/95 px-4 py-2.5 text-white shadow-xl shadow-slate-950/20 backdrop-blur-xl motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"><span className="mr-2 text-xs font-bold tabular-nums">{selected.size} selected</span><Button variant="secondary" className="!border-white/10 !bg-white/10 !py-1.5 !text-white hover:!bg-white/15" onClick={() => setBulkOpen('status')}>Change status</Button><Button variant="secondary" className="!border-white/10 !bg-white/10 !py-1.5 !text-white hover:!bg-white/15" onClick={() => setBulkOpen('message')}>Send message</Button><button className="ml-auto text-xs font-bold text-slate-300 hover:text-white" onClick={() => setSelected(new Set())}>Clear</button></div> : null}
      {filtered.length ? <ScrollArea horizontal className="h-[min(62vh,42rem)] overscroll-contain xl:h-auto xl:min-h-0 xl:flex-1"><div className="min-w-max pb-20 pr-3 [&_th]:sticky [&_th]:top-0 [&_th]:z-10"><table className={tableClass}>
        <thead><tr><th className={`${thClass} w-10`}><input type="checkbox" aria-label="Select visible participants" checked={allVisibleSelected} onChange={toggleAll} /></th><th className={thClass}>Participant</th><th className={thClass}>Contact</th><th className={thClass}>Education</th><th className={thClass}>Opportunities</th><th className={thClass}>Experience</th><th className={thClass}>Topics</th><th className={thClass}>Prior WTA</th><th className={thClass}>Ideal role & motivation</th><th className={thClass}>Other interests</th><th className={thClass}>Prior feedback</th><th className={thClass}>Current round</th><th className={thClass}>Progress</th><th className={thClass}>Reports</th><th className={thClass}>Strikes</th><th className={thClass}>Email</th><th className={thClass}>Pairing</th><th className={thClass}>Status</th><th className={thClass}>Joined</th><th className={thClass}>Updated</th></tr></thead>
        <tbody>{filtered.map((participant) => <tr key={participant.id} className="group hover:bg-slate-50/70 dark:hover:bg-white/5">
          <td className={tdClass}><input type="checkbox" aria-label={`Select ${participant.name}`} checked={selected.has(participant.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(participant.id)) next.delete(participant.id); else next.add(participant.id); return next; })} /></td>
          <td className={tdClass}><button className="cursor-pointer text-left" onClick={() => void openDetail(participant)}><span className="block font-bold text-foreground group-hover:text-western-700 dark:group-hover:text-western-300">{participant.name ?? '(unnamed)'}</span><span className="mt-1 block text-xs font-semibold text-muted-foreground">Nickname: {participant.discord_nickname ?? 'not synced'}</span><span className="block text-xs font-semibold text-indigo-600 dark:text-indigo-300">{participant.discord_username ? `@${participant.discord_username}` : 'Discord not synced'}</span><span className="block font-mono text-[0.65rem] text-muted-foreground">{participant.discord_id}</span></button></td>
          <td className={tdClass}><a className="block text-xs font-semibold text-western-700 hover:underline dark:text-western-300" href={participant.preferred_email ? `mailto:${participant.preferred_email}` : undefined}>{participant.preferred_email ?? '—'}</a><a className="mt-1 block text-xs text-muted-foreground hover:underline" href={participant.western_email ? `mailto:${participant.western_email}` : undefined}>{participant.western_email ?? '—'}</a></td>
          <td className={tdClass}><span className="block font-semibold text-foreground">{participant.year ?? '—'}</span><span className="mt-1 block text-xs text-muted-foreground">{participant.program ?? '—'}</span></td>
          <td className={tdClass}><ChoiceList value={participant.opportunities} /></td>
          <td className={tdClass}>{participant.experience_band ?? '—'}</td>
          <td className={tdClass}><ChoiceList value={participant.topics} /></td>
          <td className={tdClass}>{participant.prior_wta ? 'Yes' : 'No'}</td>
          <td className={tdClass}><TextPreview value={participant.blurb} /></td>
          <td className={tdClass}><TextPreview value={participant.interests} /></td>
          <td className={tdClass}><TextPreview value={participant.prior_feedback} /></td>
          <td className={tdClass}>{data.currentWeek ? <Badge value={participant.opted_in ? `Round ${data.currentWeek.idx}: opted in` : `Round ${data.currentWeek.idx}: not opted in`} /> : <span className="text-muted-foreground">No active round</span>}</td>
          <td className={tdClass}><span className="font-bold tabular-nums text-slate-800">{participant.interviewer_credits}/3 · {participant.interviewee_credits}/3</span><span className="mt-1 block text-[0.68rem] text-slate-400">interviewer · interviewee</span></td>
          <td className={tdClass}><SignalCount value={participant.reports_owed} singular="owed" /></td>
          <td className={tdClass}><SignalCount value={participant.strikes} singular="strike" /></td>
          <td className={tdClass}>{participant.email_ok ? 'Enabled' : 'Disabled'}</td>
          <td className={tdClass}>{participant.pairing_excluded ? <Badge value="Excluded" /> : 'Eligible'}</td>
          <td className={tdClass}><Badge value={participant.status} />{participant.removed_reason ? <span className="mt-1 block max-w-40 text-xs text-muted-foreground">{participant.removed_reason}</span> : null}</td>
          <td className={tdClass}><span className="whitespace-nowrap text-xs">{formatDate(participant.created_at, false)}</span></td>
          <td className={tdClass}><span className="whitespace-nowrap text-xs">{formatDate(participant.updated_at, false)}</span></td>
        </tr>)}</tbody>
      </table></div></ScrollArea> : <EmptyState title="No participants match" description="Try a broader search or a different status filter." />}
    </Panel>
    {(detail || detailLoading) ? <ParticipantDrawer detail={detail} loading={detailLoading} onClose={() => { setDetail(null); setDetailLoading(false); }} /> : null}
    {bulkOpen === 'status' ? <StatusDialog count={selected.size} busy={busy} onClose={() => setBulkOpen(null)} onSubmit={runStatus} /> : null}
    {bulkOpen === 'message' ? <MessageDialog count={selected.size} busy={busy} onClose={() => setBulkOpen(null)} onSubmit={runMessage} /> : null}
  </div>;
}

function ParticipantDrawer({ detail, loading, onClose }: { detail: ParticipantDetail | null; loading: boolean; onClose: () => void }) {
  return <Dialog wide title={detail?.participant.name ?? 'Participant'} description={detail ? `Server nickname: ${detail.participant.discord_nickname ?? 'not synced'} · Discord: ${detail.participant.discord_username ? `@${detail.participant.discord_username}` : 'not synced'} · ID ${detail.participant.discord_id}` : 'Loading participant history…'} onClose={onClose}>
    {loading || !detail ? <LoadingState /> : <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Fact label="Status"><Badge value={detail.participant.status} /></Fact><Fact label="Program" value={`${detail.participant.year ?? '—'} · ${detail.participant.program ?? '—'}`} /><Fact label="Experience" value={detail.participant.experience_band ?? '—'} /><Fact label="Joined" value={formatDate(detail.participant.created_at, false)} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <DetailSection title="Contact"><DetailRow label="Preferred email" value={detail.participant.preferred_email} link="email" /><DetailRow label="UWO email" value={detail.participant.western_email} link="email" /><DetailRow label="Email reminders" value={detail.participant.email_ok ? 'Enabled' : 'Discord only'} /><DetailRow label="Profile updated" value={formatDate(detail.participant.updated_at)} /></DetailSection>
        <DetailSection title="Enrollment profile"><DetailRow label="Targeting" value={formatChoices(detail.participant.opportunities)} /><DetailRow label="Practice topics" value={formatChoices(detail.participant.topics)} /><DetailRow label="Prior WTA" value={detail.participant.prior_wta ? 'Yes' : 'No'} />{detail.participant.removed_reason ? <DetailRow label="Removal reason" value={detail.participant.removed_reason} /> : null}</DetailSection>
      </div>
      {detail.participant.blurb || detail.participant.interests || detail.participant.prior_feedback ? <div><SectionTitle>Enrollment context</SectionTitle><div className="grid gap-3 lg:grid-cols-2">{detail.participant.blurb ? <ProfileNote className="lg:col-span-2" label="Ideal role and motivation" value={detail.participant.blurb} /> : null}{detail.participant.interests ? <ProfileNote label="Other learning interests" value={detail.participant.interests} /> : null}{detail.participant.prior_feedback ? <ProfileNote label="Prior-program feedback" value={detail.participant.prior_feedback} /> : null}</div></div> : null}
      <div><SectionTitle>Sessions & survey links</SectionTitle><div className="overflow-hidden rounded-xl border border-slate-200 dark:border-border">{detail.sessions.length ? detail.sessions.map((session) => <div key={session.id} className="border-b border-slate-100 px-4 py-3 last:border-0 dark:border-border"><div className="flex flex-wrap items-center gap-x-4 gap-y-1"><span className="font-bold text-slate-900 dark:text-foreground">R{session.round} · #{session.id}</span><span className="text-sm text-slate-600 dark:text-muted-foreground">{session.interviewer_name} → {session.interviewee_name}</span><Badge value={session.state} /><span className="ml-auto text-xs text-slate-500 dark:text-muted-foreground">{session.reports_in}/2 reports</span></div><ParticipantSurveyLinks session={session} /></div>) : <div className="p-4 text-sm text-slate-500">No sessions yet.</div>}</div></div>
      <div className="grid gap-5 lg:grid-cols-2"><div><SectionTitle>Incidents</SectionTitle>{detail.incidents.length ? detail.incidents.map((incident) => <div key={incident.id} className="mb-2 rounded-xl border border-slate-200 p-3 text-sm"><Badge value={incident.kind} /> <span className="ml-2 text-slate-600">{incident.state} · {formatDate(incident.created_at)}</span></div>) : <p className="text-sm text-slate-500">No incidents.</p>}</div><div><SectionTitle>Audit history</SectionTitle>{detail.audit.length ? detail.audit.map((row) => <div key={row.id} className="mb-2 text-sm"><span className="font-semibold text-slate-800">{row.action.replaceAll('.', ' ')}</span><span className="ml-2 text-xs text-slate-500">{formatDate(row.created_at)}</span></div>) : <p className="text-sm text-slate-500">No organizer actions recorded.</p>}</div></div>
    </div>}
  </Dialog>;
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
  if (!session.forms.length) return <p className="mt-2 text-xs text-slate-500 dark:text-muted-foreground">This participant’s survey link will appear within 30 minutes of the scheduled session.</p>;
  return <div className="mt-2 flex flex-wrap gap-2">{session.forms.map((form) => {
    const label = form.kind === 'interviewer_report' ? 'Interviewer survey' : 'Interviewee survey';
    if (!form.url) return <span key={form.id} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-500 dark:bg-muted dark:text-muted-foreground">{label} · link expired</span>;
    const state = copyState?.id === form.id ? copyState.status : null;
    return <div key={form.id} className="flex items-center gap-1.5"><div className="inline-flex overflow-hidden rounded-lg border border-western-200 bg-western-50 dark:border-western-800/70 dark:bg-western-950/40"><button type="button" onClick={() => void copyLink(form.id, form.url!)} className="cursor-pointer px-2.5 py-1.5 text-xs font-bold text-western-800 transition hover:bg-western-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-western-500 focus-visible:ring-inset dark:text-western-200 dark:hover:bg-western-900/50">{state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : `Copy ${label.toLowerCase()} link`}</button><a aria-label={`Open ${label.toLowerCase()}`} href={form.url} target="_blank" rel="noreferrer" title="Open survey" className="inline-flex items-center border-l border-western-200 px-2 py-1.5 text-xs font-black text-western-700 transition hover:bg-western-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-western-500 focus-visible:ring-inset dark:border-western-800/70 dark:text-western-300 dark:hover:bg-western-900/50">↗</a></div>{form.submitted_at ? <span className="text-[0.68rem] font-bold text-emerald-700 dark:text-emerald-400">Submitted</span> : null}</div>;
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
function Fact({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) { return <div className="rounded-xl bg-slate-50 p-3"><div className="text-[0.65rem] font-black uppercase tracking-wider text-slate-400">{label}</div><div className="mt-1 text-sm font-bold text-slate-800">{children ?? value}</div></div>; }
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border border-slate-200 p-4"><SectionTitle>{title}</SectionTitle><dl className="divide-y divide-slate-100">{children}</dl></section>; }
function DetailRow({ label, value, link }: { label: string; value?: string | null; link?: 'email' }) { const content = value || 'Not provided'; return <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-2.5 text-sm first:pt-0 last:pb-0"><dt className="text-slate-500">{label}</dt><dd className="min-w-0 break-words font-semibold text-slate-800">{link === 'email' && value ? <a className="text-indigo-600 hover:underline" href={`mailto:${value}`}>{value}</a> : content}</dd></div>; }
function ProfileNote({ label, value, className = '' }: { label: string; value: string; className?: string }) { return <div className={`rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:bg-muted/50 ${className}`}><div className="text-[0.65rem] font-black uppercase tracking-wider text-slate-400">{label}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value}</p></div>; }
function SectionTitle({ children }: { children: React.ReactNode }) { return <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">{children}</h3>; }
function parseChoices(value: unknown): string[] { if (!value) return []; try { const choices = Array.isArray(value) ? value : JSON.parse(String(value)); return Array.isArray(choices) ? choices.map(String) : []; } catch { return [String(value)]; } }
function formatChoices(value: unknown) { const choices = parseChoices(value); return choices.length ? choices.map(formatChoice).join(', ') : 'Not provided'; }
function formatChoice(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function uniqueValues(values: Array<string | null | undefined>) { return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)); }
function filterOptions(allLabel: string, values: string[]) { return [{ value: 'all', label: allLabel }, ...values.map((value) => ({ value, label: formatChoice(value) }))]; }
function ChoiceList({ value }: { value: unknown }) { const choices = parseChoices(value); return choices.length ? <div className="flex max-w-64 flex-wrap gap-1">{choices.map((choice) => <span key={choice} className="rounded-full bg-muted px-2 py-0.5 text-[0.68rem] font-semibold text-muted-foreground">{formatChoice(choice)}</span>)}</div> : <span className="text-muted-foreground">—</span>; }
function TextPreview({ value }: { value: string | null }) { return value ? <span title={value} className="block max-w-64 truncate text-xs text-muted-foreground">{value}</span> : <span className="text-muted-foreground">—</span>; }
function SignalCount({ value, singular }: { value: number; singular: string }) { return value ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{value} {singular}{value === 1 ? '' : 's'}</span> : <span className="text-muted-foreground">0</span>; }
function StatusDialog({ count, busy, onClose, onSubmit }: { count: number; busy: boolean; onClose: () => void; onSubmit: (status: string, note: string) => Promise<void> }) { const [status, setStatus] = useState('active'); const [note, setNote] = useState(''); return <Dialog title={`Change status for ${count}`} description="Status changes affect matching eligibility immediately and are written to the audit log." onClose={onClose} actions={<><DialogClose><Button variant="secondary">Cancel</Button></DialogClose><Button disabled={busy} onClick={() => void onSubmit(status, note)}>{busy ? 'Saving…' : 'Apply change'}</Button></>}><label className="text-sm font-bold text-slate-800">New status<span className="mt-2 block"><SelectControl label="New status" value={status} onChange={setStatus} options={STATUS_OPTIONS} /></span></label><label className="mt-4 block text-sm font-bold text-slate-800">Internal note <span className="font-normal text-slate-400">(optional)</span><textarea className={`${inputClass} mt-2 min-h-24`} value={note} onChange={(event) => setNote(event.target.value)} /></label></Dialog>; }
function MessageDialog({ count, busy, onClose, onSubmit }: { count: number; busy: boolean; onClose: () => void; onSubmit: (channel: string, message: string) => Promise<void> }) { const [channel, setChannel] = useState('dm'); const [message, setMessage] = useState(''); return <Dialog title={`Message ${count} participant${count === 1 ? '' : 's'}`} description="Messages enter the durable outbox. Email is sent only to participants who opted in." onClose={onClose} actions={<><DialogClose><Button variant="secondary">Cancel</Button></DialogClose><Button disabled={busy || !message.trim()} onClick={() => void onSubmit(channel, message)}>{busy ? 'Queueing…' : 'Queue messages'}</Button></>}><label className="text-sm font-bold text-slate-800">Channel<span className="mt-2 block"><SelectControl label="Message channel" value={channel} onChange={setChannel} options={[{ value: 'dm', label: 'Discord DM' }, { value: 'email', label: 'Email (opted-in only)' }]} /></span></label><label className="mt-4 block text-sm font-bold text-slate-800">Message<textarea autoFocus maxLength={1900} className={`${inputClass} mt-2 min-h-36`} value={message} onChange={(event) => setMessage(event.target.value)} /></label><div className="mt-1 text-right text-xs tabular-nums text-slate-400">{message.length}/1900</div></Dialog>; }
