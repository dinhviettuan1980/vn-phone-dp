"""All Postgres access for the crawler lives here. Nothing outside this
module writes SQL — collectors/jobs call these functions.

Idempotency strategy: a raw_document is only inserted when the fetched
content_hash differs from the last one stored for that crawl_target
(unchanged page -> no-op, safe to re-run the whole worker). Extraction is
only run for a raw_document once (checked via existing-observations count),
so re-running extraction on an already-processed document is also a no-op.
"""
from __future__ import annotations

import hashlib
import os
from typing import Optional
from urllib.parse import urlparse, urlunparse

import psycopg
from psycopg.rows import dict_row


def get_connection() -> psycopg.Connection:
    dsn = os.environ.get("DATABASE_URL", "postgres://phoneintel:phoneintel@localhost:55432/phoneintel")
    return psycopg.connect(dsn, row_factory=dict_row)


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path.rstrip("/") or "/", "", "", ""))


def content_hash_of(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def get_active_sources(conn: psycopg.Connection) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, base_url, source_type, trust_level, crawl_policy "
            "FROM data_sources WHERE is_active = true"
        )
        return cur.fetchall()


def upsert_crawl_target(conn: psycopg.Connection, source_id: str, url: str, priority: int = 100) -> dict:
    normalized = normalize_url(url)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crawl_targets (source_id, url, normalized_url, priority)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (normalized_url) DO UPDATE SET updated_at = now()
            RETURNING id, url, normalized_url, crawl_status
            """,
            (source_id, url, normalized, priority),
        )
        return cur.fetchone()


def update_crawl_target_result(
    conn: psycopg.Connection,
    target_id: str,
    crawl_status: str,
    http_status: Optional[int],
    content_hash: Optional[str],
    etag: Optional[str] = None,
    last_modified: Optional[str] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE crawl_targets
            SET crawl_status = %s, http_status = %s, content_hash = %s,
                etag = COALESCE(%s, etag), last_modified = COALESCE(%s, last_modified),
                attempt_count = attempt_count + 1, last_crawled_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (crawl_status, http_status, content_hash, etag, last_modified, target_id),
        )


def get_crawl_target_conditional_headers(conn: psycopg.Connection, target_id: str) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT etag, last_modified FROM crawl_targets WHERE id = %s", (target_id,))
        row = cur.fetchone()
        return row or {"etag": None, "last_modified": None}


def get_due_crawl_targets(conn: psycopg.Connection, limit: int = 100) -> list[dict]:
    """crawl_targets whose next_crawl_at has arrived -- what the scheduler
    turns into CRAWL_URL jobs. Ordered by priority (URL relevance score,
    reused from domain discovery) so high-value pages get crawled first;
    id is a final tiebreaker so the ordering is fully deterministic across
    scheduler runs."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, source_id, url FROM crawl_targets
            WHERE status = 'active' AND next_crawl_at <= now()
            ORDER BY priority DESC, next_crawl_at ASC, id ASC
            LIMIT %s
            """,
            (limit,),
        )
        return cur.fetchall()


def count_active_jobs(conn: psycopg.Connection) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM crawl_jobs WHERE status IN ('PENDING', 'RUNNING', 'RETRY')")
        return cur.fetchone()["n"]


def has_pending_job_for_target(conn: psycopg.Connection, crawl_target_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM crawl_jobs WHERE crawl_target_id = %s AND status IN ('PENDING', 'RUNNING', 'RETRY') LIMIT 1",
            (crawl_target_id,),
        )
        return cur.fetchone() is not None


def has_pending_job_for_source(conn: psycopg.Connection, source_id: str, job_type: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM crawl_jobs WHERE source_id = %s AND job_type = %s AND status IN ('PENDING', 'RUNNING', 'RETRY') LIMIT 1",
            (source_id, job_type),
        )
        return cur.fetchone() is not None


def get_sources_due_for_discovery(conn: psycopg.Connection) -> list[dict]:
    """crawl_frequency = 'MANUAL' is excluded here at the query level (not
    just via the one-off next_scheduled_at patch applied to the 36
    hand-vetted Phase 1 sources after the discovery-scope incident -- see
    docs/architecture.md "Pre-existing sources default to MANUAL") so a
    newly added MANUAL source is safe by construction, not by remembering
    to also push its schedule far into the future."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, base_url, crawl_frequency, is_active FROM data_sources "
            "WHERE is_active = true AND crawl_frequency != 'MANUAL' AND next_scheduled_at <= now() "
            "ORDER BY id ASC"
        )
        return cur.fetchall()


def advance_source_schedule(conn: psycopg.Connection, source_id: str, crawl_frequency: str) -> None:
    interval_days = {"DAILY": 1, "WEEKLY": 7, "MONTHLY": 30}.get(crawl_frequency, 7)
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE data_sources SET next_scheduled_at = now() + (interval '1 day' * %s), updated_at = now() WHERE id = %s",
            (interval_days, source_id),
        )
    conn.commit()


def get_crawl_target(conn: psycopg.Connection, target_id: str) -> Optional[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT ct.id, ct.url, ct.source_id, ds.name AS source_name, ds.base_url, ds.crawl_policy "
            "FROM crawl_targets ct JOIN data_sources ds ON ds.id = ct.source_id WHERE ct.id = %s",
            (target_id,),
        )
        return cur.fetchone()


def get_last_content_hash(conn: psycopg.Connection, crawl_target_id: str) -> Optional[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT content_hash FROM raw_documents WHERE crawl_target_id = %s "
            "ORDER BY created_at DESC LIMIT 1",
            (crawl_target_id,),
        )
        row = cur.fetchone()
        return row["content_hash"] if row else None


def insert_raw_document(
    conn: psycopg.Connection,
    source_id: str,
    crawl_target_id: str,
    url: str,
    final_url: str,
    title: Optional[str],
    content_type: str,
    http_status: int,
    content_hash: str,
    raw_content: str,
    fetched_at: str,
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO raw_documents
                (source_id, crawl_target_id, url, final_url, title, content_type,
                 http_status, content_hash, raw_content, fetched_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (source_id, crawl_target_id, url, final_url, title, content_type, http_status, content_hash, raw_content, fetched_at),
        )
        return cur.fetchone()["id"]


def observations_exist_for_document(conn: psycopg.Connection, raw_document_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM phone_observations WHERE raw_document_id = %s LIMIT 1", (raw_document_id,))
        return cur.fetchone() is not None


def insert_phone_observation(
    conn: psycopg.Connection,
    raw_document_id: str,
    phone_raw: str,
    phone_normalized: Optional[str],
    context_text: str,
    context_before: str,
    context_after: str,
    extraction_method: str,
    confidence: float,
    position_start: int,
    position_end: int,
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO phone_observations
                (raw_document_id, phone_raw, phone_normalized, context_text, context_before,
                 context_after, extraction_method, confidence, position_start, position_end)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (raw_document_id, phone_raw, phone_normalized, context_text, context_before, context_after, extraction_method, confidence, position_start, position_end),
        )
        return cur.fetchone()["id"]


def insert_dataset(
    conn: psycopg.Connection,
    source_id: Optional[str],
    name: str,
    dataset_format: str,
    checksum: str,
    dataset_url: Optional[str] = None,
    license_notes: Optional[str] = None,
    row_count: Optional[int] = None,
) -> dict:
    """Idempotent on checksum: re-ingesting the identical file returns the
    existing dataset row instead of creating a duplicate."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, status FROM datasets WHERE checksum = %s", (checksum,))
        existing = cur.fetchone()
        if existing:
            return existing

        cur.execute(
            """
            INSERT INTO datasets (source_id, name, dataset_url, format, license_notes, checksum, row_count, status, downloaded_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'PENDING', now())
            RETURNING id, status
            """,
            (source_id, name, dataset_url, dataset_format, license_notes, checksum, row_count),
        )
        row = cur.fetchone()
    conn.commit()
    return row


def update_dataset_progress(conn: psycopg.Connection, dataset_id: str, processed_rows: int, status: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE datasets SET processed_rows = %s, status = %s, updated_at = now() WHERE id = %s",
            (processed_rows, status, dataset_id),
        )
    conn.commit()


def upsert_phone_number(conn: psycopg.Connection, phone_e164: str, country_code: str, national_number: str, phone_type: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO phone_numbers (phone_e164, country_code, national_number, phone_type, observation_count)
            VALUES (%s, %s, %s, %s, 1)
            ON CONFLICT (phone_e164) DO UPDATE SET
                observation_count = phone_numbers.observation_count + 1,
                last_seen_at = now(),
                updated_at = now(),
                phone_type = EXCLUDED.phone_type
            RETURNING id
            """,
            (phone_e164, country_code, national_number, phone_type),
        )
        return cur.fetchone()["id"]
