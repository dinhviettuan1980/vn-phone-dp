"""Integration tests against the real dev DB -- skipped automatically if
DATABASE_URL isn't set, same gating pattern as the TS integration suite
(apps/api/src/__tests__/integration.pipeline.test.ts)."""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")

import config
from jobs import queue
from storage import postgres_repository as repo


@pytest.fixture
def conn():
    connection = repo.get_connection()
    yield connection
    connection.close()


def test_create_claim_complete(conn):
    job_id = queue.create_job(conn, job_type="DISCOVER_DOMAIN", metadata={"domain": "https://test-queue.invalid"})
    job = queue.claim_job(conn)
    assert job is not None
    assert job["id"] == job_id
    assert job["job_type"] == "DISCOVER_DOMAIN"

    queue.complete_job(conn, job_id)
    with conn.cursor() as cur:
        cur.execute("SELECT status FROM crawl_jobs WHERE id = %s", (job_id,))
        assert cur.fetchone()["status"] == "SUCCESS"


def test_claim_is_atomic_no_double_claim(conn):
    job_id = queue.create_job(conn, job_type="CRAWL_URL", metadata={})
    first_claim = queue.claim_job(conn)
    assert first_claim is not None
    assert first_claim["id"] == job_id

    # Job is now RUNNING, not PENDING/RETRY -- a second claim must not see it.
    second_claim = queue.claim_job(conn)
    assert second_claim is None or second_claim["id"] != job_id

    queue.complete_job(conn, job_id)


def test_fail_job_retries_with_backoff_then_fails_permanently(conn):
    job_id = queue.create_job(conn, job_type="CRAWL_URL", metadata={})
    with conn.cursor() as cur:
        cur.execute("UPDATE crawl_jobs SET max_attempts = 2 WHERE id = %s", (job_id,))
    conn.commit()

    queue.claim_job(conn)
    queue.fail_job(conn, job_id, "attempt 1 failed")
    with conn.cursor() as cur:
        cur.execute("SELECT status, attempt_count, scheduled_at FROM crawl_jobs WHERE id = %s", (job_id,))
        row = cur.fetchone()
        assert row["status"] == "RETRY"
        assert row["attempt_count"] == 1
        assert row["scheduled_at"] > datetime.now(timezone.utc)

    # Force it due now so we can claim it again for the second (final) attempt.
    with conn.cursor() as cur:
        cur.execute("UPDATE crawl_jobs SET scheduled_at = now() WHERE id = %s", (job_id,))
    conn.commit()

    queue.claim_job(conn)
    queue.fail_job(conn, job_id, "attempt 2 failed")
    with conn.cursor() as cur:
        cur.execute("SELECT status, attempt_count FROM crawl_jobs WHERE id = %s", (job_id,))
        row = cur.fetchone()
        assert row["status"] == "FAILED"
        assert row["attempt_count"] == 2


def test_recover_stale_jobs(conn):
    job_id = queue.create_job(conn, job_type="CRAWL_URL", metadata={})
    queue.claim_job(conn)

    # Simulate a worker that crashed well beyond the configured stale timeout.
    stale_minutes = config.JOB_STALE_TIMEOUT_MINUTES + 10
    with conn.cursor() as cur:
        cur.execute("UPDATE crawl_jobs SET locked_at = now() - (interval '1 minute' * %s) WHERE id = %s", (stale_minutes, job_id))
    conn.commit()

    recovered = queue.recover_stale_jobs(conn)
    assert recovered >= 1

    with conn.cursor() as cur:
        cur.execute("SELECT status, locked_at FROM crawl_jobs WHERE id = %s", (job_id,))
        row = cur.fetchone()
        assert row["status"] == "RETRY"
        assert row["locked_at"] is None

    # Recovery puts the job back in the claimable pool -- drain it so it
    # doesn't leak into other tests' priority-ordering assertions.
    with conn.cursor() as cur:
        cur.execute("UPDATE crawl_jobs SET status = 'CANCELLED' WHERE id = %s", (job_id,))
    conn.commit()


def test_priority_ordering(conn):
    low_id = queue.create_job(conn, job_type="CRAWL_URL", priority=10, metadata={"tag": "low"})
    high_id = queue.create_job(conn, job_type="CRAWL_URL", priority=200, metadata={"tag": "high"})

    first = queue.claim_job(conn)
    assert first["id"] == high_id

    second = queue.claim_job(conn)
    assert second["id"] == low_id

    queue.complete_job(conn, low_id)
    queue.complete_job(conn, high_id)
