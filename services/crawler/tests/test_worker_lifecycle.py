"""Unit tests for the Phase 2.5 worker lifecycle -- no DB needed, these
test the shutdown-flag behavior and config wiring in isolation."""
import importlib

import config
from jobs import worker


def test_config_respected_at_startup():
    assert config.WORKER_CONCURRENCY >= 1
    assert config.WORKER_IDLE_SLEEP_SECONDS >= 0
    assert config.JOB_STALE_TIMEOUT_MINUTES > 0


def test_shutdown_flag_stops_run_once_before_claiming(monkeypatch):
    """run_once must not call queue.claim_job at all once shutdown has
    already been requested -- simulates SIGTERM arriving between passes."""
    claimed = []

    def fake_claim_job(_conn):
        claimed.append(1)
        return None

    def fake_recover_stale_jobs(_conn):
        return 0

    monkeypatch.setattr(worker.queue, "claim_job", fake_claim_job)
    monkeypatch.setattr(worker.queue, "recover_stale_jobs", fake_recover_stale_jobs)
    monkeypatch.setattr(worker, "_shutdown_requested", True)

    processed = worker.run_once(conn=None)

    assert processed == 0
    assert claimed == []


def test_signal_handler_sets_shutdown_flag():
    importlib.reload(worker)
    assert worker._shutdown_requested is False
    worker._request_shutdown(15, None)
    assert worker._shutdown_requested is True
    importlib.reload(worker)  # reset for other tests in the same process
