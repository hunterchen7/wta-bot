import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { publicRequest, SettingsSaveError } from '../api';
import { PublicIntro, PublicShell, publicInputClass } from '../components/PublicShell';

export function LoginPage() {
  const [params] = useSearchParams();
  const [checkingSession, setCheckingSession] = useState(true);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/session', { headers: { Accept: 'application/json' }, signal: controller.signal })
      .then((response) => {
        if (response.ok) window.location.replace('/app');
        else setCheckingSession(false);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setCheckingSession(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (params.get('error') === 'expired') setError('That one-click sign-in link expired. Request a fresh code below.');
  }, [params]);

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await publicRequest('/auth/request-code', { method: 'POST', body: JSON.stringify({ email }) }); setStep('code'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send a code.'); }
    finally { setBusy(false); }
  };
  const submitCode = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await publicRequest<{ redirect: string }>('/auth/verify-code', { method: 'POST', body: JSON.stringify({ email, code }) });
      window.location.assign(result.redirect);
    } catch (cause) {
      setError(cause instanceof SettingsSaveError ? cause.fieldErrors.code ?? cause.message : 'Could not verify that code.');
      setCode('');
    } finally { setBusy(false); }
  };

  if (checkingSession) return <PublicShell narrow><div className="mx-auto grid min-h-[50vh] place-items-center" role="status" aria-live="polite"><div className="text-center"><div className="mx-auto size-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_0_7px_rgba(16,185,129,.12)]" /><p className="mt-5 text-sm font-bold text-slate-500">Checking your session…</p></div></div></PublicShell>;

  return <PublicShell narrow><div className="mx-auto max-w-xl">
    <PublicIntro eyebrow="Participant access" title={step === 'email' ? 'Welcome back.' : 'Check your inbox.'} description={step === 'email' ? 'Use the preferred email attached to your WTA enrollment. We’ll send a short-lived sign-in code.' : `Enter the six-digit code sent to ${email}. It expires in 10 minutes.`} />
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,.06)] sm:p-8">
      {error ? <div role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div> : null}
      {step === 'email' ? <form onSubmit={submitEmail}><label className="text-sm font-extrabold text-slate-800">Preferred email<input autoFocus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className={`${publicInputClass} mt-2`} /></label><button disabled={busy} className="mt-5 w-full cursor-pointer rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60">{busy ? 'Sending…' : 'Send sign-in code'}</button></form>
      : <form onSubmit={submitCode}><label className="text-sm font-extrabold text-slate-800">Six-digit code<input ref={codeRef} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" className={`${publicInputClass} mt-2 text-center font-mono text-2xl tracking-[0.35em]`} /></label><button disabled={busy || code.length !== 6} className="mt-5 w-full cursor-pointer rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Checking…' : 'Open dashboard'}</button><button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }} className="mt-3 w-full cursor-pointer px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-900">Use a different email</button></form>}
    </section>
    <p className="mt-5 text-center text-sm text-slate-500">For a one-click sign-in link, run <code className="rounded bg-slate-200 px-1.5 py-0.5 font-bold text-slate-700">/dashboard</code> in Discord.</p>
  </div></PublicShell>;
}
