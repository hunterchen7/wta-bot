import { useState } from 'react';
import type { InboxData, InboxMessage } from '../../admin-types';
import { markAllInboxRead, markInboxRead } from '../../api';
import { Button, EmptyState, ErrorState, formatDate, LoadingState, PageIntro, Panel } from '../../components/AdminUI';
import { useAdminData } from '../../hooks/useAdminData';
import { LIVE_REFRESH_INTERVAL_MS } from '../../hooks/useAutoRefresh';

export function InboxPage() {
  const { data, error, loading, reload } = useAdminData<InboxData>('/inbox', LIVE_REFRESH_INTERVAL_MS);
  const [busy, setBusy] = useState<number | 'all' | null>(null);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No inbox data returned.'} onRetry={() => void reload()} />;

  const toggleRead = async (message: InboxMessage) => {
    setBusy(message.id);
    try {
      await markInboxRead(message.id, !message.read_at);
      await reload();
    } finally {
      setBusy(null);
    }
  };
  const markAll = async () => {
    setBusy('all');
    try {
      await markAllInboxRead();
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return <div className="flex flex-col gap-5">
    <PageIntro
      title="Inbox"
      description="Replies students send to the bot's DMs, collected here every few minutes. The bot can't respond in DMs — follow up in a session thread, by email, or with /report."
    />
    <Panel
      title={`Messages${data.unread ? ` · ${data.unread} unread` : ''}`}
      description="Newest first. Captured from students' direct messages to the WTA bot."
      actions={data.unread ? <Button variant="secondary" disabled={busy === 'all'} onClick={() => void markAll()}>{busy === 'all' ? 'Marking…' : 'Mark all read'}</Button> : undefined}
    >
      {data.messages.length === 0
        ? <EmptyState title="No messages yet" description="When a student replies to one of the bot's DMs, it shows up here within a few minutes." />
        : <ul className="flex flex-col gap-2">
            {data.messages.map((m) => {
              const unread = !m.read_at;
              const who = m.name ?? m.discord_username ?? m.discord_id;
              return <li
                key={m.id}
                className={`rounded-2xl border p-4 transition ${unread ? 'border-western-300 bg-western-50/60 dark:border-western-800/70 dark:bg-western-950/25' : 'border-border bg-card'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {unread ? <span className="size-2 shrink-0 rounded-full bg-western-500" aria-label="unread" /> : null}
                      <span className="truncate font-black text-card-foreground">{who}</span>
                      {m.discord_username ? <span className="truncate text-xs text-muted-foreground">@{m.discord_username}</span> : null}
                      {m.status !== 'active' ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">{m.status}</span> : null}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-card-foreground">{m.content}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-xs text-muted-foreground">{formatDate(m.created_at)}</span>
                    <button
                      type="button"
                      disabled={busy === m.id}
                      onClick={() => void toggleRead(m)}
                      className="cursor-pointer text-xs font-bold text-western-700 transition hover:text-western-900 disabled:opacity-50 dark:text-western-300 dark:hover:text-western-100"
                    >
                      {busy === m.id ? '…' : unread ? 'Mark read' : 'Mark unread'}
                    </button>
                  </div>
                </div>
              </li>;
            })}
          </ul>}
    </Panel>
  </div>;
}
