"""Crawl worker — the only executable entrypoint for the crawler.

Usage:
    python -m jobs.crawl_worker                     # crawl all active sources
    python -m jobs.crawl_worker --source "Fixture Official Org"
    python -m jobs.crawl_worker --normalize-only     # re-run extraction on
                                                      # raw_documents that
                                                      # don't have observations
                                                      # yet, without crawling

Every run is idempotent: unchanged pages produce no new raw_document, and
raw_documents that already have observations are not re-extracted.
"""
from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path

import yaml

from collectors.http.http_collector import HttpCollector
from collectors.sources.example_official import OfficialWebsiteCollector
from collectors.sources.example_directory import BusinessDirectoryCollector
from normalizers.vietnam_phone import normalize_vietnam_phone
from storage import postgres_repository as repo

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("crawler")

COLLECTOR_REGISTRY = {
    "official": OfficialWebsiteCollector,
    "directory": BusinessDirectoryCollector,
    "http": HttpCollector,
}

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "sources.yaml"


def load_sources_config() -> list[dict]:
    fixtures_base_url = os.environ.get("FIXTURES_BASE_URL", "http://localhost:8899")
    raw = CONFIG_PATH.read_text(encoding="utf-8")
    raw = raw.replace("${FIXTURES_BASE_URL}", fixtures_base_url)
    parsed = yaml.safe_load(raw)
    return parsed["sources"]


def _national_number_of(normalized: str, phone_type: str) -> str:
    if phone_type in ("MOBILE", "LANDLINE") and normalized.startswith("+84"):
        return "0" + normalized[3:]
    return normalized


def extract_and_store_observations(conn, raw_document_id: str, raw_content: str) -> int:
    if repo.observations_exist_for_document(conn, raw_document_id):
        return 0

    from extractors.phone_extractor import extract_phone_candidates_from_html

    candidates = extract_phone_candidates_from_html(raw_content)
    for candidate in candidates:
        normalized = normalize_vietnam_phone(candidate.phone_raw)
        repo.insert_phone_observation(
            conn,
            raw_document_id=raw_document_id,
            phone_raw=candidate.phone_raw,
            phone_normalized=normalized.normalized,
            context_text=candidate.context_text,
            context_before=candidate.context_before,
            context_after=candidate.context_after,
            extraction_method=candidate.extraction_method,
            confidence=candidate.confidence,
            position_start=candidate.position_start,
            position_end=candidate.position_end,
        )
        if normalized.normalized:
            national_number = _national_number_of(normalized.normalized, normalized.type)
            repo.upsert_phone_number(
                conn,
                phone_e164=normalized.normalized,
                country_code="84",
                national_number=national_number,
                phone_type=normalized.type,
            )
    conn.commit()
    return len(candidates)


def upsert_source(conn, source_cfg: dict) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO data_sources (name, base_url, source_type, trust_level, crawl_policy, robots_checked, license_notes, is_active)
            VALUES (%(name)s, %(base_url)s, %(source_type)s, %(trust_level)s, %(crawl_policy)s, %(robots_checked)s, %(license_notes)s, true)
            ON CONFLICT (name) DO UPDATE SET
                base_url = EXCLUDED.base_url,
                trust_level = EXCLUDED.trust_level,
                crawl_policy = EXCLUDED.crawl_policy,
                updated_at = now()
            RETURNING id
            """,
            {
                "name": source_cfg["name"],
                "base_url": source_cfg["base_url"],
                "source_type": source_cfg["source_type"],
                "trust_level": source_cfg["trust_level"],
                "crawl_policy": __import__("json").dumps({"crawl_delay_seconds": source_cfg.get("crawl_delay_seconds", 2)}),
                "robots_checked": source_cfg.get("robots_checked", False),
                "license_notes": source_cfg.get("license_notes"),
            },
        )
        source_id = cur.fetchone()["id"]
    conn.commit()
    return source_id


def crawl_source(conn, source_cfg: dict) -> None:
    collector_cls = COLLECTOR_REGISTRY.get(source_cfg.get("collector", "http"), HttpCollector)
    source_id = upsert_source(conn, source_cfg)
    collector = collector_cls(
        source_id=source_id,
        source_name=source_cfg["name"],
        base_url=source_cfg["base_url"],
        crawl_policy={"crawl_delay_seconds": source_cfg.get("crawl_delay_seconds", 2)},
        urls=source_cfg["urls"],
    )

    for url in collector.discover_urls():
        started_at = time.monotonic()
        target = repo.upsert_crawl_target(conn, source_id, url)
        conn.commit()

        try:
            document = collector.fetch(url)
        except (PermissionError, ConnectionError) as exc:
            logger.info("[INFO] source=%s url=%s status=FAILED error=%s", source_cfg["name"], url, exc)
            repo.update_crawl_target_result(conn, target["id"], "FAILED", None, None)
            conn.commit()
            continue

        content_hash = repo.content_hash_of(document.raw_content)
        last_hash = repo.get_last_content_hash(conn, target["id"])

        phones_found = 0
        if content_hash == last_hash:
            repo.update_crawl_target_result(conn, target["id"], "SUCCESS", document.http_status, content_hash)
            conn.commit()
            logger.info("[INFO] source=%s url=%s status=SKIPPED_UNCHANGED", source_cfg["name"], url)
        else:
            metadata = collector.extract_metadata(document)
            raw_document_id = repo.insert_raw_document(
                conn,
                source_id=source_id,
                crawl_target_id=target["id"],
                url=url,
                final_url=document.final_url,
                title=metadata.title,
                content_type=document.content_type,
                http_status=document.http_status,
                content_hash=content_hash,
                raw_content=document.raw_content,
                fetched_at=document.fetched_at,
            )
            conn.commit()
            repo.update_crawl_target_result(conn, target["id"], "SUCCESS", document.http_status, content_hash)
            conn.commit()
            phones_found = extract_and_store_observations(conn, raw_document_id, document.raw_content)
            logger.info("[INFO] source=%s url=%s status=SUCCESS", source_cfg["name"], url)

        duration_ms = int((time.monotonic() - started_at) * 1000)
        logger.info("[INFO] phones_found=%d", phones_found)
        logger.info("[INFO] duration_ms=%d", duration_ms)


def run_normalize_only(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT rd.id, rd.raw_content FROM raw_documents rd
            LEFT JOIN phone_observations po ON po.raw_document_id = rd.id
            WHERE po.id IS NULL
            """
        )
        rows = cur.fetchall()
    for row in rows:
        count = extract_and_store_observations(conn, row["id"], row["raw_content"])
        logger.info("[INFO] raw_document_id=%s phones_found=%d", row["id"], count)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="all", help="Source name to crawl, or 'all'")
    parser.add_argument("--normalize-only", action="store_true", help="Skip crawling; extract observations from unprocessed raw_documents")
    args = parser.parse_args()

    conn = repo.get_connection()
    try:
        if args.normalize_only:
            run_normalize_only(conn)
            return

        sources = load_sources_config()
        if args.source != "all":
            sources = [s for s in sources if s["name"] == args.source]
            if not sources:
                raise SystemExit(f"no source named '{args.source}' in sources.yaml")

        for source_cfg in sources:
            crawl_source(conn, source_cfg)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
