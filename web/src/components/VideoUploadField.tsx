import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileVideo2, Link2, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { OptimizedVideo, VideoAnalysis } from '../lib/video-optimizer';

type Phase = 'idle' | 'analyzing' | 'optimizing' | 'uploading' | 'complete' | 'error';
type UploadPart = { partNumber: number; etag: string };
type UploadSession = { partSize: number; id?: number; key?: string; uploadId?: string };

export function VideoUploadField({ token, value, preview, invalid, onChange }: { token?: string; value: string; preview: boolean; invalid?: boolean; onChange: (value: string) => void }) {
  const [mode, setMode] = useState<'upload' | 'link'>(value && !isInternal(value) ? 'link' : 'upload');
  const [phase, setPhase] = useState<Phase>(value && isInternal(value) ? 'complete' : 'idle');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(value && isInternal(value) ? 'This report already has a recording attached.' : '');
  const controller = useRef<AbortController | null>(null);
  const optimized = useRef<OptimizedVideo | null>(null);

  useEffect(() => () => { controller.current?.abort(); void optimized.current?.cleanup(); }, []);

  const choose = async (selected: File | null) => {
    if (!selected) return;
    resetWork(); setFile(selected); setPhase('analyzing'); setProgress(0.02); setMessage('Processing…');
    try {
      const { analyzeVideo } = await import('../lib/video-optimizer');
      const result = await analyzeVideo(selected);
      if (result.shouldOptimize) await optimizeAndUpload(selected, result);
      else await upload(selected, 0.1);
    } catch {
      await upload(selected, 0.1);
    }
  };

  const optimizeAndUpload = async (source: File, inspection: VideoAnalysis) => {
    controller.current = new AbortController(); setProgress(0.05); setPhase('optimizing'); setMessage('Processing…');
    const signal = controller.current.signal;
    try {
      const { optimizeVideo } = await import('../lib/video-optimizer');
      optimized.current = await optimizeVideo(source, inspection, (value) => setProgress(0.05 + value * 0.7), signal);
      if (optimized.current.file.size >= source.size * 0.95) {
        await optimized.current.cleanup(); optimized.current = null;
        await upload(source, 0.75);
      } else await upload(optimized.current.file, 0.75);
    } catch {
      if (signal.aborted) resetWork();
      else {
        await optimized.current?.cleanup(); optimized.current = null;
        await upload(source, 0.75);
      }
    }
  };

  const retryUpload = () => file ? void upload(file, 0.1) : undefined;
  const upload = async (asset: File, progressStart: number) => {
    if (!preview && !token) return;
    if (!controller.current || controller.current.signal.aborted) controller.current = new AbortController();
    const signal = controller.current.signal;
    setPhase('uploading'); setProgress(progressStart); setMessage('Uploading…');
    let session: UploadSession | null = null;
    try {
      session = await request<UploadSession>(preview ? '/api/admin/previews/recording/init' : `/api/forms/${token}/recording/init`, { method: 'POST', signal, body: JSON.stringify({ filename: asset.name, size: asset.size, contentType: mediaType(asset) }) });
      const parts: UploadPart[] = [];
      const totalParts = Math.ceil(asset.size / session.partSize);
      for (let index = 0; index < totalParts; index++) {
        const chunk = asset.slice(index * session.partSize, Math.min(asset.size, (index + 1) * session.partSize));
        const partUrl = preview ? `/api/admin/previews/recording/part/${index + 1}` : `/api/forms/${token}/recording/${session.id}/part/${index + 1}`;
        const part = await request<UploadPart>(partUrl, { method: 'PUT', signal, headers: { 'Content-Type': 'application/octet-stream', ...(previewUploadHeaders(session)) }, body: chunk });
        parts.push(part); setProgress(progressStart + ((index + 1) / totalParts) * (1 - progressStart));
      }
      const completeUrl = preview ? '/api/admin/previews/recording/complete' : `/api/forms/${token}/recording/${session.id}/complete`;
      const result = await request<{ url?: string; storedBytes: number }>(completeUrl, { method: 'POST', signal, body: JSON.stringify(preview ? { key: session.key, uploadId: session.uploadId, parts } : { parts }) });
      if (!preview && result.url) onChange(result.url);
      setProgress(1); setPhase('complete'); setMessage(preview ? 'Test upload complete. The recording was discarded.' : 'Recording ready.');
      await optimized.current?.cleanup(); optimized.current = null;
    } catch {
      if (session) void discardUpload(preview, token, session);
      if (signal.aborted) resetWork();
      else { setPhase('error'); setMessage('We couldn’t process this recording. Your report answers are still here; try again.'); }
    }
  };

  const cancel = () => controller.current?.abort();
  const resetWork = () => { controller.current?.abort(); controller.current = null; void optimized.current?.cleanup(); optimized.current = null; setFile(null); setProgress(0); setMessage(''); setPhase('idle'); onChange(''); };

  if (mode === 'link') return <div className="space-y-3"><Input aria-invalid={invalid} required type="url" value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl bg-background" placeholder="https://drive.google.com/…" /><button type="button" className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground" onClick={() => { onChange(''); setMode('upload'); }}><UploadCloud className="size-3.5" />Upload a file instead</button></div>;

  return <div className={`overflow-hidden rounded-xl border bg-muted/20 ${invalid ? 'border-destructive ring-2 ring-destructive/15' : 'border-border'}`}>
    {phase === 'idle' ? <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center p-6 text-center transition hover:bg-accent/50"><input type="file" accept=".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska,video/matroska" className="sr-only" onChange={(event) => void choose(event.target.files?.[0] ?? null)} /><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><FileVideo2 className="size-6" /></span><span className="mt-4 text-sm font-black text-foreground">Choose your interview recording</span><span className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">MP4, MOV, WebM, or MKV · up to 2 GB. We’ll process it automatically.</span></label> : null}
    {phase !== 'idle' ? <div className="p-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary">{phase === 'complete' ? <CheckCircle2 className="size-5" /> : phase === 'analyzing' || phase === 'optimizing' || phase === 'uploading' ? <LoaderCircle className="size-5 animate-spin" /> : <FileVideo2 className="size-5" />}</span><div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-foreground">{file?.name ?? 'Uploaded recording'}</div><p aria-live="polite" className={`mt-1 text-xs leading-5 ${phase === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p></div>{phase !== 'optimizing' && phase !== 'uploading' ? <button type="button" aria-label="Choose a different recording" className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={resetWork}><X className="size-4" /></button> : null}</div>
      {phase === 'analyzing' || phase === 'optimizing' || phase === 'uploading' ? <div className="mt-4"><div role="progressbar" aria-label={phase === 'uploading' ? 'Recording upload progress' : 'Recording processing progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress * 100}%` }} /></div><div className="mt-2 text-right text-[0.68rem] font-bold tabular-nums text-muted-foreground">{Math.round(progress * 100)}%</div></div> : null}
      {phase === 'optimizing' || phase === 'uploading' ? <div className="mt-4 flex justify-end"><Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={cancel}>Cancel</Button></div> : null}
      {phase === 'error' && file ? <div className="mt-4 flex flex-wrap gap-2"><Button type="button" className="cursor-pointer" onClick={retryUpload}>Try upload again</Button><Button type="button" variant="outline" className="cursor-pointer" onClick={resetWork}>Choose another file</Button></div> : null}
    </div> : null}
    <div className="border-t border-border px-5 py-3"><button type="button" className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground" onClick={() => { resetWork(); setMode('link'); }}><Link2 className="size-3.5" />Use an existing recording link instead</button></div>
  </div>;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), ...init.headers } });
  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(result.message ?? 'The recording request failed.');
  return result as T;
}
const isInternal = (value: string) => /\/api\/recordings\/\d+$/.test(value);
const mediaType = (file: File) => file.name.toLowerCase().endsWith('.mkv') ? 'video/x-matroska' : file.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' : file.name.toLowerCase().endsWith('.webm') ? 'video/webm' : file.name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : file.type || 'video/mp4';
const previewUploadHeaders = (session: UploadSession): Record<string, string> => session.key && session.uploadId ? { 'X-WTA-Object-Key': session.key, 'X-WTA-Upload-Id': session.uploadId } : {};
const discardUpload = (preview: boolean, token: string | undefined, session: UploadSession) => preview
  ? fetch('/api/admin/previews/recording', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: session.key, uploadId: session.uploadId }) })
  : session.id ? fetch(`/api/forms/${token}/recording/${session.id}`, { method: 'DELETE' }) : Promise.resolve();
