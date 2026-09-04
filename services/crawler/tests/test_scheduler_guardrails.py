"""Integration tests for the Phase 2.5 scheduler guardrails -- same
DATABASE_URL skip-gate as test_job_queue_integration.py. Each test creates
its own isolated data_sources/crawl_jobs rows and cleans them up, so it can
run safely against the shared dev DB alongside the real 36+ production
sources."""
import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")

import config
from jobs import queue, scheduler
from storage import postgres_repository as repo


@pytest.fixture
def conn():
    connection = repo.get_connection()
    yield connection
    connection.close()


def make_source(conn, crawl_frequency="WEEKLY", is_active=True, next_scheduled_at_past=True):
    name = f"test-scheduler-source-{uuid.uuid4()}"
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO data_sources (name, base_url, source_type, crawl_frequency, is_active, next_scheduled_at)
            VALUES (%s, %s, 'OTHER', %s, %s, now() - interval '1 hour' * %s)
            RETURNING id
            """,
            (name, f"https://{name}.invalid", crawl_frequency, is_active, 1 if next_scheduled_at_past else -1),
        )
        source_id = cur.fetchone()["id"]
    conn.commit()
    return source_id


def cleanup_source(conn, source_id):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM crawl_jobs WHERE source_id = %s", (source_id,))
        cur.execute("DELETE FROM data_sources WHERE id = %s", (source_id,))
    conn.commit()


def test_manual_sources_never_scheduled(conn):
    source_id = make_source(conn, crawl_frequency="MANUAL")
    try:
        due = repo.get_sources_due_for_discovery(conn)
        assert all(s["id"] != source_id for s in due)
    finally:
        cleanup_source(conn, source_id)


def test_sources_with_active_job_skipped(conn):
    source_id = make_source(conn)
    try:
        queue.create_job(conn, job_type="DISCOVER_SITEMAP", source_id=source_id, metadata={})
        source = {"id": source_id, "is_active": True, "crawl_frequency": "WEEKLY"}
        assert scheduler.is_source_eligible_for_scheduling(conn, source) is False
    finally:
        cleanup_source(conn, source_id)


def test_max_jobs_per_scheduler_run_caps_creation(conn):
    source_ids = [make_source(conn) for _ in range(3)]
    try:
        created, _ = scheduler.schedule_due_discoveries(conn, remaining_budget=2)
        assert created <= 2
    finally:
        for source_id in source_ids:
            cleanup_source(conn, source_id)


def test_max_active_jobs_halts_new_job_creation(conn):
    source_id = make_source(conn)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) AS n FROM crawl_jobs WHERE status IN ('PENDING','RUNNING','RETRY')")
            baseline = cur.fetchone()["n"]

        original_max = config.MAX_ACTIVE_JOBS
        config.MAX_ACTIVE_JOBS = baseline  # already "at capacity" before this pass
        try:
            scheduler.run_once(conn)
            due = repo.get_sources_due_for_discovery(conn)
            assert any(s["id"] == source_id for s in due), "source should still be due -- nothing should have been created"
        finally:
            config.MAX_ACTIVE_JOBS = original_max
    finally:
        cleanup_source(conn, source_id)


def test_rerunning_scheduler_does_not_duplicate_jobs(conn):
    source_id = make_source(conn)
    try:
        scheduler.run_once(conn)
        scheduler.run_once(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) AS n FROM crawl_jobs WHERE source_id = %s AND job_type = 'DISCOVER_SITEMAP'",
                (source_id,),
            )
            assert cur.fetchone()["n"] <= 1
    finally:
        cleanup_source(conn, source_id)
