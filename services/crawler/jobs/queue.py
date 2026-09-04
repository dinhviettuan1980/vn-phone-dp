"""Postgres-backed job queue for crawl_jobs. No Redis/BullMQ -- the whole
project already runs job-table-style scheduling for crawl_targets
(next_crawl_at), so this follows the same "simplest thing that fits"
decision (see docs/PHASE2_IMPLEMENTATION_PLAN.md).

Atomicity: claim() uses SELECT ... FOR UPDATE SKIP LOCKED so multiple
worker processes can poll the same table without claiming the same job
twice or blocking on each other.
"""
from __future__ import annotations

import json
import socket
from datetime import datetime, timedelta, timezone
from typing import Optional

import psycopg

STALE_LOCK_MINUTES = 10
BACKOFF_BASE_SECONDS = 30


def worker_id() -> str:
    import os

    return f"{socket.gethostname()}:{os.getpid()}"


def create_job(
    conn: psycopg.Connection,
    job_type: str,
    source_id: Optional[str] = None,
    crawl_target_id: Optional[str] = None,
    priority: int = 100,
    metadata: Optional[dict] = None,
    scheduled_at: Optional[datetime] = None,
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crawl_jobs (job_type, source_id, crawl_target_id, priority, metadata, scheduled_at)
            VALUES (%s, %s, %s, %s, %s, COALESCE(%s, now()))
            RETURNING id
            """,
            (job_type, source_id, crawl_target_id, priority, json.dumps(metadata or {}), scheduled_at),
        )
        job_id = cur.fetchone()["id"]
    conn.commit()
    return job_id


def claim_job(conn: psycopg.Connection) -> Optional[dict]:
    """Atomically claim the highest-priority due job. Returns None if
    nothing is claimable right now."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id FROM crawl_jobs
            WHERE status IN ('PENDING', 'RETRY') AND scheduled_at <= now()
            ORDER BY priority DESC, scheduled_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if row is None:
            conn.commit()
            return None

        cur.execute(
            """
            UPDATE crawl_jobs
            SET status = 'RUNNING', started_at = now(), locked_at = now(), locked_by = %s, updated_at = now()
            WHERE id = %s
            RETURNING id, job_type, source_id, crawl_target_id, attempt_count, max_attempts, metadata
            """,
            (worker_id(), row["id"]),
        )
        job = cur.fetchone()
    conn.commit()
    return job


def complete_job(conn: psycopg.Connection, job_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE crawl_jobs
            SET status = 'SUCCESS', finished_at = now(), locked_at = NULL, locked_by = NULL, updated_at = now()
            WHERE id = %s
            """,
            (job_id,),
        )
    conn.commit()


def fail_job(conn: psycopg.Connection, job_id: str, error_message: str) -> None:
    """Increments attempt_count; RETRY with exponential backoff if under
    max_attempts, else FAILED."""
    with conn.cursor() as cur:
        cur.execute("SELECT attempt_count, max_attempts FROM crawl_jobs WHERE id = %s FOR UPDATE", (job_id,))
        row = cur.fetchone()
        new_attempt_count = row["attempt_count"] + 1

        if new_attempt_count >= row["max_attempts"]:
            cur.execute(
                """
                UPDATE crawl_jobs
                SET status = 'FAILED', attempt_count = %s, error_message = %s,
                    finished_at = now(), locked_at = NULL, locked_by = NULL, updated_at = now()
                WHERE id = %s
                """,
                (new_attempt_count, error_message, job_id),
            )
        else:
            backoff_seconds = BACKOFF_BASE_SECONDS * (2 ** (new_attempt_count - 1))
            next_attempt = datetime.now(timezone.utc) + timedelta(seconds=backoff_seconds)
            cur.execute(
                """
                UPDATE crawl_jobs
                SET status = 'RETRY', attempt_count = %s, error_message = %s,
                    scheduled_at = %s, locked_at = NULL, locked_by = NULL, updated_at = now()
                WHERE id = %s
                """,
                (new_attempt_count, error_message, next_attempt, job_id),
            )
    conn.commit()


def recover_stale_jobs(conn: psycopg.Connection) -> int:
    """A worker that crashed mid-job leaves it stuck in RUNNING forever --
    reclaim anything locked longer than STALE_LOCK_MINUTES back to RETRY."""
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE crawl_jobs
            SET status = 'RETRY', locked_at = NULL, locked_by = NULL,
                error_message = 'recovered from stale RUNNING lock', updated_at = now()
            WHERE status = 'RUNNING' AND locked_at < now() - (interval '1 minute' * %s)
            RETURNING id
            """,
            (STALE_LOCK_MINUTES,),
        )
        recovered = cur.fetchall()
    conn.commit()
    return len(recovered)
