import { useId, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, ChevronDown, Link2, MousePointerClick } from 'lucide-react';
import type { OperationsData, OutboxRow } from '../../admin-types';
import { adminRequest } from '../../api';
import { Badge, Button, EmptyState, ErrorState, formatDate, LoadingState, PageIntro, Panel, tableClass, tdClass, thClass, Tabs } from '../../components/AdminUI';
import { ScrollArea } from '../../components/ui/scroll-area';
import { useAdminData } from '../../hooks/useAdminData';
import { LIVE_REFRESH_INTERVAL_MS } from '../../hooks/useAutoRefresh';

export function OperationsPage() {
  const { data, error, loading, reload } = useAdminData<OperationsData>('/operations', LIVE_REFRESH_INTERVAL_MS); const [tab, setTab] = useState('outbox'); const [retrying, setRetrying] = useState<number | null>(null); const [dismissing, setDismissing] = useState<number | null>(null);
  const failed = useMemo(() => data?.outbox.filter((row) => !row.done_at && !row.dismissed_at && row.attempts >= 5).length ?? 0, [data]);
  if (loading && !data) return <LoadingState />; if (error || !data) return <ErrorState message={error ?? 'No operations data returned.'} onRetry={() => void reload()} />;
  const retry = async (row: OutboxRow) => { setRetrying(row.id); try { await adminRequest(`/operations/outbox/${row.id}/retry`, { method: 'POST', body: '{}' }); await reload(); } finally { setRetrying(null); } };
  const dismiss = async (row: OutboxRow) => { setDismissing(row.id); try { await adminRequest(`/operations/outbox/${row.id}/dismiss`, { method: 'POST', body: '{}' }); await reload(); } finally { setDismissing(null); } };
  return <div className="flex min-h-[34rem] flex-col gap-5 lg:h-[calc(100dvh-9rem)] lg:min-h-0"><PageIntro title="Operations" description="Delivery, scheduled work, and organizer actions—the evidence you need when something feels off." />
    {failed ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-900/60 dark:bg-rose-950/25"><div className="text-sm font-extrabold text-rose-900 dark:text-rose-200">{failed} {failed === 1 ? 'delivery needs' : 'deliveries need'} attention</div><p className="mt-0.5 text-xs leading-5 text-rose-700 dark:text-rose-300/80">Automatic retries have stopped. Review the suggested fix, then retry or dismiss the item.</p></div> : null}
    <div className="flex"><Tabs value={tab} onChange={setTab} items={[{ value: 'outbox', label: 'Delivery queue', count: data.outbox.filter((row) => !row.done_at && !row.dismissed_at).length }, { value: 'enrollment', label: 'Enrollment activity', count: data.enrollmentFunnel.generated }, { value: 'notifications', label: 'Notification history', count: data.notifications.length }, { value: 'jobs', label: 'Scheduled runs', count: data.jobs.length }, { value: 'audit', label: 'Audit log', count: data.audit.length }]} /></div>
    <div className="min-h-0 flex-1">{tab === 'outbox' ? <OutboxPanel rows={data.outbox} retrying={retrying} dismissing={dismissing} onRetry={retry} onDismiss={dismiss} /> : tab === 'enrollment' ? <EnrollmentPanel funnel={data.enrollmentFunnel} /> : tab === 'notifications' ? <NotificationsPanel rows={data.notifications} /> : tab === 'jobs' ? <JobsPanel rows={data.jobs} cron={data.cron} /> : <AuditPanel rows={data.audit} />}</div>
  </div>;
}

function EnrollmentPanel({ funnel }: { funnel: OperationsData['enrollmentFunnel'] }) {
  const [view, setView] = useState('links');
  const stages = [
    { label: 'Link generated', value: funnel.generated, note: `${funnel.totalLinksIssued} total ${funnel.totalLinksIssued === 1 ? 'link' : 'links'} issued`, icon: Link2, tone: 'bg-western-100 text-western-800 dark:bg-western-950/70 dark:text-western-300' },
    { label: 'Form opened', value: funnel.opened, note: conversion(funnel.opened, funnel.generated, 'of link holders'), icon: MousePointerClick, tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
    { label: 'Enrolled', value: funnel.completed, note: conversion(funnel.completed, funnel.opened, 'of form openers'), icon: CheckCircle2, tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' },
  ];
  return <Panel className="flex h-full min-h-0 flex-col" title="Enrollment activity" description="First-time enrollment funnel plus an exact history of every generated link." actions={<Tabs value={view} onChange={setView} items={[{ value: 'links', label: 'Link history', count: funnel.totalLinksIssued }, { value: 'people', label: 'Funnel by person', count: funnel.generated }]} />}>
    <div className="grid shrink-0 gap-3 border-b border-slate-100 p-4 sm:grid-cols-3 dark:border-white/10">{stages.map(({ label, value, note, icon: Icon, tone }, index) => <div key={label} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[.025]" style={{ animationDelay: `${index * 45}ms` }}><div className="flex items-center justify-between gap-3"><span className={`grid size-8 place-items-center rounded-lg ${tone}`}><Icon aria-hidden="true" className="size-4" /></span><span className="text-2xl font-black tabular-nums text-slate-950">{value}</span></div><div className="mt-3 text-xs font-extrabold text-slate-900">{label}</div><div className="mt-0.5 text-[0.68rem] text-slate-500">{note}</div></div>)}</div>
    {view === 'links' ? <LinkHistory funnel={funnel} /> : <FunnelPeople funnel={funnel} />}
  </Panel>;
}

function LinkHistory({ funnel }: { funnel: OperationsData['enrollmentFunnel'] }) {
  return funnel.recentLinks.length ? <OperationsTable rowCount={funnel.recentLinks.length}><table className={tableClass}><thead><tr><th className={thClass}>Generated</th><th className={thClass}>Person</th><th className={thClass}>Entry point</th><th className={thClass}>Purpose</th></tr></thead><tbody>{funnel.recentLinks.map((event) => <tr key={event.id}><td className={tdClass}><div>{formatDate(event.created_at)}</div><div className="mt-0.5 font-mono text-[0.65rem] text-slate-400">Link event #{event.id}</div></td><td className={tdClass}><div className="font-semibold text-slate-900">{event.display_name}</div><div className="mt-0.5 text-xs text-slate-500">{event.discord_username ? `@${event.discord_username}` : `Discord ${event.discord_id}`}</div></td><td className={`${tdClass} font-semibold text-slate-800`}>{event.source === 'join_button' ? 'Join WTA button' : '/join command'}</td><td className={tdClass}><span className={`inline-flex rounded-full border px-2 py-0.5 text-[0.68rem] font-extrabold ${event.flow === 'profile_edit' ? 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300' : 'border-western-200 bg-western-50 text-western-800 dark:border-western-800 dark:bg-western-950/50 dark:text-western-300'}`}>{event.flow === 'profile_edit' ? 'Profile edit' : 'New enrollment'}</span></td></tr>)}</tbody></table></OperationsTable> : <EmptyState title="No links generated yet" description="Every Join WTA button press and /join command will appear here." />;
}

function FunnelPeople({ funnel }: { funnel: OperationsData['enrollmentFunnel'] }) {
  return funnel.people.length ? <OperationsTable rowCount={funnel.people.length}><table className={tableClass}><thead><tr><th className={thClass}>Person</th><th className={thClass}>Current stage</th><th className={thClass}>Link generated</th><th className={thClass}>Form opened</th><th className={thClass}>Enrolled</th><th className={thClass}>Links</th></tr></thead><tbody>{funnel.people.map((person) => <tr key={person.discord_id}><td className={tdClass}><div className="font-semibold text-slate-900">{person.display_name}</div><div className="mt-0.5 text-xs text-slate-500">{person.discord_username ? `@${person.discord_username}` : `Discord ${person.discord_id}`}</div></td><td className={tdClass}><EnrollmentStatus value={person.status} /></td><td className={tdClass}>{formatDate(person.generated_at)}</td><td className={tdClass}>{formatDate(person.opened_at)}</td><td className={tdClass}>{formatDate(person.completed_at)}</td><td className={`${tdClass} text-center font-bold tabular-nums text-slate-900`}>{person.links_issued}</td></tr>)}</tbody></table></OperationsTable> : <EmptyState title="No enrollment activity yet" description="People will appear here after they generate their first Join WTA link." />;
}

function EnrollmentStatus({ value }: { value: OperationsData['enrollmentFunnel']['people'][number]['status'] }) {
  const styles = value === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300' : value === 'in_progress' ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300' : 'border-western-200 bg-western-50 text-western-800 dark:border-western-800 dark:bg-western-950/50 dark:text-western-300';
  const label = value === 'completed' ? 'Enrolled' : value === 'in_progress' ? 'Form opened' : 'Link generated';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[0.68rem] font-extrabold ${styles}`}>{label}</span>;
}

function conversion(value: number, base: number, suffix: string) { return base ? `${Math.round(value / base * 100)}% ${suffix}` : `0% ${suffix}`; }
function OutboxPanel({ rows, retrying, dismissing, onRetry, onDismiss }: { rows: OutboxRow[]; retrying: number | null; dismissing: number | null; onRetry: (row: OutboxRow) => Promise<void>; onDismiss: (row: OutboxRow) => Promise<void> }) {
  const ordered = [...rows].sort((a, b) => deliveryRank(deliveryState(a)) - deliveryRank(deliveryState(b)) || b.id - a.id);
  return <Panel className="flex h-full min-h-0 flex-col" title="Delivery queue" description="Failed and waiting work appears first. Delivered and dismissed items remain as recent history.">
    {ordered.length ? <ScrollArea className="min-h-0 flex-1 overscroll-contain"><div className="divide-y divide-slate-100 [overflow-anchor:none] dark:divide-white/10">{ordered.map((row) => <DeliveryRow key={row.id} row={row} retrying={retrying === row.id} dismissing={dismissing === row.id} onRetry={onRetry} onDismiss={onDismiss} />)}</div></ScrollArea> : <EmptyState title="No delivery history" description="Messages, emails, and Discord updates will appear here when the system queues them." />}
  </Panel>;
}

function DeliveryRow({ row, retrying, dismissing, onRetry, onDismiss }: { row: OutboxRow; retrying: boolean; dismissing: boolean; onRetry: (row: OutboxRow) => Promise<void>; onDismiss: (row: OutboxRow) => Promise<void> }) {
  const state = deliveryState(row); const task = deliveryTask(row); const explanation = deliveryExplanation(row, state);
  const [detailsOpen, setDetailsOpen] = useState(false); const detailsId = useId();
  const rowTone = state === 'failed' ? 'bg-rose-50/40 dark:bg-rose-950/20' : state === 'dismissed' ? 'bg-slate-50/60 dark:bg-white/[.025]' : '';
  return <article className={`grid gap-4 p-4 xl:grid-cols-[minmax(12rem,.85fr)_minmax(18rem,1.4fr)_auto] xl:items-start ${rowTone}`}>
    <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-bold text-slate-900">{task.label}</h3><Badge value={state} /></div><div className="mt-1 text-xs text-slate-500">{task.target}</div><div className="mt-1 font-mono text-[0.65rem] text-slate-400">Queue item #{row.id}</div></div>
    <div className="min-w-0"><div className={`text-xs font-semibold ${state === 'failed' ? 'text-rose-800 dark:text-rose-300' : 'text-slate-700'}`}>{explanation.summary}</div><p className="mt-1 text-xs leading-5 text-slate-500">{explanation.next}</p>{row.last_error ? <div className="mt-1.5 text-[0.68rem] text-slate-500"><button type="button" aria-expanded={detailsOpen} aria-controls={detailsId} className="flex w-fit items-center gap-1 font-semibold text-slate-600 hover:text-slate-900" onClick={() => setDetailsOpen((open) => !open)}>Technical details <ChevronDown aria-hidden="true" className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`} /></button><div id={detailsId} aria-hidden={!detailsOpen} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${detailsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}><div className="min-h-0 overflow-hidden"><code className="mt-1 block whitespace-pre-wrap break-words rounded bg-slate-100 p-2 dark:bg-white/[.06]">{row.last_error}</code></div></div></div> : null}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-white/10 xl:block xl:min-w-44 xl:border-0 xl:pt-0 xl:text-right"><div><div className="text-xs font-semibold text-slate-700">{state === 'sent' ? `Delivered ${formatDate(row.done_at)}` : state === 'dismissed' ? `Dismissed ${formatDate(row.dismissed_at)}` : state === 'failed' ? 'Automatic retries stopped' : `Next attempt ${formatDate(row.run_after)}`}</div><div className="mt-1 text-[0.68rem] text-slate-400">{row.attempts ? `${row.attempts} failed ${row.attempts === 1 ? 'attempt' : 'attempts'}` : 'No failed attempts'}</div></div>{state === 'failed' ? <div className="flex gap-2 xl:mt-3 xl:justify-end"><Button variant="quiet" disabled={retrying || dismissing} onClick={() => void onDismiss(row)}>{dismissing ? 'Dismissing…' : 'Dismiss'}</Button><Button variant="secondary" disabled={retrying || dismissing} onClick={() => void onRetry(row)}>{retrying ? 'Retrying…' : 'Retry now'}</Button></div> : state === 'dismissed' ? <Button className="xl:mt-3" variant="secondary" disabled={retrying} onClick={() => void onRetry(row)}>{retrying ? 'Restoring…' : 'Restore & retry'}</Button> : null}</div>
  </article>;
}
function NotificationsPanel({ rows }: { rows: Array<Record<string, any>> }) { return <Panel className="flex h-full min-h-0 flex-col" title="Notification history"><OperationsTable rowCount={rows.length}><table className={tableClass}><thead><tr><th className={thClass}>When</th><th className={thClass}>Participant</th><th className={thClass}>Channel</th><th className={thClass}>Kind</th><th className={thClass}>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className={tdClass}>{formatDate(row.created_at)}</td><td className={tdClass}>{row.name ?? '—'}</td><td className={tdClass}>{row.channel}</td><td className={tdClass}>{row.kind?.replaceAll('_', ' ')}</td><td className={tdClass}><Badge value={row.status} /></td></tr>)}</tbody></table></OperationsTable></Panel>; }
function JobsPanel({ rows, cron }: { rows: Array<Record<string, any>>; cron: OperationsData['cron'] }) {
  const healthy = cron.status === 'healthy';
  const title = healthy ? 'Cron is running normally' : cron.status === 'never_run' ? 'No cron run has been recorded' : 'Cron may be delayed';
  const detail = cron.lastTickAt
    ? `Last heartbeat ${formatDate(cron.lastTickAt)} (${cron.ageMinutes} minute${cron.ageMinutes === 1 ? '' : 's'} ago). Expected every ${cron.expectedEveryMinutes} minutes.`
    : `No heartbeat exists yet. A healthy deployment records one every ${cron.expectedEveryMinutes} minutes.`;
  return <Panel className="flex h-full min-h-0 flex-col" title="Scheduled-run history" description="The heartbeat proves the worker schedule is firing; named rows prove one-time program transitions ran.">
    <div className={`m-4 rounded-xl border px-4 py-3 ${healthy ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20'}`}><div className="flex flex-wrap items-center gap-2"><span className={`size-2 rounded-full ${healthy ? 'bg-emerald-500' : 'bg-amber-500'}`} /><span className="text-sm font-extrabold text-slate-900 dark:text-foreground">{title}</span><Badge value={cron.status} /></div><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-muted-foreground">{detail}</p></div>
    <OperationsTable rowCount={rows.length}><table className={tableClass}><thead><tr><th className={thClass}>Ran</th><th className={thClass}>Run</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className={tdClass}>{formatDate(row.ran_at)}</td><td className={`${tdClass} font-mono text-xs text-slate-800 dark:text-foreground`}>{humanizeJob(row.job_key)}</td></tr>)}</tbody></table></OperationsTable>
  </Panel>;
}

function humanizeJob(value: string) {
  if (value.startsWith('tick:')) return `Cron heartbeat · ${value.slice(5)}`;
  const [kind, id] = value.split(':');
  const labels: Record<string, string> = { optin_open: 'Opened opt-in', optin_remind: 'Sent opt-in reminder', match: 'Ran matching', nudge: 'Sent scheduling nudge', nudge2: 'Sent final scheduling nudge', digest: 'Sent organizer digest' };
  return labels[kind] ? `${labels[kind]} · round record ${id}` : value.replaceAll('_', ' ');
}
function AuditPanel({ rows }: { rows: OperationsData['audit'] }) { return <Panel className="flex h-full min-h-0 flex-col" title="Organizer audit log" description="Consequential web actions are append-only."><OperationsTable rowCount={rows.length}><table className={tableClass}><thead><tr><th className={thClass}>When</th><th className={thClass}>Actor</th><th className={thClass}>Action</th><th className={thClass}>Target</th><th className={thClass}>Detail</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className={tdClass}>{formatDate(row.created_at)}</td><td className={tdClass}>{row.actor_name ?? 'System'}</td><td className={`${tdClass} font-semibold text-slate-900`}>{row.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</td><td className={tdClass}>{row.target_type ? `${row.target_type} ${row.target_id ?? ''}` : '—'}</td><td className={`${tdClass} max-w-xs truncate font-mono text-xs`} title={row.detail ?? ''}>{row.detail ?? '—'}</td></tr>)}</tbody></table></OperationsTable></Panel>; }
function OperationsTable({ children, rowCount }: { children: ReactNode; rowCount: number }) { return <ScrollArea horizontal className="min-h-0 flex-1 overscroll-contain" style={{ height: `min(${Math.max(3, rowCount + 1) * 52}px, 62vh, 672px)` }}><div className="min-w-max pr-3 [&_th]:sticky [&_th]:top-0 [&_th]:z-10">{children}</div></ScrollArea>; }

type DeliveryState = 'sent' | 'failed' | 'retrying' | 'pending' | 'dismissed';
const deliveryState = (row: OutboxRow): DeliveryState => row.dismissed_at ? 'dismissed' : row.done_at ? 'sent' : row.attempts >= 5 ? 'failed' : row.attempts ? 'retrying' : 'pending';
const deliveryRank = (state: DeliveryState) => ({ failed: 0, retrying: 1, pending: 2, sent: 3, dismissed: 4 })[state];

function deliveryTask(row: OutboxRow) {
  const payload = parsePayload(row.payload); const person = row.participant_name;
  const user = person ?? shortTarget(payload.userId, 'Discord user'); const channel = shortTarget(payload.channelId, 'Discord channel'); const server = shortTarget(payload.guildId, 'Discord server');
  switch (row.kind) {
    case 'email': return { label: 'Email', target: joinContext(person ?? stringValue(payload.to) ?? 'Unknown recipient', stringValue(payload.subject)) };
    case 'dm': return { label: 'Discord direct message', target: user };
    case 'channel_msg': return { label: 'Discord channel message', target: channel };
    case 'thread_create': return { label: 'Create session thread', target: joinContext(stringValue(payload.name) ?? channel, channel) };
    case 'role_add': return { label: 'Assign participant role', target: user };
    case 'nickname': return { label: 'Update Discord nickname', target: joinContext(user, stringValue(payload.nick) ? `New name: ${stringValue(payload.nick)}` : null) };
    case 'discord_identity_sync': return { label: 'Refresh Discord profile', target: user };
    case 'followup': return { label: 'Complete Discord command', target: 'Original command response' };
    case 'guild_setup': return { label: 'Set up program channels', target: server };
    case 'guild_publish': return { label: 'Publish program channels', target: server };
    default: return { label: row.kind.replaceAll('_', ' '), target: person ?? 'System delivery' };
  }
}

function deliveryExplanation(row: OutboxRow, state: DeliveryState) {
  if (state === 'dismissed') return { summary: 'Dismissed by an organizer.', next: 'It is kept for history and will not run again unless restored.' };
  if (state === 'sent') return { summary: row.attempts ? 'Delivered after recovering from an earlier failure.' : 'Delivered successfully.', next: 'No organizer action is needed.' };
  if (!row.last_error) return { summary: 'Waiting to be processed.', next: 'The system will attempt this automatically at the scheduled time.' };
  const error = row.last_error.toLowerCase();
  if (/429|rate.?limit/.test(error)) return { summary: 'Discord temporarily rate-limited the bot.', next: state === 'failed' ? 'The limit should clear on its own; retry now or wait briefly and retry.' : 'No action is needed unless the next automatic attempt also fails.' };
  if (/403|missing permissions?|missing access|forbidden/.test(error)) return { summary: 'The bot does not have permission to complete this Discord action.', next: 'Check the bot role hierarchy and channel permissions, then retry.' };
  if (/404|unknown (member|user|channel)|not found/.test(error)) return { summary: 'Discord could not find the member or channel.', next: 'Confirm the member is still in the server and the saved Discord mapping or channel is current before retrying.' };
  if (/reject(ed)? recipient|invalid (recipient|email)|mailbox|email.*reject/.test(error)) return { summary: 'The email provider rejected the recipient address.', next: 'Correct the participant’s preferred email, then retry this delivery.' };
  if (/binding|configuration|not configured|missing.*(token|secret)/.test(error)) return { summary: 'A required service configuration is missing or invalid.', next: 'Correct the deployment configuration first; retrying unchanged will fail again.' };
  if (/5\d\d|unavailable|timeout|network|fetch failed/.test(error)) return { summary: 'The external service was temporarily unavailable.', next: state === 'failed' ? 'Retry now; investigate the provider only if it fails again.' : 'The system will try again automatically.' };
  return { summary: 'The provider rejected this delivery.', next: state === 'failed' ? 'Open the technical details, correct the underlying destination or configuration, then retry.' : 'The system will retry automatically; investigate if attempts continue to fail.' };
}

function parsePayload(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; } }
const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
const shortTarget = (value: unknown, label: string) => { const id = stringValue(value); return id ? `${label} …${id.slice(-6)}` : `Unknown ${label.toLowerCase()}`; };
const joinContext = (primary: string, secondary: string | null) => secondary && secondary !== primary ? `${primary} · ${secondary}` : primary;
