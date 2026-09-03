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
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE crawl_targets
            SET crawl_status = %s, http_status = %s, content_hash = %s,
                attempt_count = attempt_count + 1, last_crawled_at = now(), updated_at = now()
            WHERE id = %s
            """,
            (crawl_status, http_status, content_hash, target_id),
        )


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
