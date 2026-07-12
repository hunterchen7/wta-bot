import { useEffect, useState } from 'react';
import { publicRequest } from '../api';
import { PublicIntro, PublicShell } from '../components/PublicShell';

type BankData = { cohort: { name: string } | null; round: number | null; problems: Array<{ number: number | null; title: string; url: string | null; difficulty: string }> };
export function BankPage() {
  const [data, setData] = useState<BankData | null>(null); const [error, setError] = useState('');
  useEffect(() => { publicRequest<BankData>('/public/bank').then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load the bank.')); }, []);
  return <PublicShell><PublicIntro eyebrow="Open problem bank" title={data?.round ? `Round ${data.round} questions` : 'Question bank'} description={data?.cohort ? `${data.cohort.name}. Interviewers choose one problem per session; participants can study the published set.` : 'The active round’s published practice set.'} />
    {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900">{error}</div> : !data ? <div className="h-72 animate-pulse rounded-3xl bg-slate-200" /> : !data.problems.length ? <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center"><h2 className="font-black">Nothing published yet</h2><p className="mt-2 text-sm text-slate-500">Check back before the round begins.</p></div> : <div className="grid gap-4 sm:grid-cols-2">{data.problems.map((problem) => <a key={`${problem.number}-${problem.title}`} href={problem.url ?? '#'} target={problem.url ? '_blank' : undefined} rel="noreferrer" className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg"><div className="flex items-center justify-between gap-3"><span className="text-xs font-black uppercase tracking-[0.15em] text-slate-400">{problem.number ? `#${problem.number}` : 'WTA'}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[0.65rem] font-black uppercase text-slate-600">{problem.difficulty}</span></div><h2 className="mt-5 text-lg font-black text-slate-950 group-hover:text-emerald-800">{problem.title}</h2><div className="mt-3 text-xs font-bold text-emerald-700">Open problem ↗</div></a>)}</div>}
  </PublicShell>;
}
