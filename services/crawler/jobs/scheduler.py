"""Single-pass scheduler: finds crawl_targets due for a recrawl and sources
due for a fresh discovery pass, creates crawl_jobs for them. Run this
periodically (cron, or `--loop N`) -- it does not crawl anything itself,
that's jobs/worker.py's job. See docs/PHASE2_IMPLEMENTATION_PLAN.md Part B.

Usage:
    python -m jobs.scheduler              # one pass
    python -m jobs.scheduler --loop 300   # run every 5 minutes
"""
from __future__ import annotations

import argparse
import logging
import time

from jobs import queue
from storage import postgres_repository as repo

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("crawler.scheduler")


def schedule_due_crawl_targets(conn) -> int:
    created = 0
    for target in repo.get_due_crawl_targets(conn):
        if repo.has_pending_job_for_target(conn, target["id"]):
            continue
        queue.create_job(conn, job_type="CRAWL_URL", source_id=target["source_id"], crawl_target_id=target["id"])
        created += 1
    return created


def schedule_due_discoveries(conn) -> int:
    created = 0
    for source in repo.get_sources_due_for_discovery(conn):
        if not repo.has_pending_job_for_source(conn, source["id"], "DISCOVER_SITEMAP"):
            queue.create_job(
                conn,
                job_type="DISCOVER_SITEMAP",
                source_id=source["id"],
                metadata={"domain": source["base_url"], "source_name": source["name"]},
            )
            created += 1
        repo.advance_source_schedule(conn, source["id"], source["crawl_frequency"])
    return created


def run_once(conn) -> None:
    crawl_jobs_created = schedule_due_crawl_targets(conn)
    discovery_jobs_created = schedule_due_discoveries(conn)
    logger.info("[SCHEDULER] crawl_jobs_created=%d discovery_jobs_created=%d", crawl_jobs_created, discovery_jobs_created)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", type=int, default=0, help="Keep scheduling every N seconds instead of running once")
    args = parser.parse_args()

    conn = repo.get_connection()
    try:
        if args.loop:
            while True:
                run_once(conn)
                time.sleep(args.loop)
        else:
            run_once(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
