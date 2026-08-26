import importlib.util
from pathlib import Path
import sys
from unittest.mock import Mock

MODULE_PATH = Path(__file__).with_name("worker.py")
SPEC = importlib.util.spec_from_file_location("wta_review_worker", MODULE_PATH)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = worker
SPEC.loader.exec_module(worker)


def test_vtt_timestamp():
    assert worker.vtt_timestamp(0) == "00:00:00.000"
    assert worker.vtt_timestamp(61.234) == "00:01:01.234"
    assert worker.vtt_timestamp(3661.001) == "01:01:01.001"


def test_build_vtt_includes_speaker_and_times():
    result = worker.build_vtt([
        {"start": 1.25, "end": 3.5, "speaker": "SPEAKER_01", "text": "Hello."},
    ])
    assert "WEBVTT" in result
    assert "00:00:01.250 --> 00:00:03.500" in result
    assert "[SPEAKER_01] Hello." in result


def test_fill_short_segments_uses_nearest_known_speaker():
    segments = [
        {"start": 0.0, "speaker": "SPEAKER_00"},
        {"start": 2.0, "speaker": "SPEAKER_UNKNOWN"},
        {"start": 10.0, "speaker": "SPEAKER_01"},
    ]
    worker.fill_short_segment_speakers(segments)
    assert segments[1]["speaker"] == "SPEAKER_00"


def test_evaluate_waits_for_worker_ai_result():
    settings = worker.Settings(
        base_url="https://example.test",
        secret="secret",
        worker_id="worker",
        model_name="large-v3",
        compute_type="float16",
        poll_seconds=10,
    )
    client = worker.WtaClient(settings)
    response = Mock()
    response.json.return_value = {"status": "ready"}
    client.session.post = Mock(return_value=response)

    assert client.evaluate(42) == "ready"
    client.session.post.assert_called_once_with(
        "https://example.test/api/analysis/worker/jobs/42/evaluate",
        timeout=300,
    )
    response.raise_for_status.assert_called_once_with()
