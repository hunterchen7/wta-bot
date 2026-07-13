import { useEffect, useState, type ReactNode } from 'react';
import type { AdminMcpData } from '../../admin-types';
import { adminRequest } from '../../api';
import { Button, Dialog, DialogClose, ErrorState, formatDate, LoadingState, PageIntro, Panel } from '../../components/AdminUI';
import { useAdminData } from '../../hooks/useAdminData';

type CopyTarget = 'url' | 'token';

export function McpPage() {
  const { data, error, loading, reload, setData } = useAdminData<AdminMcpData>('/mcp-token');
  const [revealed, setRevealed] = useState(false);
  const [copyState, setCopyState] = useState<{ target: CopyTarget; failed: boolean } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    if (!copyState) return;
    const timer = window.setTimeout(() => setCopyState(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copy = async (target: CopyTarget, value: string) => {
    try {
      await copyText(value);
      setCopyState({ target, failed: false });
    } catch {
      setCopyState({ target, failed: true });
    }
  };

  const reset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      const next = await adminRequest<AdminMcpData>('/mcp-token/reset', { method: 'POST' });
      setData(next);
      setRevealed(false);
      setConfirmReset(false);
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : 'Could not reset the MCP token.');
    } finally {
      setResetting(false);
    }
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load MCP access.'} onRetry={() => void reload()} />;

  const tokenCopy = copyState?.target === 'token' ? (copyState.failed ? 'Copy failed' : 'Copied') : 'Copy';
  const urlCopy = copyState?.target === 'url' ? (copyState.failed ? 'Copy failed' : 'Copied') : 'Copy';

  return <div className="space-y-7">
    <PageIntro
      title="MCP"
      description="Connect an AI client to WTA’s organizer tools without exposing database credentials. This token belongs only to your organizer account."
    />

    <Panel title="Connection" description="Use Streamable HTTP and bearer-token authentication in your MCP client.">
      <div className="space-y-6 p-5 sm:p-6">
        <CredentialField
          label="MCP URL"
          value={data.mcpUrl}
          action={<Button variant="secondary" onClick={() => void copy('url', data.mcpUrl)}>{urlCopy}</Button>}
        />

        <div className="border-t border-slate-100 pt-6 dark:border-border">
          <CredentialField
            label="Your access token"
            value={data.token ?? ''}
            type={revealed ? 'text' : 'password'}
            placeholder="No token generated yet"
            action={data.token ? <>
              <Button variant="secondary" aria-pressed={revealed} onClick={() => setRevealed((current) => !current)}>{revealed ? 'Hide' : 'Show'}</Button>
              <Button variant="secondary" onClick={() => void copy('token', data.token!)}>{tokenCopy}</Button>
            </> : null}
          />
          <div className="mt-3 flex flex-col gap-3 text-xs text-slate-500 dark:text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div>{data.credential ? <>Created {formatDate(data.credential.createdAt)} · {data.credential.lastUsedAt ? `Last used ${formatDate(data.credential.lastUsedAt)}` : 'Not used yet'}</> : 'Generate a token when you are ready to connect a client.'}</div>
            <Button variant={data.token ? 'danger' : 'primary'} onClick={() => { setResetError(null); setConfirmReset(true); }}>{data.token ? 'Reset token' : 'Generate token'}</Button>
          </div>
        </div>
      </div>
    </Panel>

    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Authentication" description="What to enter in clients that expose individual connection fields.">
        <dl className="divide-y divide-slate-100 px-5 dark:divide-border">
          <ConnectionRow label="Transport" value="Streamable HTTP" />
          <ConnectionRow label="Header" value="Authorization" mono />
          <ConnectionRow label="Value" value="Bearer <your token>" mono />
        </dl>
      </Panel>
      <Panel title="Access" description="The token follows your current organizer permissions.">
        <div className="p-5">
          <p className="text-sm leading-6 text-slate-600 dark:text-muted-foreground">It can read admin data and use the available participant, question, program, and operations tools. If your organizer access is removed, the token stops working too.</p>
          {data.credential ? <div className="mt-4 flex flex-wrap gap-1.5">{data.credential.scopes.map((scope) => <code key={scope} className="rounded-md border border-western-200 bg-western-50 px-2 py-1 text-[0.68rem] font-bold text-western-800 dark:border-western-800/70 dark:bg-western-950/40 dark:text-western-200">{scope}</code>)}</div> : null}
        </div>
      </Panel>
    </div>

    {confirmReset ? <Dialog
      title={data.token ? 'Reset your MCP token?' : 'Generate your MCP token?'}
      description={data.token ? 'The current token will stop working immediately. You will need to update every connected MCP client.' : 'This creates a personal organizer credential for MCP clients.'}
      onClose={() => { if (!resetting) setConfirmReset(false); }}
      actions={<>
        <DialogClose><Button variant="secondary" disabled={resetting}>Cancel</Button></DialogClose>
        <Button variant={data.token ? 'danger' : 'primary'} disabled={resetting} onClick={() => void reset()}>{resetting ? (data.token ? 'Resetting…' : 'Generating…') : (data.token ? 'Reset token' : 'Generate token')}</Button>
      </>}
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100">
        Treat this token like a password. Do not paste it into chat, commit it, or share it with another organizer.
      </div>
      {resetError ? <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200">{resetError}</div> : null}
    </Dialog> : null}
  </div>;
}

function CredentialField({ label, value, type = 'text', placeholder, action }: { label: string; value: string; type?: 'text' | 'password'; placeholder?: string; action: ReactNode }) {
  return <div>
    <div className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500 dark:text-muted-foreground">{label}</div>
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        aria-label={label}
        readOnly
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onFocus={(event) => type === 'text' && event.currentTarget.select()}
        className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-sm text-slate-900 shadow-inner outline-none transition focus:border-western-400 focus:ring-2 focus:ring-western-500/15 dark:border-border dark:bg-muted/55 dark:text-foreground"
      />
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  </div>;
}

function ConnectionRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3.5 text-sm">
    <dt className="text-slate-500 dark:text-muted-foreground">{label}</dt>
    <dd className={`break-words font-semibold text-slate-900 dark:text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
  </div>;
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
