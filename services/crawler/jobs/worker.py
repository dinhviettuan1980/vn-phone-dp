"""Claims crawl_jobs and dispatches by job_type. Reuses Phase 1's
crawl_worker.extract_and_store_observations and HttpCollector -- this file
adds queue-driven execution around them, it does not reimplement crawling.

Usage:
    python -m jobs.worker              # claim+run jobs until the queue is empty
    python -m jobs.worker --loop 30    # keep polling every 30s (for a long-running process)
"""
from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

from domain_discovery.discovery_service import discover_domain
from jobs import queue
from jobs.crawl_worker import extract_and_store_observations, load_sources_config, crawl_source
from collectors.http.http_collector import HttpCollector
from dataset_ingestion.dataset_service import ingest_dataset
from storage import postgres_repository as repo

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("crawler.worker")


def run_crawl_url_job(conn, job: dict) -> None:
    target_id = job["crawl_target_id"]
    if target_id is None:
        raise ValueError("CRAWL_URL job missing crawl_target_id")

    target = repo.get_crawl_target(conn, target_id)
    if target is None:
        raise ValueError(f"crawl_target {target_id} not found")

    conditional = repo.get_crawl_target_conditional_headers(conn, target_id)
    collector = HttpCollector(
        source_id=target["source_id"],
        source_name=target["source_name"],
        base_url=target["base_url"],
        crawl_policy=target["crawl_policy"] or {},
        urls=[target["url"]],
    )

    started = time.monotonic()
    document = collector.fetch(target["url"], etag=conditional.get("etag"), last_modified=conditional.get("last_modified"))

    if document.not_modified:
        repo.update_crawl_target_result(conn, target_id, "SUCCESS", 304, None, document.etag, document.last_modified)
        conn.commit()
        logger.info("[CRAWL] source=%s url=%s status=NOT_MODIFIED duration_ms=%d", target["source_name"], target["url"], int((time.monotonic() - started) * 1000))
        return

    content_hash = repo.content_hash_of(document.raw_content)
    last_hash = repo.get_last_content_hash(conn, target_id)

    if content_hash == last_hash:
        repo.update_crawl_target_result(conn, target_id, "SUCCESS", document.http_status, content_hash, document.etag, document.last_modified)
        conn.commit()
        logger.info("[CRAWL] source=%s url=%s status=UNCHANGED duration_ms=%d", target["source_name"], target["url"], int((time.monotonic() - started) * 1000))
        return

    metadata = collector.extract_metadata(document)
    raw_document_id = repo.insert_raw_document(
        conn,
        source_id=target["source_id"],
        crawl_target_id=target_id,
        url=target["url"],
        final_url=document.final_url,
        title=metadata.title,
        content_type=document.content_type,
        http_status=document.http_status,
        content_hash=content_hash,
        raw_content=document.raw_content,
        fetched_at=document.fetched_at,
    )
    conn.commit()
    repo.update_crawl_target_result(conn, target_id, "SUCCESS", document.http_status, content_hash, document.etag, document.last_modified)
    conn.commit()

    phones_found = extract_and_store_observations(conn, raw_document_id, document.raw_content)
    logger.info(
        "[CRAWL] source=%s url=%s status=SUCCESS phones_found=%d duration_ms=%d",
        target["source_name"], target["url"], phones_found, int((time.monotonic() - started) * 1000),
    )


def run_crawl_source_job(conn, job: dict) -> None:
    source_name = job["metadata"].get("source_name")
    sources = load_sources_config()
    matches = [s for s in sources if s["name"] == source_name]
    if not matches:
        raise ValueError(f"no source named '{source_name}' in sources.yaml")
    crawl_source(conn, matches[0])


def run_discover_domain_job(conn, job: dict) -> None:
    domain = job["metadata"]["domain"]
    source_name = job["metadata"].get("source_name")
    report = discover_domain(conn, domain, source_name=source_name)
    logger.info(
        "[DISCOVERY] domain=%s sitemaps=%d urls=%d queued=%d",
        report.domain, report.sitemaps_found, report.urls_discovered, report.urls_queued,
    )


def run_ingest_dataset_job(conn, job: dict) -> None:
    file_path = Path(job["metadata"]["file_path"])
    source_name = job["metadata"].get("source_name", file_path.stem)
    license_notes = job["metadata"].get("license_notes")
    result = ingest_dataset(conn, file_path, source_name, license_notes)
    logger.info("[DATASET] dataset=%s rows=%d phones_found=%d", file_path.name, result["rows_processed"], result["phones_found"])


JOB_HANDLERS = {
    "CRAWL_URL": run_crawl_url_job,
    "RECRAWL": run_crawl_url_job,
    "CRAWL_SOURCE": run_crawl_source_job,
    "DISCOVER_DOMAIN": run_discover_domain_job,
    "DISCOVER_SITEMAP": run_discover_domain_job,
    "INGEST_DATASET": run_ingest_dataset_job,
}


def run_once(conn) -> int:
    """Claims and runs jobs until the queue has nothing due. Returns the
    number of jobs processed."""
    recovered = queue.recover_stale_jobs(conn)
    if recovered:
        logger.info("[JOB] recovered_stale=%d", recovered)

    processed = 0
    while True:
        job = queue.claim_job(conn)
        if job is None:
            break

        logger.info("[JOB] job_id=%s type=%s status=RUNNING", job["id"], job["job_type"])
        handler = JOB_HANDLERS.get(job["job_type"])
        try:
            if handler is None:
                raise ValueError(f"no handler for job_type {job['job_type']}")
            handler(conn, job)
            queue.complete_job(conn, job["id"])
            logger.info("[JOB] job_id=%s type=%s status=SUCCESS", job["id"], job["job_type"])
        except Exception as exc:  # noqa: BLE001 -- job failures must not crash the worker loop
            queue.fail_job(conn, job["id"], str(exc))
            logger.warning("[JOB] job_id=%s type=%s status=FAILED error=%s", job["id"], job["job_type"], exc)

        processed += 1

    return processed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", type=int, default=0, help="Keep polling every N seconds instead of exiting when the queue is empty")
    args = parser.parse_args()

    conn = repo.get_connection()
    try:
        if args.loop:
            while True:
                run_once(conn)
                time.sleep(args.loop)
        else:
            processed = run_once(conn)
            logger.info("[JOB] queue empty, processed=%d", processed)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
