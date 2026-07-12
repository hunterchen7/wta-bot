import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicRequest } from '../api';
import { PublicIntro, PublicShell } from '../components/PublicShell';

type ProblemData = { mode: 'packet' | 'solution'; round: number; scheduledAt: string | null; intervieweeName: string | null; problem: { number: number | null; title: string; url: string | null; difficulty: string; statement: string | null; hints: string | null; solution: string | null } };

export function ProblemPage({ preview = false }: { preview?: boolean }) {
  const { token } = useParams();
  const [data, setData] = useState<ProblemData | null>(preview ? previewPacket : null);
  const [error, setError] = useState('');
  useEffect(() => { if (!preview) publicRequest<ProblemData>(`/problems/${token}`).then(setData).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open this problem.')); }, [preview, token]);
  if (error) return <PublicShell narrow><div className="rounded-3xl border border-rose-200 bg-white p-8 text-center"><h1 className="text-2xl font-black">This link can’t be opened</h1><p className="mt-2 text-slate-600">{error}</p></div></PublicShell>;
  if (!data) return <PublicShell narrow><div className="h-96 animate-pulse rounded-3xl bg-slate-200" /></PublicShell>;
  const problem = data.problem;
  return <PublicShell narrow>
    <PublicIntro eyebrow={preview ? 'Read-only preview' : `Round ${data.round}`} title={data.mode === 'packet' ? 'Interviewer packet' : 'Solution notes'} description={`${problem.number ? `#${problem.number} · ` : ''}${problem.title} · ${problem.difficulty}${data.intervieweeName ? ` · interviewing ${data.intervieweeName}` : ''}`} />
    {preview ? <Notice tone="western">Preview mode. Live packets are private, signed, and expire automatically.</Notice> : null}
    {data.mode === 'packet' ? <Notice tone="amber">For your eyes only. Do not share this page with the interviewee before the session.</Notice> : null}
    {problem.url ? <a href={problem.url} target="_blank" rel="noreferrer" className="mb-6 inline-flex rounded-xl bg-western-700 px-4 py-2.5 text-sm font-black text-white hover:bg-western-800">Open original problem ↗</a> : null}
    <div className="space-y-5">{problem.statement ? <Content title="Statement" value={problem.statement} /> : null}{problem.hints ? <Content title="Hint ladder" value={problem.hints} /> : null}<Content title="Solution" value={problem.solution ?? 'No solution notes have been added yet.'} /></div>
  </PublicShell>;
}

function Content({ title, value }: { title: string; value: string }) { return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><h2 className="border-b border-slate-100 px-5 py-4 text-sm font-black text-slate-950">{title}</h2><pre className="whitespace-pre-wrap p-5 font-sans text-sm leading-7 text-slate-700">{value}</pre></section>; }
function Notice({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'western' }) { return <div className={`mb-6 rounded-2xl border p-4 text-sm font-semibold ${tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-western-200 bg-western-50 text-western-900'}`}>{children}</div>; }
const previewPacket: ProblemData = { mode: 'packet', round: 2, scheduledAt: '2026-08-12T23:30:00.000Z', intervieweeName: 'Jordan Example', problem: { number: 56, title: 'Merge Intervals', url: 'https://leetcode.com/problems/merge-intervals/', difficulty: 'medium', statement: 'Given an array of intervals, merge all overlapping intervals.', hints: '1. What happens if you sort first?\n2. When do two intervals overlap?\n3. Keep one current merged interval.', solution: 'Sort by start time. Sweep once, extending the current interval while the next start is within its end. O(n log n).' } };
