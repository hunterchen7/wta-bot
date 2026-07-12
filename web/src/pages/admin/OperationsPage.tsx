import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { OperationsData, OutboxRow } from '../../admin-types';
import { adminRequest } from '../../api';
import { Badge, Button, EmptyState, ErrorState, formatDate, LoadingState, PageIntro, Panel, tableClass, tdClass, thClass, Tabs } from '../../components/AdminUI';
import { ScrollArea } from '../../components/ui/scroll-area';
import { useAdminData } from '../../hooks/useAdminData';

export function OperationsPage() {
  const { data, error, loading, reload } = useAdminData<OperationsData>('/operations'); const [tab, setTab] = useState('outbox'); const [retrying, setRetrying] = useState<number | null>(null);
  const failed = useMemo(() => data?.outbox.filter((row) => !row.done_at && row.attempts >= 5).length ?? 0, [data]);
  if (loading && !data) return <LoadingState />; if (error || !data) return <ErrorState message={error ?? 'No operations data returned.'} onRetry={() => void reload()} />;
  const retry = async (row: OutboxRow) => { setRetrying(row.id); try { await adminRequest(`/operations/outbox/${row.id}/retry`, { method: 'POST', body: '{}' }); await reload(); } finally { setRetrying(null); } };
  return <div className="flex min-h-[34rem] flex-col gap-5 lg:h-[calc(100dvh-9rem)] lg:min-h-0"><PageIntro title="Operations" description="Delivery, scheduled work, and organizer actions—the evidence you need when something feels off." />
    {failed ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"><div className="text-sm font-extrabold text-rose-900">{failed} {failed === 1 ? 'delivery needs' : 'deliveries need'} attention</div><p className="mt-0.5 text-xs leading-5 text-rose-700">Automatic retries have stopped. Review the affected person or destination and the suggested fix below before retrying.</p></div> : null}
    <div className="flex"><Tabs value={tab} onChange={setTab} items={[{ value: 'outbox', label: 'Delivery queue', count: data.outbox.filter((row) => !row.done_at).length }, { value: 'notifications', label: 'Notification history', count: data.notifications.length }, { value: 'jobs', label: 'Scheduled runs', count: data.jobs.length }, { value: 'audit', label: 'Audit log', count: data.audit.length }]} /></div>
    <div className="min-h-0 flex-1">{tab === 'outbox' ? <OutboxPanel rows={data.outbox} retrying={retrying} onRetry={retry} /> : tab === 'notifications' ? <NotificationsPanel rows={data.notifications} /> : tab === 'jobs' ? <JobsPanel rows={data.jobs} /> : <AuditPanel rows={data.audit} />}</div>
  </div>;
}
function OutboxPanel({ rows, retrying, onRetry }: { rows: OutboxRow[]; retrying: number | null; onRetry: (row: OutboxRow) => Promise<void> }) {
  const ordered = [...rows].sort((a, b) => deliveryRank(deliveryState(a)) - deliveryRank(deliveryState(b)) || b.id - a.id);
  return <Panel className="flex h-full min-h-0 flex-col" title="Delivery queue" description="Failed and waiting work appears first. Completed deliveries remain here as recent history.">
    {ordered.length ? <ScrollArea className="min-h-0 flex-1 overscroll-contain"><div className="divide-y divide-slate-100 [overflow-anchor:none]">{ordered.map((row) => <DeliveryRow key={row.id} row={row} retrying={retrying === row.id} onRetry={onRetry} />)}</div></ScrollArea> : <EmptyState title="No delivery history" description="Messages, emails, and Discord updates will appear here when the system queues them." />}
  </Panel>;
}

function DeliveryRow({ row, retrying, onRetry }: { row: OutboxRow; retrying: boolean; onRetry: (row: OutboxRow) => Promise<void> }) {
  const state = deliveryState(row); const task = deliveryTask(row); const explanation = deliveryExplanation(row, state);
  const [detailsOpen, setDetailsOpen] = useState(false); const detailsId = useId();
  return <article className={`grid gap-4 p-4 xl:grid-cols-[minmax(12rem,.85fr)_minmax(18rem,1.4fr)_auto] xl:items-start ${state === 'failed' ? 'bg-rose-50/40' : ''}`}>
    <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-bold text-slate-900">{task.label}</h3><Badge value={state} /></div><div className="mt-1 text-xs text-slate-500">{task.target}</div><div className="mt-1 font-mono text-[0.65rem] text-slate-400">Queue item #{row.id}</div></div>
    <div className="min-w-0"><div className={`text-xs font-semibold ${state === 'failed' ? 'text-rose-800' : 'text-slate-700'}`}>{explanation.summary}</div><p className="mt-1 text-xs leading-5 text-slate-500">{explanation.next}</p>{row.last_error ? <div className="mt-1.5 text-[0.68rem] text-slate-500"><button type="button" aria-expanded={detailsOpen} aria-controls={detailsId} className="flex w-fit items-center gap-1 font-semibold text-slate-600 hover:text-slate-900" onClick={() => setDetailsOpen((open) => !open)}>Technical details <ChevronDown aria-hidden="true" className={`size-3 transition-transform duration-200 motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`} /></button><div id={detailsId} aria-hidden={!detailsOpen} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${detailsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}><div className="min-h-0 overflow-hidden"><code className="mt-1 block whitespace-pre-wrap break-words rounded bg-slate-100 p-2">{row.last_error}</code></div></div></div> : null}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 xl:block xl:min-w-44 xl:border-0 xl:pt-0 xl:text-right"><div><div className="text-xs font-semibold text-slate-700">{state === 'sent' ? `Delivered ${formatDate(row.done_at)}` : state === 'failed' ? 'Automatic retries stopped' : `Next attempt ${formatDate(row.run_after)}`}</div><div className="mt-1 text-[0.68rem] text-slate-400">{row.attempts ? `${row.attempts} failed ${row.attempts === 1 ? 'attempt' : 'attempts'}` : 'No failed attempts'}</div></div>{state === 'failed' ? <Button className="xl:mt-3" variant="secondary" disabled={retrying} onClick={() => void onRetry(row)}>{retrying ? 'Retrying…' : 'Retry now'}</Button> : null}</div>
  </article>;
}
function NotificationsPanel({ rows }: { rows: Array<Record<string, any>> }) { return <Panel className="flex h-full min-h-0 flex-col" title="Notification history"><OperationsTable rowCount={rows.length}><table className={tableClass}><thead><tr><th className={thClass}>When</th><th className={thClass}>Participant</th><th className={thClass}>Channel</th><th className={thClass}>Kind</th><th className={thClass}>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className={tdClass}>{formatDate(row.created_at)}</td><td className={tdClass}>{row.name ?? '—'}</td><td className={tdClass}>{row.channel}</td><td className={tdClass}>{row.kind?.replaceAll('_', ' ')}</td><td className={tdClass}><Badge value={row.status} /></td></tr>)}</tbody></table></OperationsTable></Panel>; }
function JobsPanel({ rows }: { rows: Array<Record<string, any>> }) { return <Panel className="flex h-full min-h-0 flex-col" title="Scheduled-run history" description="Each row confirms that a scheduled transition ran once."><OperationsTable rowCount={rows.length}><table className={tableClass}><thead><tr><th className={thClass}>Ran</th><th className={thClass}>Run</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className={tdClass}>{formatDate(row.ran_at)}</td><td className={`${tdClass} font-mono text-xs text-slate-800`}>{row.job_key}</td></tr>)}</tbody></table></OperationsTable></Panel>; }
function AuditPanel({ rows }: { rows: OperationsData['audit'] }) { return <Panel className="flex h-full min-h-0 flex-col" title="Organizer audit log" description="Consequential web actions are append-only."><OperationsTable rowCount={rows.length}><table className={tableClass}><thead><tr><th className={thClass}>When</th><th className={thClass}>Actor</th><th className={thClass}>Action</th><th className={thClass}>Target</th><th className={thClass}>Detail</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className={tdClass}>{formatDate(row.created_at)}</td><td className={tdClass}>{row.actor_name ?? 'System'}</td><td className={`${tdClass} font-semibold text-slate-900`}>{row.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</td><td className={tdClass}>{row.target_type ? `${row.target_type} ${row.target_id ?? ''}` : '—'}</td><td className={`${tdClass} max-w-xs truncate font-mono text-xs`} title={row.detail ?? ''}>{row.detail ?? '—'}</td></tr>)}</tbody></table></OperationsTable></Panel>; }
function OperationsTable({ children, rowCount }: { children: ReactNode; rowCount: number }) { return <ScrollArea horizontal className="min-h-0 flex-1 overscroll-contain" style={{ height: `min(${Math.max(3, rowCount + 1) * 52}px, 62vh, 672px)` }}><div className="min-w-max pr-3 [&_th]:sticky [&_th]:top-0 [&_th]:z-10">{children}</div></ScrollArea>; }

type DeliveryState = 'sent' | 'failed' | 'retrying' | 'pending';
const deliveryState = (row: OutboxRow): DeliveryState => row.done_at ? 'sent' : row.attempts >= 5 ? 'failed' : row.attempts ? 'retrying' : 'pending';
const deliveryRank = (state: DeliveryState) => ({ failed: 0, retrying: 1, pending: 2, sent: 3 })[state];

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
