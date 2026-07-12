export type VideoAnalysis = {
  width: number; height: number; duration: number; bitrate: number; codec: string | null;
  targetBitrate: number; estimatedBytes: number; shouldOptimize: boolean; lowPowerDevice: boolean; reason: string;
};

export type OptimizedVideo = { file: File; cleanup: () => Promise<void> };

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
    const targetBitrate = bitrateForHeight(Math.min(height, 1080));
    const bitrate = stats.averageBitrate || file.size * 8 / Math.max(duration, 1);
    const needsCompatibility = codec !== 'avc' || file.type !== 'video/mp4';
    const oversized = width > 1920 || height > 1080;
    const excessiveBitrate = bitrate > targetBitrate * 1.35;
    const lowPowerDevice = deviceIsConstrained();
    const shouldOptimize = needsCompatibility || oversized || excessiveBitrate;
    const reason = needsCompatibility
      ? 'Convert to a broadly playable MP4.'
      : oversized
        ? 'Keep a sharp 1080p copy while reducing the upload size.'
        : excessiveBitrate
          ? 'The source bitrate is higher than needed for readable 1080p interview footage.'
          : 'This file is already efficient; re-encoding would spend device time for little benefit.';
    return {
      width, height, codec, duration, bitrate, targetBitrate,
      estimatedBytes: duration * (targetBitrate + 128_000) / 8,
      shouldOptimize, lowPowerDevice, reason,
    };
  } finally {
    input.dispose();
  }
}

export async function optimizeVideo(file: File, analysis: VideoAnalysis, onProgress: (progress: number) => void, signal: AbortSignal): Promise<OptimizedVideo> {
  if (!navigator.storage?.getDirectory) throw new Error('Local video optimization is unavailable in this browser. You can upload the original instead.');
  const { ALL_FORMATS, BlobSource, Conversion, Input, Mp4OutputFormat, Output, StreamTarget } = await import('mediabunny');
  const directory = await navigator.storage.getDirectory();
  const filename = `wta-optimized-${crypto.randomUUID()}.mp4`;
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new StreamTarget(writable as unknown as WritableStream<import('mediabunny').StreamTargetChunk>, { chunked: true, chunkSize: 8 * 1024 * 1024 });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  let conversion: import('mediabunny').Conversion | null = null;
  const cancel = () => { if (conversion) void conversion.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    conversion = await Conversion.init({
      input, output, tracks: 'primary',
      video: async (track) => {
        const height = Math.min(await track.getDisplayHeight(), 1080);
        const stats = await track.computePacketStats(120);
        return {
          codec: 'avc', height, bitrate: bitrateForHeight(height),
          frameRate: Math.min(Math.max(stats.averagePacketRate || 30, 12), 30),
          hardwareAcceleration: 'prefer-hardware', keyFrameInterval: 5, forceTranscode: true,
        };
      },
      audio: { codec: 'aac', bitrate: 128_000, numberOfChannels: 2, sampleRate: 48_000, forceTranscode: true },
    });
    if (!conversion.isValid) throw new Error('This browser cannot encode the selected video. Upload the original instead.');
    conversion.onProgress = (progress) => onProgress(Math.min(progress, 0.995));
    await conversion.execute();
    if (signal.aborted) throw new DOMException('Optimization canceled.', 'AbortError');
    onProgress(1);
    const optimized = await handle.getFile();
    return {
      file: new File([optimized], replaceExtension(file.name, '.mp4'), { type: 'video/mp4', lastModified: Date.now() }),
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

const bitrateForHeight = (height: number) => height > 720 ? 3_500_000 : height > 480 ? 2_200_000 : 1_200_000;
const replaceExtension = (name: string, extension: string) => `${name.replace(/\.[^.]+$/, '') || 'recording'}${extension}`;
function deviceIsConstrained() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return navigator.hardwareConcurrency <= 4 || (memory !== undefined && memory <= 4);
}
