export type VideoAnalysis = {
  width: number; height: number; duration: number; bitrate: number; codec: string | null;
  targetBitrate: number; shouldOptimize: boolean;
};

export type OptimizedVideo = { file: File; cleanup: () => Promise<void> };
type WebVideoCodec = 'av1' | 'vp9' | 'avc';
type EncodingPlan = { codec: WebVideoCodec; audioCodec: 'opus' | 'aac'; extension: '.webm' | '.mp4'; mimeType: 'video/webm' | 'video/mp4'; contentType: string };

export async function analyzeVideo(file: File): Promise<VideoAnalysis> {
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!await input.canRead()) throw new Error('This video format cannot be read in this browser.');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('The selected file does not contain a video track.');
    const [width, height, codec, duration, stats] = await Promise.all([
      track.getDisplayWidth(), track.getDisplayHeight(), track.getCodec(), input.computeDuration(), track.computePacketStats(120),
    ]);
    const sourceCodec: WebVideoCodec = codec === 'av1' || codec === 'vp9' ? codec : 'avc';
    const targetBitrate = bitrateForHeight(Math.min(height, 1080), sourceCodec);
    const bitrate = stats.averageBitrate || file.size * 8 / Math.max(duration, 1);
    const webReady = (codec === 'av1' || codec === 'vp9') ? file.type === 'video/webm' : codec === 'avc' && file.type === 'video/mp4';
    const needsCompatibility = !webReady;
    const oversized = width > 1920 || height > 1080;
    const excessiveBitrate = bitrate > targetBitrate * 1.35;
    const shouldOptimize = needsCompatibility || oversized || excessiveBitrate;
    return { width, height, codec, duration, bitrate, targetBitrate, shouldOptimize };
  } finally {
    input.dispose();
  }
}

export async function optimizeVideo(file: File, analysis: VideoAnalysis, onProgress: (progress: number) => void, signal: AbortSignal): Promise<OptimizedVideo> {
  if (!navigator.storage?.getDirectory) throw new Error('Local video optimization is unavailable in this browser. You can upload the original instead.');
  const { ALL_FORMATS, BlobSource, Conversion, Input, Mp4OutputFormat, NullTarget, Output, StreamTarget, WebMOutputFormat, canEncodeAudio, canEncodeVideo } = await import('mediabunny');
  const optimizationStarted = performance.now();
  const targetHeight = Math.min(analysis.height, 1080);
  const targetWidth = even(Math.round(analysis.width * targetHeight / analysis.height));
  const plan = await selectEncodingPlan(targetWidth, targetHeight, canEncodeVideo, canEncodeAudio);
  const targetVideoBitrate = bitrateForHeight(targetHeight, plan.codec);
  const targetAudioBitrate = plan.audioCodec === 'opus' ? 96_000 : 128_000;
  const estimatedBytes = analysis.duration * (targetVideoBitrate + targetAudioBitrate) / 8;
  if (estimatedBytes >= file.size * 0.9) throw new Error('Re-encoding is unlikely to meaningfully reduce this file.');

  const benchmarkResponse = await fetch('/encoding-benchmark.mp4', { signal });
  if (!benchmarkResponse.ok) throw new Error('The local encoder benchmark is unavailable.');
  const benchmarkInput = new Input({ source: new BlobSource(await benchmarkResponse.blob()), formats: ALL_FORMATS });
  const benchmarkOutput = new Output({
    format: plan.mimeType === 'video/webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false }),
    target: new NullTarget(),
  });
  let benchmark: import('mediabunny').Conversion | null = null;
  let benchmarkTimedOut = false;
  const cancelBenchmark = () => { if (benchmark) void benchmark.cancel(); };
  signal.addEventListener('abort', cancelBenchmark, { once: true });
  const benchmarkStarted = performance.now();
  const benchmarkTimeout = window.setTimeout(() => { benchmarkTimedOut = true; if (benchmark) void benchmark.cancel(); }, BENCHMARK_WALL_LIMIT_MS);
  try {
    benchmark = await Conversion.init({
      input: benchmarkInput, output: benchmarkOutput, tracks: 'primary',
      video: {
        codec: plan.codec, height: targetHeight, bitrate: targetVideoBitrate, frameRate: 30,
        hardwareAcceleration: 'prefer-hardware', keyFrameInterval: 5, forceTranscode: true,
      },
      audio: { discard: true },
    });
    if (!benchmark.isValid) throw new Error('The selected browser encoder cannot process this recording.');
    benchmark.onProgress = (progress) => onProgress(progress * BENCHMARK_PROGRESS_SHARE);
    await benchmark.execute();
  } catch (error) {
    if (benchmarkTimedOut) throw new Error('The browser encoder is too slow for local optimization.');
    throw error;
  } finally {
    window.clearTimeout(benchmarkTimeout);
    signal.removeEventListener('abort', cancelBenchmark);
    benchmarkInput.dispose();
  }
  if (signal.aborted) throw new DOMException('Optimization canceled.', 'AbortError');
  const benchmarkElapsed = performance.now() - benchmarkStarted;
  const projectedEncodingMs = benchmarkElapsed / BENCHMARK_CLIP_SECONDS * analysis.duration * BENCHMARK_SAFETY_FACTOR;
  if (performance.now() - optimizationStarted + projectedEncodingMs > MAX_PROJECTED_OPTIMIZATION_MS) {
    throw new Error('The full recording would take too long to optimize on this device.');
  }

  const directory = await navigator.storage.getDirectory();
  const filename = `wta-optimized-${crypto.randomUUID()}${plan.extension}`;
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new StreamTarget(writable as unknown as WritableStream<import('mediabunny').StreamTargetChunk>, { chunked: true, chunkSize: 8 * 1024 * 1024 });
  const output = new Output({ format: plan.mimeType === 'video/webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: false }), target });
  let conversion: import('mediabunny').Conversion | null = null;
  let budgetExceeded = false;
  const cancel = () => { if (conversion) void conversion.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    conversion = await Conversion.init({
      input, output, tracks: 'primary',
      video: async (track) => {
        const height = Math.min(await track.getDisplayHeight(), 1080);
        const stats = await track.computePacketStats(120);
        return {
          codec: plan.codec, height, bitrate: bitrateForHeight(height, plan.codec),
          frameRate: Math.min(Math.max(stats.averagePacketRate || 30, 12), 30),
          hardwareAcceleration: 'prefer-hardware', keyFrameInterval: 5, forceTranscode: true,
        };
      },
      audio: { codec: plan.audioCodec, bitrate: plan.audioCodec === 'opus' ? 96_000 : 128_000, numberOfChannels: 2, sampleRate: 48_000, forceTranscode: true },
    });
    if (!conversion.isValid) throw new Error('This browser cannot encode the selected video. Upload the original instead.');
    conversion.onProgress = (progress) => onProgress(Math.min(BENCHMARK_PROGRESS_SHARE + progress * (1 - BENCHMARK_PROGRESS_SHARE), 0.995));
    const remainingBudget = Math.max(1, HARD_OPTIMIZATION_LIMIT_MS - (performance.now() - optimizationStarted));
    const budgetTimeout = window.setTimeout(() => { budgetExceeded = true; void conversion?.cancel(); }, remainingBudget);
    try {
      await conversion.execute();
    } finally {
      window.clearTimeout(budgetTimeout);
    }
    if (budgetExceeded) throw new Error('Local optimization exceeded its five-minute limit.');
    if (signal.aborted) throw new DOMException('Optimization canceled.', 'AbortError');
    onProgress(1);
    const optimized = await handle.getFile();
    return {
      file: new File([optimized], replaceExtension(file.name, plan.extension), { type: plan.mimeType, lastModified: Date.now() }),
      cleanup: () => directory.removeEntry(filename).catch(() => {}),
    };
  } catch (error) {
    await writable.abort().catch(() => {});
    await directory.removeEntry(filename).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    input.dispose();
  }
}

const MAX_PROJECTED_OPTIMIZATION_MS = 180_000;
const HARD_OPTIMIZATION_LIMIT_MS = 300_000;
const BENCHMARK_CLIP_SECONDS = 3;
const BENCHMARK_WALL_LIMIT_MS = 8_000;
const BENCHMARK_SAFETY_FACTOR = 1.25;
const BENCHMARK_PROGRESS_SHARE = 0.1;

async function selectEncodingPlan(
  width: number,
  height: number,
  canEncodeVideo: typeof import('mediabunny').canEncodeVideo,
  canEncodeAudio: typeof import('mediabunny').canEncodeAudio,
): Promise<EncodingPlan> {
  const candidates: EncodingPlan[] = [
    { codec: 'av1', audioCodec: 'opus', extension: '.webm', mimeType: 'video/webm', contentType: 'video/webm;codecs=av01.0.08M.08' },
    { codec: 'vp9', audioCodec: 'opus', extension: '.webm', mimeType: 'video/webm', contentType: 'video/webm;codecs=vp09.00.40.08' },
    { codec: 'avc', audioCodec: 'aac', extension: '.mp4', mimeType: 'video/mp4', contentType: 'video/mp4;codecs=avc1.640028' },
  ];
  for (const candidate of candidates) {
    const [videoSupported, audioSupported] = await Promise.all([
      canEncodeVideo(candidate.codec, { width, height, bitrate: bitrateForHeight(height, candidate.codec), hardwareAcceleration: 'prefer-hardware' }).catch(() => false),
      canEncodeAudio(candidate.audioCodec, { bitrate: candidate.audioCodec === 'opus' ? 96_000 : 128_000 }).catch(() => false),
    ]);
    if (!videoSupported || !audioSupported) continue;
    if (candidate.codec === 'avc' || await isPowerEfficient(candidate, width, height)) return candidate;
  }
  throw new Error('No efficient browser video encoder is available.');
}

async function isPowerEfficient(plan: EncodingPlan, width: number, height: number) {
  if (!navigator.mediaCapabilities?.encodingInfo) return false;
  try {
    const result = await navigator.mediaCapabilities.encodingInfo({
      type: 'record',
      video: { contentType: plan.contentType, width, height, bitrate: bitrateForHeight(height, plan.codec), framerate: 30 },
    });
    return result.supported && result.smooth && result.powerEfficient;
  } catch { return false; }
}

const bitrateForHeight = (height: number, codec: WebVideoCodec) => {
  const avc = height > 720 ? 4_200_000 : height > 480 ? 2_600_000 : 1_400_000;
  return Math.round(avc * (codec === 'av1' ? 0.65 : codec === 'vp9' ? 0.78 : 1));
};
const even = (value: number) => Math.max(2, value - value % 2);
const replaceExtension = (name: string, extension: string) => `${name.replace(/\.[^.]+$/, '') || 'recording'}${extension}`;
