import { useEffect, useRef, useState } from 'react';
import { adminFileRequest } from '../api';
import { Button, Dialog, formatDate } from './AdminUI';
import { ScrollArea } from './ui/scroll-area';
import { Skeleton } from './ui/skeleton';

export type ResumePreviewTarget = {
  participantId: number;
  participantName: string;
  filename: string;
  contentType: string;
  bytes: number | null;
  uploadedAt: string | null;
};

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'pdf'; url: string }
  | { kind: 'docx'; blob: Blob }
  | { kind: 'text'; text: string }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

export function ResumePreviewDialog({ target, onClose }: { target: ResumePreviewTarget; onClose: () => void }) {
  const [reloadToken, setReloadToken] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    setPreview({ kind: 'loading' });

    void adminFileRequest(`/participants/${target.participantId}/resume`, controller.signal)
      .then(async (blob) => {
        if (!active) return;
        const format = resumeFormat(target.filename, target.contentType || blob.type);
        if (format === 'pdf') {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: 'pdf', url: objectUrl });
          return;
        }
        if (format === 'docx') {
          setPreview({ kind: 'docx', blob });
          return;
        }
        if (format === 'rtf') {
          setPreview({ kind: 'text', text: rtfToText(await blob.text()) });
          return;
        }
        if (format === 'odt') {
          setPreview({ kind: 'text', text: await odtToText(blob) });
          return;
        }
        setPreview({ kind: 'unsupported' });
      })
      .catch((cause: unknown) => {
        if (!active || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setPreview({ kind: 'error', message: cause instanceof Error ? cause.message : 'The resume could not be loaded.' });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reloadToken, target.contentType, target.filename, target.participantId]);

  const details = [target.participantName, formatBytes(target.bytes), target.uploadedAt ? `uploaded ${formatDate(target.uploadedAt)}` : null].filter(Boolean).join(' · ');
  return <Dialog size="viewport" bodyClassName="!overflow-hidden !p-0" title={target.filename} description={details} onClose={onClose}>
    <div className="h-full min-h-[22rem] bg-slate-100/70 dark:bg-slate-950/50">
      {preview.kind === 'loading' ? <ResumePreviewSkeleton /> : null}
      {preview.kind === 'pdf' ? <iframe className="h-full min-h-[22rem] w-full border-0 bg-white" src={preview.url} title={`${target.filename} preview`} /> : null}
      {preview.kind === 'docx' ? <DocxPreview blob={preview.blob} /> : null}
      {preview.kind === 'text' ? <TextDocumentPreview text={preview.text} /> : null}
      {preview.kind === 'unsupported' ? <PreviewMessage title="This file cannot be previewed in the browser" description="Legacy DOC files do not have a safe, reliable in-browser renderer. Ask the participant to replace it with a PDF or DOCX file." /> : null}
      {preview.kind === 'error' ? <PreviewMessage title="Couldn’t load this resume" description={preview.message} action={<Button variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>Try again</Button>} /> : null}
    </div>
  </Dialog>;
}

function DocxPreview({ blob }: { blob: Blob }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    setState('loading');
    container.replaceChildren();
    void import('docx-preview')
      .then(({ renderAsync }) => renderAsync(blob, container, undefined, {
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        ignoreLastRenderedPageBreak: true,
      }))
      .then(() => {
        if (!active) return;
        for (const link of container.querySelectorAll('a')) {
          link.target = '_blank';
          link.rel = 'noreferrer';
        }
        setState('ready');
      })
      .catch(() => { if (active) setState('error'); });
    return () => {
      active = false;
      container.replaceChildren();
    };
  }, [blob]);

  if (state === 'error') return <PreviewMessage title="Couldn’t render this Word document" description="The file loaded, but its document structure could not be displayed. Ask the participant to replace it with a PDF." />;
  return <div className="relative h-full min-h-[22rem]">
    {state === 'loading' ? <ResumePreviewSkeleton /> : null}
    <ScrollArea horizontal className={`h-full min-h-[22rem] transition-opacity duration-200 motion-reduce:transition-none ${state === 'ready' ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
      <div className="min-h-full min-w-fit p-4 sm:p-8">
        <div ref={containerRef} className="[&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0 [&_section.docx]:!mb-5 [&_section.docx]:!shadow-[0_8px_30px_rgba(15,23,42,.14)]" />
      </div>
    </ScrollArea>
  </div>;
}

function TextDocumentPreview({ text }: { text: string }) {
  return <ScrollArea horizontal className="h-full min-h-[22rem]">
    <div className="mx-auto my-5 min-h-[calc(100%-2.5rem)] w-[min(50rem,calc(100%-2rem))] rounded-sm bg-[#fff] px-7 py-9 text-[#0f172a] shadow-[0_8px_30px_rgba(15,23,42,.13)] [color-scheme:light] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 sm:px-12 sm:py-12">
      <pre className="whitespace-pre-wrap font-sans text-sm leading-7">{text || 'This document does not contain readable text.'}</pre>
    </div>
  </ScrollArea>;
}

function ResumePreviewSkeleton() {
  return <div aria-label="Loading resume preview" className="absolute inset-0 z-10 flex justify-center overflow-hidden p-5 sm:p-8">
    <div className="w-full max-w-3xl rounded-sm bg-card p-7 shadow-sm sm:p-12">
      <Skeleton className="h-8 w-2/5" />
      <Skeleton className="mt-3 h-4 w-3/5" />
      <div className="mt-10 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /></div>
      <Skeleton className="mt-10 h-5 w-1/4" />
      <div className="mt-4 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-3/4" /></div>
    </div>
  </div>;
}

function PreviewMessage({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex h-full min-h-[22rem] items-center justify-center p-6 text-center">
    <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
      <div className="mx-auto size-10 rounded-full bg-western-100 ring-8 ring-western-100/40 dark:bg-western-950 dark:ring-western-950/40" />
      <h2 className="mt-5 font-black text-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  </div>;
}

function resumeFormat(filename: string, contentType: string) {
  const extension = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (contentType === 'application/pdf' || extension === '.pdf') return 'pdf';
  if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || extension === '.docx') return 'docx';
  if (contentType === 'application/rtf' || contentType === 'text/rtf' || extension === '.rtf') return 'rtf';
  if (contentType === 'application/vnd.oasis.opendocument.text' || extension === '.odt') return 'odt';
  return 'unsupported';
}

function rtfToText(rtf: string) {
  return rtf
    .replace(/\{\\fonttbl[\s\S]*?\}\}/gi, '')
    .replace(/\{\\colortbl[\s\S]*?\}/gi, '')
    .replace(/\\u(-?\d+)\??/g, (_, value: string) => String.fromCharCode(Number(value) < 0 ? Number(value) + 65536 : Number(value)))
    .replace(/\\'([0-9a-f]{2})/gi, (_, value: string) => String.fromCharCode(Number.parseInt(value, 16)))
    .replace(/\\par\b/gi, '\n')
    .replace(/\\tab\b/gi, '\t')
    .replace(/\\line\b/gi, '\n')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/\\([\\{}])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function odtToText(blob: Blob) {
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(blob);
  const content = await archive.file('content.xml')?.async('string');
  if (!content) throw new Error('This ODT file is missing its document content.');
  const xml = new DOMParser().parseFromString(content, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('This ODT file could not be read.');
  return Array.from(xml.getElementsByTagName('*'))
    .filter((element) => element.localName === 'h' || element.localName === 'p')
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');
}

function formatBytes(value: number | null) {
  if (value == null) return 'Size unavailable';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
