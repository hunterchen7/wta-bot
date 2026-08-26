# WTA review analysis worker

This private Olares service polls the WTA Worker for leased recording-analysis jobs. It downloads each recording through the authenticated WTA API, extracts audio, runs `faster-whisper` `large-v3` on the local GPU, assigns stable speaker labels, and returns transcript JSON plus WebVTT captions. It never receives R2 credentials and it does not expose an inbound public endpoint.

Speaker attribution uses Pyannote Community-1 when `HF_TOKEN` is configured and its model terms have been accepted. Otherwise it falls back to two-speaker ECAPA embedding clustering. The evaluator treats either result as uncertain evidence and exposes its confidence to organizers.

## Required host secret

Create `/etc/wta-review-analysis.env` with mode `0600`:

```dotenv
WTA_BASE_URL=https://wta.hunterchen.ca
WTA_ANALYSIS_WORKER_SECRET=replace-me
# Optional, higher-quality diarization after accepting the model terms:
# HF_TOKEN=hf_...
```

## Deploy

```bash
docker compose build
docker compose up -d
docker compose logs -f worker
```

The compose service uses NVIDIA CDI (`nvidia.com/gpu=all`), persists model caches in a named volume, and keeps per-job media only in a temporary in-memory filesystem.
