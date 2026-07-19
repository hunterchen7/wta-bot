import { useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { publicRequest } from '../api';
import { ProblemContentSection } from '../components/ProblemContentSection';
import { PublicIntro, PublicShell } from '../components/PublicShell';
import { Button } from '../components/ui/button';

type ProblemData = { mode: 'packet' | 'solution'; round: number; scheduledAt: string | null; intervieweeName: string | null; problem: { number: number | null; title: string; url: string | null; difficulty: string; statement: string | null; notes: string | null; hints?: string | null; solution: string | null } };

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
    {data.mode === 'packet' ? <Notice tone="amber">Private interviewer material. Do not share.</Notice> : null}
    {data.mode === 'packet' && !preview && token ? <PairyExport token={token} /> : null}
    {problem.url ? <div className="mb-6 text-sm text-muted-foreground"><a href={problem.url} target="_blank" rel="noreferrer" className="font-bold text-western-700 underline decoration-western-300 underline-offset-4 dark:text-western-300">Open on LeetCode ↗</a></div> : null}
    <div className="space-y-5">{problem.statement ? <ProblemContentSection title="Statement" value={problem.statement} /> : null}{data.mode === 'packet' ? <ProblemContentSection title="Interviewer notes" value={problem.notes ?? 'No interviewer notes have been added yet.'} /> : <ProblemContentSection title="Solution" value={problem.solution ?? 'No solution notes have been added yet.'} />}</div>
  </PublicShell>;
}

function PairyExport({ token }: { token: string }) {
  const packUrl = new URL(
    `/api/problems/${encodeURIComponent(token)}/pairy-pack`,
    window.location.origin,
  );
  // Pairy's importer is live, so the "Import to Pairy" action is on by default.
  // VITE_PAIRY_ORIGIN overrides the target at build time (e.g. a staging Pairy).
  const importUrl = pairyImportUrl(packUrl);

  return <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
    <div>
      <p className="font-bold">Use this question in Pairy</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {importUrl
          ? 'Import this private question directly, or keep the JSON file for later.'
          : 'Download this private question as a Pairy-compatible JSON file.'}
      </p>
    </div>
    <div className="flex flex-wrap gap-2">
      {importUrl ? <Button asChild>
        <a href={importUrl.toString()} target="_blank" rel="noreferrer">
          <ExternalLink aria-hidden="true" />
          Import to Pairy
        </a>
      </Button> : null}
      <Button asChild variant={importUrl ? 'outline' : 'default'}>
        <a href={packUrl.toString()} download>
          <Download aria-hidden="true" />
          Download JSON
        </a>
      </Button>
    </div>
  </div>;
}

const PAIRY_ORIGIN = 'https://pairy.online';

function pairyImportUrl(packUrl: URL): URL | null {
  const origin = import.meta.env.VITE_PAIRY_ORIGIN?.trim() || PAIRY_ORIGIN;
  try {
    const url = new URL('/questions/import', origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.searchParams.set('url', packUrl.toString());
    return url;
  } catch {
    return null;
  }
}

function Notice({ children, tone }: { children: React.ReactNode; tone: 'amber' | 'western' }) { return <div className={`mb-6 rounded-2xl border p-4 text-sm font-semibold ${tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-western-200 bg-western-50 text-western-900'}`}>{children}</div>; }
const previewPacket: ProblemData = { mode: 'packet', round: 2, scheduledAt: '2026-08-12T23:30:00.000Z', intervieweeName: 'Jordan Example', problem: { number: 56, title: 'Merge Intervals', url: 'https://leetcode.com/problems/merge-intervals/', difficulty: 'medium', statement: `You are given a collection of closed intervals, where each interval is represented as \`[start, end]\`. Combine every group of intervals that overlap and return the non-overlapping intervals that cover the same ranges.

### Example

\`\`\`text
Input:  [[1, 3], [2, 6], [8, 10], [15, 18]]
Output: [[1, 6], [8, 10], [15, 18]]
\`\`\`

The first two intervals overlap, so they become \`[1, 6]\`. The remaining intervals stay separate.

### Constraints

- The input contains at least one interval.
- Every interval has exactly two endpoints.
- For each interval, \`start <= end\`.
- The intervals may arrive in any order.`, notes: `### Hint ladder

1. **Ordering:** What useful property do you gain by sorting intervals by their start value?
2. **Overlap check:** After sorting, compare the next interval's start with the end of the interval you are currently building.
3. **Single sweep:** Keep one current merged interval. Extend its end on overlap; otherwise, save it and begin a new one.

### Intended solution

Sort all intervals by their start value. Initialize the result with the first interval, then visit each remaining interval once.

- If the next start is less than or equal to the current end, the intervals overlap. Update the current end to the larger of the two ends.
- Otherwise, the current interval is complete. Append it and begin a new current interval.

### Why it works

After sorting, no later interval can begin before the one currently being considered. That means an interval only needs to be compared with the latest merged range: if they do not overlap, it cannot overlap any earlier completed range either.

### Complexity

- **Time:** \`O(n log n)\` for sorting, followed by an \`O(n)\` scan.
- **Extra space:** \`O(n)\` for the returned intervals; the sweep itself uses constant auxiliary space.`, solution: null } };
