import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Clock3, ExternalLink, Flag, LoaderCircle, Maximize2, Pause, Play, RotateCcw, RotateCw, Save, Sparkles, Video, Volume2, VolumeX } from 'lucide-react';
import type { ReviewAiDimension, ReviewAiEvaluation, ReviewAnalysis, ReviewDetail, ReviewEvidence, ReviewReport, ReviewRow, ReviewsData } from '../../admin-types';
import { adminRequest } from '../../api';
import { SelectControl } from '../../components/SelectControl';
import { Badge, Button, Dialog, EmptyState, ErrorState, LoadingState, PageIntro, Panel, Tabs, formatDate } from '../../components/AdminUI';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Skeleton } from '../../components/ui/skeleton';
import { Slider } from '../../components/ui/slider';
import { Textarea } from '../../components/ui/textarea';
import { useAdminData } from '../../hooks/useAdminData';
import { LIVE_REFRESH_INTERVAL_MS } from '../../hooks/useAutoRefresh';

type ReviewTab = 'pending' | 'flagged' | 'verified' | 'all';
type ReviewAction = 'save' | 'approve' | 'flag';
type RubricDraft = {
  completionRating: number | null;
  communicationRating: number | null;
  problemSolvingRating: number | null;
  implementationRating: number | null;
  testingRating: number | null;
  recordingQuality: number | null;
  notes: string;
};

const emptyRubric: RubricDraft = {
  completionRating: null,
  communicationRating: null,
  problemSolvingRating: null,
  implementationRating: null,
  testingRating: null,
  recordingQuality: null,
  notes: '',
};

export function ReviewsPage() {
  const { data, error, loading, reload, setData } = useAdminData<ReviewsData>('/reviews', LIVE_REFRESH_INTERVAL_MS);
  const [tab, setTab] = useState<ReviewTab>('pending');
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const rows = useMemo(
    () => data?.reviews.filter((row) => tab === 'all' || row.review_state === tab) ?? [],
    [data, tab],
  );

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? 'No reviews returned.'} onRetry={() => void reload()} />;

  const counts = {
    pending: data.reviews.filter((row) => row.review_state === 'pending').length,
    flagged: data.reviews.filter((row) => row.review_state === 'flagged').length,
    verified: data.reviews.filter((row) => row.review_state === 'verified').length,
  };
  const updateRow = (id: number, state: string, draft: RubricDraft) => {
    setData((current) => current ? {
      reviews: current.reviews.map((row) => row.id === id ? {
        ...row,
        review_state: state,
        completion_rating: draft.completionRating,
        rubric_updated_at: new Date().toISOString(),
      } : row),
    } : current);
  };

  return <div className="space-y-7">
    <PageIntro
      title="Round 3 reviews"
      description="Watch each submitted recording, compare both reports, and record a consistent completion decision with the organizer rubric."
    />
    <ReviewSummary pending={counts.pending} flagged={counts.flagged} verified={counts.verified} />
    <div className="flex">
      <Tabs
        value={tab}
        onChange={(value) => setTab(value as ReviewTab)}
        items={[
          { value: 'pending', label: 'To review', count: counts.pending },
          { value: 'flagged', label: 'Needs follow-up', count: counts.flagged },
          { value: 'verified', label: 'Completed', count: counts.verified },
          { value: 'all', label: 'All', count: data.reviews.length },
        ]}
      />
    </div>
    {rows.length ? <div className="space-y-3">{rows.map((row) => (
      <ReviewQueueRow key={row.id} row={row} onOpen={() => setSelected(row)} />
    ))}</div> : <Panel><EmptyState title={`No ${tab === 'pending' ? 'pending' : tab} reviews`} description="Round 3 submissions appear here as reports arrive." /></Panel>}
    {selected ? <ReviewWorkspace
      sessionId={selected.id}
      onClose={() => setSelected(null)}
      onSaved={(state, draft) => updateRow(selected.id, state, draft)}
    /> : null}
  </div>;
}

function ReviewSummary({ pending, flagged, verified }: { pending: number; flagged: number; verified: number }) {
  return <div className="grid gap-3 sm:grid-cols-3">
    <SummaryCard label="Waiting" value={pending} tone="text-amber-700 dark:text-amber-300" />
    <SummaryCard label="Needs follow-up" value={flagged} tone="text-rose-700 dark:text-rose-300" />
    <SummaryCard label="Completed" value={verified} tone="text-emerald-700 dark:text-emerald-300" />
  </div>;
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
    <div className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
    <div className={`mt-1 text-3xl font-black tabular-nums ${tone}`}>{value}</div>
  </div>;
}

function ReviewQueueRow({ row, onOpen }: { row: ReviewRow; onOpen: () => void }) {
  const problem = row.problem_title
    ? `${row.problem_number ? `#${row.problem_number} · ` : ''}${row.problem_title}`
    : 'Problem not recorded';
  return <button
    type="button"
    onClick={onOpen}
    className="group grid w-full cursor-pointer gap-4 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-western-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-western-500 motion-reduce:transform-none sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
  >
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge value={row.review_state} />
        <span className="text-xs font-bold text-muted-foreground">Session #{row.id}</span>
        <span className="text-xs text-muted-foreground">{row.reports_in}/2 reports</span>
        {row.video_url ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300"><Video className="size-3.5" /> Recording ready</span> : <span className="text-xs font-bold text-rose-700 dark:text-rose-300">No recording</span>}
      </div>
      <div className="mt-2 truncate text-base font-black text-foreground">{row.interviewee_name}</div>
      <div className="mt-0.5 truncate text-sm text-muted-foreground">Interviewed by {row.interviewer_name} · {problem}</div>
      <div className="mt-2 text-xs text-muted-foreground">{row.scheduled_at ? formatDate(row.scheduled_at) : 'Time not recorded'}{row.reviewer_name ? ` · Last reviewed by ${row.reviewer_name}` : ''}</div>
    </div>
    <span className="inline-flex items-center justify-center gap-2 rounded-xl bg-western-700 px-4 py-2.5 text-sm font-black text-white transition group-hover:bg-western-800">
      <Play className="size-4 fill-current" /> {row.review_state === 'pending' ? 'Start review' : 'Open review'}
    </span>
  </button>;
}

function ReviewWorkspace({ sessionId, onClose, onSaved }: { sessionId: number; onClose: () => void; onSaved: (state: string, draft: RubricDraft) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RubricDraft>(emptyRubric);
  const [baseline, setBaseline] = useState(JSON.stringify(emptyRubric));
  const [busy, setBusy] = useState<ReviewAction | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;

  useEffect(() => {
    const controller = new AbortController();
    adminRequest<ReviewDetail>(`/reviews/${sessionId}`, { signal: controller.signal })
      .then((value) => {
        const next = rubricFromDetail(value);
        setDetail(value);
        setDraft(next);
        setBaseline(JSON.stringify(next));
        setLoadError(null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'Could not load this review.');
      });
    return () => controller.abort();
  }, [sessionId]);

  useEffect(() => {
    if (!detail?.analysis || !['queued', 'transcribing', 'evaluating'].includes(detail.analysis.status)) return;
    const refresh = window.setInterval(() => {
      void adminRequest<ReviewDetail>(`/reviews/${sessionId}`)
        .then((value) => setDetail(value))
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(refresh);
  }, [detail?.analysis?.status, sessionId]);

  const close = () => {
    if (dirty && !window.confirm('Discard the unsaved rubric changes?')) return;
    onClose();
  };
  const save = async (action: ReviewAction) => {
    setBusy(action);
    setSaveError(null);
    try {
      const result = await adminRequest<{ state: string }>(`/reviews/${sessionId}/rubric`, {
        method: 'POST',
        body: JSON.stringify({ action, ...draft }),
      });
      setBaseline(JSON.stringify(draft));
      setDetail((current) => current ? { ...current, session: { ...current.session, review_state: result.state } } : current);
      onSaved(result.state, draft);
      if (action !== 'save') onClose();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save this review.');
    } finally {
      setBusy(null);
    }
  };
  const complete = rubricComplete(draft);
  const approvable = complete && (draft.completionRating ?? 0) >= 3;

  return <Dialog
    title={detail ? `${detail.session.interviewee_name} · Round ${detail.session.round} review` : 'Loading review'}
    description={detail ? `Session #${detail.session.id} · interviewed by ${detail.session.interviewer_name}` : 'Loading the recording, reports, and saved rubric…'}
    onClose={close}
    size="viewport"
    bodyClassName="p-0"
    actions={detail ? <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <div className="text-xs font-semibold text-muted-foreground">{dirty ? 'Unsaved changes' : detail.rubric ? `Saved ${formatDate(detail.rubric.updated_at)}` : 'Not started'}</div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={Boolean(busy) || !dirty} onClick={() => void save('save')}><Save className="size-4" />{busy === 'save' ? 'Saving…' : 'Save draft'}</Button>
        <Button variant="danger" disabled={Boolean(busy) || !complete || !draft.notes.trim()} onClick={() => void save('flag')}><Flag className="size-4" />{busy === 'flag' ? 'Saving…' : 'Needs follow-up'}</Button>
        <Button disabled={Boolean(busy) || !approvable} onClick={() => void save('approve')}><CheckCircle2 className="size-4" />{busy === 'approve' ? 'Completing…' : 'Approve completion'}</Button>
      </div>
    </div> : undefined}
  >
    {loadError ? <div className="p-6"><ErrorState message={loadError} onRetry={() => window.location.reload()} /></div> : null}
    {!detail && !loadError ? <ReviewWorkspaceSkeleton /> : null}
    {detail ? <div className="grid min-h-full lg:grid-cols-[minmax(0,1.3fr)_minmax(23rem,.7fr)]">
      <div className="min-w-0 space-y-5 border-b border-border bg-slate-950 p-4 text-slate-100 lg:border-r lg:border-b-0 sm:p-5">
        <RecordingPanel url={detail.videoUrl} captionsUrl={detail.analysis?.captionsUrl ?? null} videoRef={videoRef} />
        <SessionContext detail={detail} />
        <AiReviewPanel
          analysis={detail.analysis}
          onSeek={(seconds) => {
            const video = videoRef.current;
            if (!video) return;
            video.currentTime = Math.max(0, seconds);
            void video.play().catch(() => undefined);
          }}
          onRetry={async () => {
            await adminRequest(`/reviews/${sessionId}/analysis/retry`, { method: 'POST' });
            const value = await adminRequest<ReviewDetail>(`/reviews/${sessionId}`);
            setDetail(value);
          }}
        />
        <SubmittedReports reports={detail.reports} />
      </div>
      <div className="min-w-0 bg-background p-5 sm:p-6">
        <RubricForm value={draft} onChange={setDraft} />
        {saveError ? <div role="alert" className="mt-5 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{saveError}</div> : null}
      </div>
    </div> : null}
  </Dialog>;
}

function ReviewWorkspaceSkeleton() {
  return <div className="grid min-h-[34rem] lg:grid-cols-[1.3fr_.7fr]">
    <div className="space-y-5 bg-slate-950 p-5"><Skeleton className="aspect-video w-full bg-slate-800" /><Skeleton className="h-28 bg-slate-800" /></div>
    <div className="space-y-4 p-6"><Skeleton className="h-8 w-48" />{[1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="h-24" />)}</div>
  </div>;
}

function RecordingPanel({ url, captionsUrl, videoRef }: { url: string | null; captionsUrl: string | null; videoRef: RefObject<HTMLVideoElement | null> }) {
  if (!url) return <div className="grid aspect-video place-items-center rounded-2xl border border-rose-400/30 bg-slate-900 p-8 text-center">
    <div><Video className="mx-auto size-8 text-rose-300" /><div className="mt-3 font-black">Recording missing</div><p className="mt-1 text-sm text-slate-400">The interviewee report does not contain a recording.</p></div>
  </div>;
  if (!isPlayableRecording(url)) return <div className="grid aspect-video place-items-center rounded-2xl border border-white/10 bg-slate-900 p-8 text-center">
    <div><ExternalLink className="mx-auto size-8 text-western-300" /><div className="mt-3 font-black">External recording</div><p className="mt-1 max-w-md text-sm text-slate-400">This provider cannot be played safely inside the dashboard.</p><a href={url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-western-400 px-4 py-2.5 text-sm font-black text-slate-950">Open recording <ExternalLink className="size-4" /></a></div>
  </div>;
  return <ReviewVideoPlayer src={url} captionsUrl={captionsUrl} videoRef={videoRef} />;
}

const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

function ReviewVideoPlayer({ src, captionsUrl, videoRef }: { src: string; captionsUrl: string | null; videoRef: RefObject<HTMLVideoElement | null> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(readReviewPlaybackRate);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
    try { window.localStorage.setItem('wta.reviewPlaybackRate', String(playbackRate)); } catch { /* Storage can be unavailable in strict browser modes. */ }
  }, [playbackRate]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };
  const seekBy = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration || video.duration || 0, video.currentTime + seconds));
  };
  const toggleMute = () => {
    const video = videoRef.current;
    if (video) video.muted = !video.muted;
  };
  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen();
  };
  const handleShortcut = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === ' ' || event.key.toLowerCase() === 'k') { event.preventDefault(); togglePlayback(); }
    else if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'j') { event.preventDefault(); seekBy(-10); }
    else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'l') { event.preventDefault(); seekBy(10); }
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); toggleMute(); }
    else if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); }
  };

  return <div
    ref={containerRef}
    tabIndex={0}
    onKeyDown={handleShortcut}
    aria-label="Interview recording player. Space or K plays and pauses; J and L seek ten seconds; M mutes; F enters fullscreen."
    className="group overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-western-300"
  >
    <button type="button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={togglePlayback} className="relative block aspect-video w-full cursor-pointer bg-black">
      <video
        ref={videoRef}
        preload="metadata"
        playsInline
        className="h-full w-full bg-black object-contain"
        src={src}
        onLoadedMetadata={(event) => {
          const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
          setDuration(nextDuration);
          event.currentTarget.playbackRate = playbackRate;
        }}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
      >
        {captionsUrl ? <track kind="captions" src={captionsUrl} srcLang="en" label="English" default /> : null}
        Your browser cannot play this recording.
      </video>
      {!playing ? <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10"><span className="grid size-16 place-items-center rounded-full border border-white/20 bg-black/65 text-white shadow-xl backdrop-blur-sm transition-transform group-hover:scale-105"><Play className="ml-1 size-7 fill-current" /></span></span> : null}
    </button>
    <div className="space-y-3 border-t border-white/10 bg-slate-950 px-3 py-3 text-white sm:px-4">
      <Slider
        aria-label="Video progress"
        value={[Math.min(currentTime, duration || 0)]}
        max={duration || 1}
        step={0.1}
        onValueChange={([next]) => {
          const video = videoRef.current;
          if (video && next != null) video.currentTime = next;
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <PlayerButton label={playing ? 'Pause' : 'Play'} onClick={togglePlayback}>{playing ? <Pause /> : <Play className="fill-current" />}</PlayerButton>
          <PlayerButton label="Back 10 seconds" onClick={() => seekBy(-10)}><RotateCcw /></PlayerButton>
          <PlayerButton label="Forward 10 seconds" onClick={() => seekBy(10)}><RotateCw /></PlayerButton>
          <span className="ml-1 min-w-[6.8rem] text-xs font-bold tabular-nums text-slate-300">{formatVideoTime(currentTime)} / {formatVideoTime(duration)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <SelectControl
            label="Playback speed"
            value={String(playbackRate)}
            onChange={(value) => setPlaybackRate(Number(value))}
            options={playbackRates.map((rate) => ({ value: String(rate), label: `${rate}×` }))}
            className="h-8 w-[5.5rem] rounded-lg border-white/15 bg-white/10 px-2.5 text-xs font-black text-white hover:bg-white/15"
          />
          <PlayerButton label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>{muted ? <VolumeX /> : <Volume2 />}</PlayerButton>
          <PlayerButton label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={toggleFullscreen}><Maximize2 /></PlayerButton>
        </div>
      </div>
    </div>
  </div>;
}

function PlayerButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className="grid size-9 cursor-pointer place-items-center rounded-lg text-slate-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-western-300 [&_svg]:size-4">{children}</button>;
}

function readReviewPlaybackRate() {
  try {
    const stored = Number(window.localStorage.getItem('wta.reviewPlaybackRate'));
    return playbackRates.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function formatVideoTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remaining = rounded % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}` : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function isPlayableRecording(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/recordings/')
      || /\.(mp4|webm|mov|mkv)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function SessionContext({ detail }: { detail: ReviewDetail }) {
  const { session } = detail;
  return <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2">
    <ContextItem label="Interviewee" value={session.interviewee_name} />
    <ContextItem label="Interviewer" value={session.interviewer_name} />
    <ContextItem label="Problem" value={session.problem_title ? `${session.problem_number ? `#${session.problem_number} · ` : ''}${session.problem_title}` : 'Not recorded'} />
    <ContextItem label="Scheduled" value={session.scheduled_at ? formatDate(session.scheduled_at) : 'Not recorded'} />
  </div>;
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[0.65rem] font-black uppercase tracking-[0.15em] text-slate-500">{label}</div><div className="mt-1 text-sm font-bold text-slate-100">{value}</div></div>;
}

function AiReviewPanel({ analysis, onSeek, onRetry }: { analysis: ReviewAnalysis | null; onSeek: (seconds: number) => void; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const status = analysis?.status ?? null;
  const statusLabel = status === 'queued' ? 'Queued'
    : status === 'transcribing' ? 'Transcribing'
      : status === 'evaluating' ? 'Evaluating'
        : status === 'ready' ? 'Ready'
          : status === 'failed' ? 'Failed'
            : 'Unavailable';
  const running = status === 'queued' || status === 'transcribing' || status === 'evaluating';
  const evaluation = analysis?.evaluation ?? null;

  return <div className="overflow-hidden rounded-2xl border border-western-300/20 bg-gradient-to-br from-western-950/40 to-slate-950">
    <Accordion type="single" collapsible>
      <AccordionItem value="ai-review" className="border-0 px-4">
        <AccordionTrigger className="py-4 text-slate-100 hover:no-underline">
          <span className="flex min-w-0 items-center gap-3 text-left">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-western-400/15 text-western-200">
              {running ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : status === 'failed' ? <AlertTriangle className="size-4 text-rose-300" /> : <Sparkles className="size-4" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black">AI-assisted review</span>
              <span className="mt-0.5 block text-xs font-normal text-slate-400">{statusLabel} · Advisory evidence, hidden until opened</span>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          {!analysis ? <AnalysisMessage
            icon={<Bot className="size-5" />}
            title="No automatic analysis"
            description="Automatic analysis is available for recordings uploaded directly to WTA. External recording links still use the organizer rubric."
          /> : null}
          {running ? <AnalysisMessage
            icon={<LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />}
            title={status === 'queued' ? 'Waiting for the GPU worker' : status === 'transcribing' ? 'Creating transcript and captions' : 'Evaluating against the rubric'}
            description={status === 'transcribing'
              ? 'The recording is being processed privately on the Olares GPU. This panel refreshes automatically.'
              : status === 'evaluating'
                ? 'The transcript is ready. The evaluator is building an evidence-linked recap and recommendations.'
                : 'The recording is safely stored and will be claimed automatically.'}
          /> : null}
          {status === 'failed' || analysis?.lastError && status === 'evaluating' ? <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-4">
            <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-300" /><div><div className="text-sm font-black text-rose-100">Analysis needs another attempt</div><p className="mt-1 text-xs leading-5 text-rose-200/75">{analysis?.lastError ?? 'The analysis worker could not complete this recording.'}</p></div></div>
            <button
              type="button"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                setRetryError(null);
                void onRetry().catch((cause) => setRetryError(cause instanceof Error ? cause.message : 'Could not retry analysis.')).finally(() => setRetrying(false));
              }}
              className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-rose-100 px-3 py-2 text-xs font-black text-rose-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >{retrying ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : <RotateCw className="size-3.5" />}{retrying ? 'Retrying…' : 'Retry analysis'}</button>
            {retryError ? <p role="alert" className="mt-2 text-xs font-bold text-rose-200">{retryError}</p> : null}
          </div> : null}
          {status === 'ready' && evaluation && analysis ? <AiReviewResult analysis={analysis} onSeek={onSeek} /> : null}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>;
}

function AnalysisMessage({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-slate-200">
    <span className="mt-0.5 text-western-200">{icon}</span>
    <div><div className="text-sm font-black">{title}</div><p className="mt-1 text-xs leading-5 text-slate-400">{description}</p></div>
  </div>;
}

function AiReviewResult({ analysis, onSeek }: { analysis: ReviewAnalysis; onSeek: (seconds: number) => void }) {
  const evaluation = analysis.evaluation!;
  const unusableRecording = evaluation.evidenceDisposition?.status === 'unusable';
  return <div className="space-y-4 text-slate-100">
    {unusableRecording ? <div className="rounded-xl border border-rose-300/25 bg-rose-400/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-rose-200" />
        <div><div className="text-sm font-black text-rose-100">Administrative score: 0</div><p className="mt-1 text-xs leading-5 text-rose-100/75">{evaluation.evidenceDisposition!.reason} This is an evidence-quality outcome, not an assessment of observed interview performance.</p></div>
      </div>
    </div> : null}
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-western-200">Advisory recap</span>
        <span className="text-[0.65rem] font-bold text-slate-500">{analysis.rubricVersion} · {percent(evaluation.confidence.overall)} confidence</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-200">{evaluation.recap}</p>
    </div>

    <RoleAttributionCard evaluation={evaluation} />

    <div className="grid gap-3 md:grid-cols-3">
      <AiDecisionCard label="Completion" value={labelize(evaluation.sessionCompletion.recommendation)} detail="Independent of whether the problem was solved" tone={evaluation.sessionCompletion.recommendation === 'completed' ? 'emerald' : 'amber'} />
      <AiDecisionCard label="Candidate readiness" value={unusableRecording ? 'Not assessed' : labelize(evaluation.candidate.readiness)} detail={unusableRecording ? '0/100 administrative score · performance not observed' : evaluation.candidate.score == null ? 'Insufficient scored evidence' : `${Math.round(evaluation.candidate.score)}/100 calculated score${evaluation.candidate.requiresManualReview && evaluation.candidate.scoreBand ? ` · ${labelize(evaluation.candidate.scoreBand)} band` : ''}`} tone="western" />
      <AiDecisionCard label="Interviewer quality" value={labelize(evaluation.interviewer.recommendation)} detail={evaluation.interviewer.score == null ? 'Insufficient scored evidence' : `${Math.round(evaluation.interviewer.score)}/100 calculated score${evaluation.interviewer.requiresOrganizerReview ? ' · Organizer review required' : ''}`} tone="sky" />
    </div>

    {evaluation.phaseTimeline?.length ? <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h4 className="text-sm font-black">Session timeline</h4>
      <p className="mt-1 text-xs leading-5 text-slate-400">Whole-session pacing evidence used for completion and time-management judgments.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {evaluation.phaseTimeline.map((phase, index) => <button key={`${phase.phase}-${phase.startSeconds}-${index}`} type="button" onClick={() => onSeek(phase.startSeconds)} className="cursor-pointer rounded-xl border border-white/10 bg-slate-950/60 p-3 text-left transition hover:border-western-300/40 hover:bg-western-400/10">
          <span className="text-[0.65rem] font-black uppercase tracking-[0.12em] text-western-200">{labelize(phase.phase)} · {formatVideoTime(phase.startSeconds)}–{formatVideoTime(phase.endSeconds)}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-300">{phase.summary}</span>
        </button>)}
      </div>
    </section> : null}

    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h4 className="text-sm font-black">Key moments</h4>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {evaluation.keyMoments.map((moment, index) => <button key={`${moment.startSeconds}-${index}`} type="button" onClick={() => onSeek(moment.startSeconds)} className="group cursor-pointer rounded-xl border border-white/10 bg-slate-950/60 p-3 text-left transition hover:border-western-300/40 hover:bg-western-400/10">
          <span className="inline-flex items-center gap-1.5 text-[0.68rem] font-black text-western-200"><Play className="size-3 fill-current" />{formatVideoTime(moment.startSeconds)}</span>
          <span className="mt-1 block text-xs font-black text-slate-100">{moment.title}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-400">{moment.note}</span>
        </button>)}
      </div>
    </section>

    <div className="grid gap-3 xl:grid-cols-2">
      <DimensionSection title="Candidate evidence" dimensions={evaluation.candidate.dimensions} onSeek={onSeek} />
      <DimensionSection title="Interviewer evidence" dimensions={evaluation.interviewer.dimensions} onSeek={onSeek} />
    </div>

    {evaluation.hints.length ? <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h4 className="text-sm font-black">Hint timeline</h4>
      <div className="mt-3 space-y-2">
        {evaluation.hints.map((hint, index) => <button key={`${hint.startSeconds}-${index}`} type="button" onClick={() => onSeek(hint.startSeconds)} className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-left transition hover:border-western-300/40">
          <span className="mt-0.5 shrink-0 rounded-md bg-western-400/15 px-2 py-1 text-[0.65rem] font-black text-western-200">L{hint.level}</span>
          <span className="min-w-0"><span className="block text-xs font-bold text-slate-200">{formatVideoTime(hint.startSeconds)} · “{hint.excerpt}”</span><span className="mt-1 block text-xs leading-5 text-slate-400">{hint.outcome}</span></span>
        </button>)}
      </div>
    </section> : null}

    {analysis.transcript ? <RoleLabeledTranscript analysis={analysis} onSeek={onSeek} /> : null}

    {evaluation.contradictions.length || evaluation.organizerChecks.length || evaluation.interviewer.criticalFlags.length ? <section className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4">
      <h4 className="flex items-center gap-2 text-sm font-black text-amber-100"><AlertTriangle className="size-4" /> Organizer checks</h4>
      <ul className="mt-3 space-y-2 text-xs leading-5 text-amber-100/80">
        {evaluation.candidate.manualReviewReasons?.map((item) => <li key={`manual-${item}`}>• {item}</li>)}
        {evaluation.interviewer.criticalFlags.map((item, index) => <li key={`flag-${typeof item === 'string' ? item : `${item.code}-${index}`}`}>• {typeof item === 'string' ? item : item.summary}</li>)}
        {evaluation.contradictions.map((item) => <li key={`conflict-${item.summary}`}>• {item.summary}</li>)}
        {evaluation.organizerChecks.map((item) => <li key={`check-${item}`}>• {item}</li>)}
      </ul>
    </section> : null}

    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[0.68rem] font-semibold text-slate-500">
      <span>Transcript {percent(evaluation.confidence.transcript)}</span>
      <span>Speaker attribution {percent(evaluation.confidence.speakerAttribution)}</span>
      {analysis.evaluatorModel ? <span>Evaluator {analysis.evaluatorModel}</span> : null}
      {analysis.evaluatedAt ? <span>Generated {formatDate(analysis.evaluatedAt)}</span> : null}
      <span>AI output requires organizer confirmation</span>
    </div>
  </div>;
}

function RoleAttributionCard({ evaluation }: { evaluation: ReviewAiEvaluation }) {
  const attribution = evaluation.roleAttribution;
  if (!attribution) return <section className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4">
    <h4 className="text-sm font-black text-amber-100">Participant roles not resolved</h4>
    <p className="mt-1 text-xs leading-5 text-amber-100/75">This legacy review does not contain explicit speaker-to-role attribution. Do not rely on role-specific claims without checking the recording.</p>
  </section>;
  return <section className="rounded-xl border border-white/10 bg-white/5 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h4 className="text-sm font-black">Who is who</h4><p className="mt-1 text-xs leading-5 text-slate-400">Resolved before candidate or interviewer scoring.</p></div>
      <span className={`rounded-full px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-[0.12em] ${attribution.resolution === 'confirmed' ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>{labelize(attribution.resolution)}</span>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-sky-300/20 bg-sky-400/10 p-3"><div className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-sky-200">Interviewer</div><div className="mt-1 text-sm font-black text-slate-100">{attribution.interviewer.name}</div></div>
      <div className="rounded-xl border border-western-300/20 bg-western-400/10 p-3"><div className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-western-200">Interviewee · candidate</div><div className="mt-1 text-sm font-black text-slate-100">{attribution.interviewee.name}</div></div>
    </div>
    <p className="mt-3 text-xs leading-5 text-slate-400">{attribution.rationale}</p>
  </section>;
}

function RoleLabeledTranscript({ analysis, onSeek }: { analysis: ReviewAnalysis; onSeek: (seconds: number) => void }) {
  const transcript = analysis.transcript!;
  return <section className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
    <Accordion type="single" collapsible>
      <AccordionItem value="transcript" className="border-0 px-4">
        <AccordionTrigger className="py-4 text-slate-100 hover:no-underline">
          <span className="text-left"><span className="block text-sm font-black">Role-labeled transcript</span><span className="mt-0.5 block text-xs font-normal text-slate-400">{transcript.segments.length} timestamped segments · click a line to seek</span></span>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/60 p-2">
            {transcript.segments.map((segment, index) => {
              const role = segment.role;
              const roleLabel = role === 'interviewee' ? 'Interviewee' : role === 'interviewer' ? 'Interviewer' : 'Unknown';
              const tone = role === 'interviewee' ? 'bg-western-400/15 text-western-200' : role === 'interviewer' ? 'bg-sky-400/15 text-sky-200' : 'bg-slate-700 text-slate-300';
              return <button key={`${segment.start}-${index}`} type="button" onClick={() => onSeek(segment.start)} className="grid w-full cursor-pointer grid-cols-[5rem_6.75rem_minmax(0,1fr)] items-start gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-white/5">
                <span className="pt-0.5 text-[0.68rem] font-bold tabular-nums text-slate-500">{formatVideoTime(segment.start)}</span>
                <span className={`rounded-md px-2 py-1 text-center text-[0.62rem] font-black uppercase tracking-wide ${tone}`}>{roleLabel}</span>
                <span className="text-xs leading-5 text-slate-300">{segment.text}</span>
              </button>;
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </section>;
}

function AiDecisionCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'emerald' | 'amber' | 'western' | 'sky' }) {
  const toneClass = tone === 'emerald' ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-200'
    : tone === 'amber' ? 'border-amber-300/20 bg-amber-400/10 text-amber-200'
      : tone === 'sky' ? 'border-sky-300/20 bg-sky-400/10 text-sky-200'
        : 'border-western-300/20 bg-western-400/10 text-western-200';
  return <div className={`rounded-xl border p-3 ${toneClass}`}><div className="text-[0.62rem] font-black uppercase tracking-[0.14em] opacity-70">{label}</div><div className="mt-1 text-sm font-black">{value}</div><div className="mt-1 text-[0.68rem] leading-4 opacity-70">{detail}</div></div>;
}

function DimensionSection({ title, dimensions, onSeek }: { title: string; dimensions: Record<string, ReviewAiDimension>; onSeek: (seconds: number) => void }) {
  return <section className="rounded-xl border border-white/10 bg-white/5 p-4">
    <h4 className="text-sm font-black">{title}</h4>
    <div className="mt-3 space-y-2">
      {Object.entries(dimensions).map(([key, dimension]) => <div key={key} className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-200">{labelize(key)}</span><span className="text-xs font-black text-western-200">{dimension.rating == null ? 'Not observed' : `${dimension.rating}/4`}</span></div>
        {dimension.evidence.length ? <div className="mt-2 flex flex-wrap gap-1.5">{dimension.evidence.slice(0, 3).map((item, index) => <EvidenceButton key={`${item.startSeconds}-${index}`} evidence={item} onSeek={onSeek} />)}</div> : null}
      </div>)}
    </div>
  </section>;
}

function EvidenceButton({ evidence, onSeek }: { evidence: ReviewEvidence; onSeek: (seconds: number) => void }) {
  const timestamp = evidence.endSeconds > evidence.startSeconds
    ? `${formatVideoTime(evidence.startSeconds)}–${formatVideoTime(evidence.endSeconds)}`
    : formatVideoTime(evidence.startSeconds);
  return <button type="button" title={evidence.note} onClick={() => onSeek(evidence.startSeconds)} className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[0.65rem] font-bold text-slate-400 transition hover:bg-western-400/15 hover:text-western-200"><Clock3 className="size-3" />{timestamp}<span className="text-[0.58rem] uppercase tracking-wide text-slate-500">{evidence.scope}</span></button>;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function labelize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function SubmittedReports({ reports }: { reports: ReviewReport[] }) {
  return <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
    <div className="border-b border-white/10 px-4 py-3"><h3 className="text-sm font-black">Submitted reports</h3><p className="mt-0.5 text-xs text-slate-400">Use both perspectives as context; the recording remains the primary evidence.</p></div>
    <Accordion type="multiple" defaultValue={reports.filter((report) => report.submittedAt).map((report) => report.kind)}>
      {reports.map((report) => <AccordionItem key={report.id} value={report.kind} className="border-white/10 px-4">
        <AccordionTrigger className="text-slate-100 hover:no-underline"><span><span className="font-bold">{report.kind === 'interviewer_report' ? 'Interviewer report' : 'Interviewee report'}</span><span className="ml-2 text-xs font-normal text-slate-400">{report.submittedAt ? `Submitted ${formatDate(report.submittedAt)}` : 'Not submitted'}</span></span></AccordionTrigger>
        <AccordionContent className="space-y-3">
          {report.submittedAt ? report.answers.filter((answer) => answer.id !== 'video_url').map((answer) => <ReportAnswer key={answer.id} answer={answer} />) : <p className="pb-2 text-sm text-rose-300">This report has not been submitted.</p>}
        </AccordionContent>
      </AccordionItem>)}
    </Accordion>
  </div>;
}

function ReportAnswer({ answer }: { answer: ReviewReport['answers'][number] }) {
  const long = answer.type === 'textarea' || answer.id === 'code' || answer.value.length > 160;
  return <div className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
    <div className="text-xs font-bold text-slate-400">{answer.label}</div>
    {long ? <pre className={`mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-100 ${answer.id === 'code' ? 'font-mono' : 'font-sans'}`}>{answer.value}</pre> : <div className="mt-1 text-sm font-semibold text-slate-100">{answer.value}</div>}
  </div>;
}

function RubricForm({ value, onChange }: { value: RubricDraft; onChange: (value: RubricDraft) => void }) {
  const update = <K extends keyof RubricDraft>(key: K, next: RubricDraft[K]) => onChange({ ...value, [key]: next });
  return <div>
    <div><div className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-western-700">Organizer rubric</div><h2 className="mt-2 text-2xl font-black tracking-tight text-foreground">Assess the recording</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Rate what the video demonstrates. Save a draft at any point; completing the review requires every category.</p></div>
    <div className="mt-6 space-y-5">
      <RatingField label="Session completion" description="How much of a genuine technical interview was completed?" value={value.completionRating} onChange={(rating) => update('completionRating', rating)} labels={['Not completed', 'Partial', 'Mostly complete', 'Complete']} />
      <RatingField label="Communication" description="Clarity of thought process, questions, and explanations." value={value.communicationRating} onChange={(rating) => update('communicationRating', rating)} />
      <RatingField label="Problem solving" description="Progress from understanding through a defensible approach." value={value.problemSolvingRating} onChange={(rating) => update('problemSolvingRating', rating)} />
      <RatingField label="Implementation" description="Quality and completeness of the code attempted in-session." value={value.implementationRating} onChange={(rating) => update('implementationRating', rating)} />
      <RatingField label="Testing and complexity" description="Attention to examples, edge cases, and runtime trade-offs." value={value.testingRating} onChange={(rating) => update('testingRating', rating)} />
      <RatingField label="Recording quality" description="Whether the recording provides enough clear evidence to assess." value={value.recordingQuality} onChange={(rating) => update('recordingQuality', rating)} labels={['Unusable', 'Limited', 'Usable', 'Clear']} />
      <label className="block rounded-2xl border border-border bg-card p-4"><span className="text-sm font-black text-foreground">Internal review notes</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Required when marking a review for follow-up. Participants cannot see this.</span><Textarea value={value.notes} maxLength={4000} onChange={(event) => update('notes', event.target.value)} className="mt-3 min-h-32 resize-y rounded-xl" placeholder="Capture evidence, follow-up questions, or the reason for your decision…" /><span className="mt-1 block text-right text-xs tabular-nums text-muted-foreground">{value.notes.length}/4000</span></label>
    </div>
  </div>;
}

function RatingField({ label, description, value, onChange, labels = ['Insufficient', 'Developing', 'Meets', 'Strong'] }: { label: string; description: string; value: number | null; onChange: (value: number) => void; labels?: string[] }) {
  return <fieldset className="rounded-2xl border border-border bg-card p-4">
    <legend className="sr-only">{label}</legend>
    <div className="text-sm font-black text-foreground">{label}</div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    <RadioGroup value={value ? String(value) : ''} onValueChange={(next) => onChange(Number(next))} className="mt-4 grid grid-cols-2 gap-2">
      {labels.map((option, index) => {
        const rating = index + 1;
        return <label key={option} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${value === rating ? 'border-western-500 bg-western-50 text-western-900 dark:bg-western-950/40 dark:text-western-200' : 'border-border bg-background text-muted-foreground hover:border-western-300 hover:text-foreground'}`}>
          <RadioGroupItem value={String(rating)} />{option}
        </label>;
      })}
    </RadioGroup>
  </fieldset>;
}

function rubricFromDetail(detail: ReviewDetail): RubricDraft {
  const rubric = detail.rubric;
  return rubric ? {
    completionRating: rubric.completion_rating,
    communicationRating: rubric.communication_rating,
    problemSolvingRating: rubric.problem_solving_rating,
    implementationRating: rubric.implementation_rating,
    testingRating: rubric.testing_rating,
    recordingQuality: rubric.recording_quality,
    notes: rubric.notes,
  } : emptyRubric;
}

function rubricComplete(value: RubricDraft) {
  return [value.completionRating, value.communicationRating, value.problemSolvingRating, value.implementationRating, value.testingRating, value.recordingQuality]
    .every((rating) => rating !== null);
}
