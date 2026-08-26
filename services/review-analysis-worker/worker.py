#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import requests

TRANSCRIPT_VERSION = "wta-transcript-v1"
LOGGER = logging.getLogger("wta-review-analysis")


@dataclass(frozen=True)
class Settings:
    base_url: str
    secret: str
    worker_id: str
    model_name: str
    compute_type: str
    poll_seconds: float

    @classmethod
    def from_env(cls) -> "Settings":
        base_url = os.environ.get("WTA_BASE_URL", "https://wta.hunterchen.ca").rstrip("/")
        secret = os.environ.get("WTA_ANALYSIS_WORKER_SECRET", "").strip()
        if not secret:
            raise RuntimeError("WTA_ANALYSIS_WORKER_SECRET is required")
        return cls(
            base_url=base_url,
            secret=secret,
            worker_id=os.environ.get("WTA_WORKER_ID", "olares-gpu-01").strip() or "olares-gpu-01",
            model_name=os.environ.get("WTA_MODEL", "large-v3").strip() or "large-v3",
            compute_type=os.environ.get("WTA_COMPUTE_TYPE", "float16").strip() or "float16",
            poll_seconds=max(2.0, float(os.environ.get("WTA_POLL_SECONDS", "10"))),
        )


class WtaClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {settings.secret}"})

    def claim(self) -> dict[str, Any] | None:
        response = self.session.post(
            f"{self.settings.base_url}/api/analysis/worker/claim",
            json={"workerId": self.settings.worker_id},
            timeout=30,
        )
        if response.status_code == 204:
            return None
        response.raise_for_status()
        return response.json()["job"]

    def download(self, job_id: int, destination: Path) -> None:
        with self.session.get(
            f"{self.settings.base_url}/api/analysis/worker/jobs/{job_id}/media",
            headers={"X-WTA-Worker-Id": self.settings.worker_id},
            stream=True,
            timeout=(30, 300),
        ) as response:
            response.raise_for_status()
            with destination.open("wb") as output:
                for chunk in response.iter_content(chunk_size=4 * 1024 * 1024):
                    if chunk:
                        output.write(chunk)

    def submit_transcript(self, job_id: int, result: dict[str, Any]) -> None:
        response = self.session.post(
            f"{self.settings.base_url}/api/analysis/worker/jobs/{job_id}/transcript",
            headers={"X-WTA-Worker-Id": self.settings.worker_id},
            json=result,
            timeout=120,
        )
        response.raise_for_status()

    def evaluate(self, job_id: int) -> str:
        response = self.session.post(
            f"{self.settings.base_url}/api/analysis/worker/jobs/{job_id}/evaluate",
            timeout=300,
        )
        response.raise_for_status()
        return str(response.json()["status"])

    def fail(self, job_id: int, error: str, retryable: bool = True) -> None:
        response = self.session.post(
            f"{self.settings.base_url}/api/analysis/worker/jobs/{job_id}/fail",
            headers={"X-WTA-Worker-Id": self.settings.worker_id},
            json={"error": error[:1800], "retryable": retryable},
            timeout=30,
        )
        response.raise_for_status()


class Transcriber:
    def __init__(self, settings: Settings) -> None:
        from faster_whisper import WhisperModel

        LOGGER.info("loading transcription model %s", settings.model_name)
        self.model_name = settings.model_name
        self.model = WhisperModel(settings.model_name, device="cuda", compute_type=settings.compute_type)
        self.speaker_model: Any | None = None

    def run(self, media_path: Path, work_dir: Path) -> dict[str, Any]:
        audio_path = work_dir / "audio.wav"
        extract_audio(media_path, audio_path)
        duration = media_duration(audio_path)
        LOGGER.info("transcribing %.1f seconds", duration)
        raw_segments, info = self.model.transcribe(
            str(audio_path),
            language="en",
            beam_size=5,
            best_of=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=True,
            initial_prompt=(
                "Technical mock interview. Common terms include Dijkstra, breadth-first search, depth-first search, "
                "dynamic programming, complexity, adjacency list, heap, queue, array, graph, and LeetCode."
            ),
        )
        segments = [
            {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "speaker": "SPEAKER_UNKNOWN",
                "text": segment.text.strip(),
                "confidence": round(log_probability_confidence(segment.avg_logprob), 4),
            }
            for segment in raw_segments
            if segment.text.strip() and segment.end > segment.start
        ]
        if not segments:
            raise RuntimeError("The recording did not contain transcribable speech")

        speaker_confidence, diarization_model = self._assign_speakers(audio_path, segments)
        transcript_confidence = weighted_confidence(segments)
        return {
            "version": TRANSCRIPT_VERSION,
            "language": info.language or "en",
            "durationSeconds": round(duration, 3),
            "transcriptConfidence": round(transcript_confidence, 4),
            "speakerConfidence": round(speaker_confidence, 4),
            "transcriptionModel": f"faster-whisper/{self.model_name}",
            "diarizationModel": diarization_model,
            "segments": segments,
            "vtt": build_vtt(segments),
        }

    def _assign_speakers(self, audio_path: Path, segments: list[dict[str, Any]]) -> tuple[float, str]:
        hf_token = os.environ.get("HF_TOKEN", "").strip()
        if hf_token:
            try:
                return assign_with_pyannote(audio_path, segments, hf_token), "pyannote/speaker-diarization-community-1"
            except Exception:
                LOGGER.exception("pyannote diarization failed; falling back to ECAPA clustering")
        try:
            if self.speaker_model is None:
                from speechbrain.inference.speaker import SpeakerRecognition

                self.speaker_model = SpeakerRecognition.from_hparams(
                    source="speechbrain/spkrec-ecapa-voxceleb",
                    savedir="/models/speechbrain/spkrec-ecapa-voxceleb",
                    run_opts={"device": "cuda"},
                )
            return assign_with_ecapa(audio_path, segments, self.speaker_model), "speechbrain/ecapa-voxceleb-clustering"
        except Exception:
            LOGGER.exception("speaker clustering failed; retaining unknown speakers")
            return 0.0, "unavailable"


def extract_audio(media_path: Path, audio_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(media_path),
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio_path),
        ],
        check=True,
        timeout=60 * 30,
    )


def media_duration(audio_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(audio_path)],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    duration = float(result.stdout.strip())
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Could not determine recording duration")
    return duration


def assign_with_pyannote(audio_path: Path, segments: list[dict[str, Any]], token: str) -> float:
    import torch
    from pyannote.audio import Pipeline

    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token=token)
    pipeline.to(torch.device("cuda"))
    output = pipeline(str(audio_path), num_speakers=2)
    annotation = getattr(output, "speaker_diarization", output)
    turns = [(float(turn.start), float(turn.end), str(speaker)) for turn, _, speaker in annotation.itertracks(yield_label=True)]
    if not turns:
        return 0.0
    canonical = {speaker: f"SPEAKER_{index:02d}" for index, speaker in enumerate(sorted({turn[2] for turn in turns}))}
    assigned = 0
    for segment in segments:
        overlaps = [(max(0.0, min(segment["end"], end) - max(segment["start"], start)), speaker) for start, end, speaker in turns]
        overlap, speaker = max(overlaps, default=(0.0, ""))
        if overlap > 0:
            segment["speaker"] = canonical[speaker]
            assigned += 1
    return assigned / len(segments)


def assign_with_ecapa(audio_path: Path, segments: list[dict[str, Any]], speaker_model: Any) -> float:
    import torch
    import torchaudio
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.metrics import silhouette_score

    waveform, sample_rate = torchaudio.load(str(audio_path))
    waveform = waveform.mean(dim=0, keepdim=True)
    if sample_rate != 16000:
        waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
        sample_rate = 16000

    embeddings: list[np.ndarray] = []
    segment_indexes: list[int] = []
    for index, segment in enumerate(segments):
        start = max(0, int(float(segment["start"]) * sample_rate))
        end = min(waveform.shape[1], int(float(segment["end"]) * sample_rate))
        if end - start < int(0.8 * sample_rate):
            continue
        clip = waveform[:, start:min(end, start + int(12 * sample_rate))]
        if clip.shape[1] < sample_rate:
            clip = torch.nn.functional.pad(clip, (0, sample_rate - clip.shape[1]))
        with torch.inference_mode():
            embedding = speaker_model.encode_batch(clip).squeeze().detach().cpu().numpy().reshape(-1)
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embeddings.append(embedding / norm)
            segment_indexes.append(index)

    if len(embeddings) < 2:
        for segment in segments:
            segment["speaker"] = "SPEAKER_00"
        return 0.2

    matrix = np.stack(embeddings)
    labels = AgglomerativeClustering(n_clusters=2, metric="cosine", linkage="average").fit_predict(matrix)
    for segment_index, label in zip(segment_indexes, labels, strict=True):
        segments[segment_index]["speaker"] = f"SPEAKER_{int(label):02d}"
    fill_short_segment_speakers(segments)

    if len(set(labels.tolist())) < 2 or len(labels) < 3:
        return 0.35
    silhouette = float(silhouette_score(matrix, labels, metric="cosine"))
    return max(0.35, min(0.9, 0.55 + 0.35 * silhouette))


def fill_short_segment_speakers(segments: list[dict[str, Any]]) -> None:
    known = [index for index, segment in enumerate(segments) if segment["speaker"] != "SPEAKER_UNKNOWN"]
    if not known:
        return
    for index, segment in enumerate(segments):
        if segment["speaker"] != "SPEAKER_UNKNOWN":
            continue
        nearest = min(known, key=lambda candidate: abs(float(segments[candidate]["start"]) - float(segment["start"])))
        segment["speaker"] = segments[nearest]["speaker"]


def log_probability_confidence(avg_logprob: float) -> float:
    return max(0.0, min(1.0, math.exp(float(avg_logprob))))


def weighted_confidence(segments: list[dict[str, Any]]) -> float:
    weights = [max(0.05, float(segment["end"]) - float(segment["start"])) for segment in segments]
    return sum(float(segment.get("confidence") or 0.0) * weight for segment, weight in zip(segments, weights, strict=True)) / sum(weights)


def build_vtt(segments: list[dict[str, Any]]) -> str:
    cues = ["WEBVTT", ""]
    for index, segment in enumerate(segments, start=1):
        cues.extend([
            str(index),
            f"{vtt_timestamp(float(segment['start']))} --> {vtt_timestamp(float(segment['end']))}",
            f"[{segment['speaker']}] {segment['text']}",
            "",
        ])
    return "\n".join(cues)


def vtt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{millis:03d}"


def process_job(client: WtaClient, transcriber: Transcriber, job: dict[str, Any]) -> None:
    job_id = int(job["id"])
    LOGGER.info("claimed job=%s session=%s bytes=%s attempt=%s", job_id, job.get("sessionId"), job.get("storedBytes"), job.get("attempt"))
    try:
        with tempfile.TemporaryDirectory(prefix=f"wta-{job_id}-", dir="/work") as temporary:
            work_dir = Path(temporary)
            media_path = work_dir / safe_filename(str(job.get("filename") or "recording.mp4"))
            client.download(job_id, media_path)
            result = transcriber.run(media_path, work_dir)
            client.submit_transcript(job_id, result)
        LOGGER.info("submitted transcript job=%s segments=%s", job_id, len(result["segments"]))
        try:
            evaluation_status = client.evaluate(job_id)
            LOGGER.info("evaluation trigger job=%s status=%s", job_id, evaluation_status)
        except Exception:
            # The transcript is already durable. A transient evaluation error
            # must not retranscribe the recording; the Worker cron retries it.
            LOGGER.exception("evaluation trigger failed for job=%s; cron will retry", job_id)
    except Exception as error:
        LOGGER.exception("job=%s failed", job_id)
        try:
            client.fail(job_id, f"{type(error).__name__}: {error}")
        except Exception:
            LOGGER.exception("could not report failure for job=%s", job_id)


def safe_filename(value: str) -> str:
    name = Path(value).name
    return "".join(character for character in name if character.isalnum() or character in "._-")[:180] or "recording.mp4"


def main() -> None:
    parser = argparse.ArgumentParser(description="WTA private recording transcription worker")
    parser.add_argument("--once", action="store_true", help="Claim at most one job, then exit")
    args = parser.parse_args()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings.from_env()
    client = WtaClient(settings)
    transcriber: Transcriber | None = None
    while True:
        try:
            job = client.claim()
            if job:
                if transcriber is None:
                    transcriber = Transcriber(settings)
                process_job(client, transcriber, job)
            elif args.once:
                LOGGER.info("no queued analysis job")
                return
        except Exception:
            LOGGER.exception("worker loop failed")
            if args.once:
                raise
        if args.once:
            return
        time.sleep(settings.poll_seconds)


if __name__ == "__main__":
    main()
