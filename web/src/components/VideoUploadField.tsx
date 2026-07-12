import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileVideo2, Link2, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { OptimizedVideo, VideoAnalysis } from '../lib/video-optimizer';

type Phase = 'idle' | 'analyzing' | 'optimizing' | 'uploading' | 'complete' | 'error';
type UploadPart = { partNumber: number; etag: string };

export function VideoUploadField({ token, value, preview, invalid, onChange }: { token?: string; value: string; preview: boolean; invalid?: boolean; onChange: (value: string) => void }) {
  const [mode, setMode] = useState<'upload' | 'link'>(value && !isInternal(value) ? 'link' : 'upload');
  const [phase, setPhase] = useState<Phase>(value && isInternal(value) ? 'complete' : 'idle');
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(value && isInternal(value) ? 'This report already has a recording attached.' : '');
  const [elapsed, setElapsed] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const optimized = useRef<OptimizedVideo | null>(null);
  const startedAt = useRef(0);

  useEffect(() => () => { controller.current?.abort(); void optimized.current?.cleanup(); }, []);
  useEffect(() => {
    if (phase !== 'optimizing') return;
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const choose = async (selected: File | null) => {
    if (!selected) return;
    resetWork(); setFile(selected); setPhase('analyzing'); setMessage('Preparing your recording…');
    try {
      const { analyzeVideo } = await import('../lib/video-optimizer');
      const result = await analyzeVideo(selected);
      setAnalysis(result);
      if (result.shouldOptimize) await optimizeAndUpload(selected, result);
      else await upload(selected);
    } catch {
      setAnalysis(null);
      await upload(selected);
    }
  };

  const optimizeAndUpload = async (source: File, inspection: VideoAnalysis) => {
    controller.current = new AbortController(); startedAt.current = Date.now(); setElapsed(0); setProgress(0); setPhase('optimizing'); setMessage('Optimizing locally. Keep this tab open; the video never leaves your device during this step.');
    const signal = controller.current.signal;
    try {
      const { optimizeVideo } = await import('../lib/video-optimizer');
      optimized.current = await optimizeVideo(source, inspection, setProgress, signal);
      if (optimized.current.file.size >= source.size * 0.95) {
        await optimized.current.cleanup(); optimized.current = null;
        await upload(source);
      } else await upload(optimized.current.file);
    } catch {
      if (signal.aborted) resetWork();
      else {
        await optimized.current?.cleanup(); optimized.current = null;
        await upload(source);
      }
    }
  };

  const retryUpload = () => file ? void upload(file) : undefined;
  const upload = async (asset: File) => {
    if (preview) { setPhase('complete'); setProgress(1); setMessage(`Preview ready: ${formatBytes(asset.size)}. A live report would now upload this file in reliable chunks.`); return; }
    if (!token) return;
    if (!controller.current || controller.current.signal.aborted) controller.current = new AbortController();
    const signal = controller.current.signal;
    setPhase('uploading'); setProgress(0); setMessage('Uploading securely in reliable chunks…');
    let uploadId: number | null = null;
    try {
      const initialized = await request<{ id: number; partSize: number }>(`/api/forms/${token}/recording/init`, { method: 'POST', signal, body: JSON.stringify({ filename: asset.name, size: asset.size, contentType: asset.type || 'video/mp4' }) });
      uploadId = initialized.id;
      const parts: UploadPart[] = [];
      const totalParts = Math.ceil(asset.size / initialized.partSize);
      for (let index = 0; index < totalParts; index++) {
        const chunk = asset.slice(index * initialized.partSize, Math.min(asset.size, (index + 1) * initialized.partSize));
        const part = await request<UploadPart>(`/api/forms/${token}/recording/${initialized.id}/part/${index + 1}`, { method: 'PUT', signal, headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
        parts.push(part); setProgress((index + 1) / totalParts);
      }
      const result = await request<{ url: string; storedBytes: number }>(`/api/forms/${token}/recording/${initialized.id}/complete`, { method: 'POST', signal, body: JSON.stringify({ parts }) });
      onChange(result.url); setPhase('complete'); setMessage(`Recording ready · ${formatBytes(result.storedBytes)}`);
      await optimized.current?.cleanup(); optimized.current = null;
    } catch (cause) {
      if (uploadId) void fetch(`/api/forms/${token}/recording/${uploadId}`, { method: 'DELETE' });
      if (signal.aborted) resetWork();
      else { setPhase('error'); setMessage(cause instanceof Error ? cause.message : 'The upload failed. Your report answers are still here; try again.'); }
    }
  };

  const cancel = () => controller.current?.abort();
  const resetWork = () => { controller.current?.abort(); controller.current = null; void optimized.current?.cleanup(); optimized.current = null; setFile(null); setAnalysis(null); setProgress(0); setElapsed(0); setMessage(''); setPhase('idle'); onChange(''); };

  if (mode === 'link') return <div className="space-y-3"><Input aria-invalid={invalid} required type="url" value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl bg-background" placeholder="https://drive.google.com/…" /><button type="button" className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground" onClick={() => { onChange(''); setMode('upload'); }}><UploadCloud className="size-3.5" />Upload a file instead</button></div>;

  return <div className={`overflow-hidden rounded-xl border bg-muted/20 ${invalid ? 'border-destructive ring-2 ring-destructive/15' : 'border-border'}`}>
    {phase === 'idle' ? <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center p-6 text-center transition hover:bg-accent/50"><input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" className="sr-only" onChange={(event) => void choose(event.target.files?.[0] ?? null)} /><span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><FileVideo2 className="size-6" /></span><span className="mt-4 text-sm font-black text-foreground">Choose your interview recording</span><span className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">MP4, MOV, WebM, or MKV · up to 2 GB. We’ll prepare it automatically, then upload it.</span></label> : null}
    {phase !== 'idle' ? <div className="p-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary">{phase === 'complete' ? <CheckCircle2 className="size-5" /> : phase === 'analyzing' || phase === 'optimizing' || phase === 'uploading' ? <LoaderCircle className="size-5 animate-spin" /> : <FileVideo2 className="size-5" />}</span><div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-foreground">{file?.name ?? 'Uploaded recording'}</div>{file ? <div className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size)}{analysis ? ` · ${analysis.width}×${analysis.height} · ${formatDuration(analysis.duration)} · ${formatBitrate(analysis.bitrate)}` : ''}</div> : null}<p aria-live="polite" className={`mt-2 text-xs leading-5 ${phase === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p></div>{phase !== 'optimizing' && phase !== 'uploading' ? <button type="button" aria-label="Choose a different recording" className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={resetWork}><X className="size-4" /></button> : null}</div>
      {phase === 'analyzing' || phase === 'optimizing' || phase === 'uploading' ? <div className="mt-4"><div role="progressbar" aria-label={phase === 'optimizing' ? 'Video optimization' : phase === 'uploading' ? 'Recording upload' : 'Video analysis'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase === 'analyzing' ? undefined : Math.round(progress * 100)} className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full bg-emerald-500 transition-[width] duration-300 ${phase === 'analyzing' ? 'w-1/4 animate-pulse' : ''}`} style={phase === 'optimizing' || phase === 'uploading' ? { width: `${Math.max(progress * 100, 2)}%` } : undefined} /></div><div className="mt-2 flex justify-between text-[0.68rem] font-bold text-muted-foreground"><span>{phase === 'optimizing' ? 'Optimizing on this device' : phase === 'uploading' ? 'Secure upload' : 'Analyzing'}</span><span>{phase === 'optimizing' ? `${Math.round(progress * 100)}% · ${formatElapsed(elapsed)}` : phase === 'uploading' ? `${Math.round(progress * 100)}%` : ''}</span></div></div> : null}
      {phase === 'optimizing' || phase === 'uploading' ? <div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{phase === 'optimizing' ? 'Hardware acceleration is preferred automatically.' : 'Your report answers stay here if you cancel.'}</p><Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={cancel}>Cancel</Button></div> : null}
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
const formatBytes = (bytes: number) => bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(bytes < 100 * 1024 ** 2 ? 1 : 0)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const formatDuration = (seconds: number) => { const total = Math.round(seconds); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
const formatBitrate = (bits: number) => `${(bits / 1_000_000).toFixed(1)} Mbps`;
const formatElapsed = (milliseconds: number) => `${Math.floor(milliseconds / 60_000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`;
