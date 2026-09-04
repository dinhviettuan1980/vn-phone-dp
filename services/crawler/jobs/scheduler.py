"""Single-pass scheduler: finds crawl_targets due for a recrawl and sources
due for a fresh discovery pass, creates crawl_jobs for them. Run this
periodically (systemd + --loop, or cron) -- it does not crawl anything
itself, that's jobs/worker.py's job. See docs/PHASE2_IMPLEMENTATION_PLAN.md
Part B and docs/PHASE2_5_IMPLEMENTATION_PLAN.md Part 4 for the guardrails
below (added after a real incident: the first scheduler run once queued 43
discovery jobs against real, hand-vetted bank sources in a single pass --
see docs/architecture.md "Pre-existing sources default to MANUAL").

Usage:
    python -m jobs.scheduler              # one pass
    python -m jobs.scheduler --loop 300   # run every 5 minutes
"""
from __future__ import annotations

import argparse
import logging
import time

import config
from jobs import queue
from storage import postgres_repository as repo

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("crawler.scheduler")


def is_source_eligible_for_scheduling(conn, source: dict) -> bool:
    """Complete, testable eligibility predicate. get_sources_due_for_discovery
    already filters is_active/crawl_frequency/next_scheduled_at at the SQL
    level -- this re-checks them (cheap, and keeps this function correct on
    its own even if called with a hand-built dict in a test) plus the one
    check that can't be expressed as a WHERE clause: no active job already
    in flight for this source."""
    if not source.get("is_active", True):
        return False
    if source.get("crawl_frequency") == "MANUAL":
        return False
    if repo.has_pending_job_for_source(conn, source["id"], "DISCOVER_SITEMAP"):
        return False
    return True


def schedule_due_crawl_targets(conn, remaining_budget: int) -> tuple[int, int]:
    """Returns (created, skipped_active). Stops once remaining_budget jobs
    have been created."""
    created = 0
    skipped_active = 0
    for target in repo.get_due_crawl_targets(conn):
        if created >= remaining_budget:
            break
        if repo.has_pending_job_for_target(conn, target["id"]):
            skipped_active += 1
            continue
        queue.create_job(conn, job_type="CRAWL_URL", source_id=target["source_id"], crawl_target_id=target["id"])
        created += 1
    return created, skipped_active


def schedule_due_discoveries(conn, remaining_budget: int) -> tuple[int, int]:
    """Returns (created, skipped_active). Stops once remaining_budget jobs
    have been created -- sources beyond the budget are left due for the
    next scheduler pass (their next_scheduled_at is NOT advanced), so
    nothing is silently dropped, just deferred."""
    created = 0
    skipped_active = 0
    for source in repo.get_sources_due_for_discovery(conn):
        if created >= remaining_budget:
            break
        if not is_source_eligible_for_scheduling(conn, source):
            skipped_active += 1
            continue
        queue.create_job(
            conn,
            job_type="DISCOVER_SITEMAP",
            source_id=source["id"],
            metadata={"domain": source["base_url"], "source_name": source["name"]},
        )
        created += 1
        repo.advance_source_schedule(conn, source["id"], source["crawl_frequency"])
    return created, skipped_active


def run_once(conn) -> None:
    active_jobs = repo.count_active_jobs(conn)
    if active_jobs >= config.MAX_ACTIVE_JOBS:
        logger.info(
            "[SCHEDULER] active_jobs=%d max_active_jobs=%d -- at capacity, creating nothing this pass",
            active_jobs, config.MAX_ACTIVE_JOBS,
        )
        return

    budget = min(config.MAX_JOBS_PER_SCHEDULER_RUN, config.MAX_ACTIVE_JOBS - active_jobs)

    crawl_jobs_created, crawl_skipped = schedule_due_crawl_targets(conn, budget)
    remaining = budget - crawl_jobs_created
    discovery_jobs_created, discovery_skipped = schedule_due_discoveries(conn, remaining)

    logger.info(
        "[SCHEDULER] active_jobs_before=%d budget=%d crawl_jobs_created=%d discovery_jobs_created=%d "
        "skipped_already_active=%d",
        active_jobs, budget, crawl_jobs_created, discovery_jobs_created, crawl_skipped + discovery_skipped,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", type=int, default=0, help="Keep scheduling every N seconds instead of running once")
    args = parser.parse_args()

    interval = args.loop or config.SCHEDULER_INTERVAL_SECONDS
    conn = repo.get_connection()
    try:
        if args.loop:
            logger.info("[SCHEDULER] started interval_seconds=%d max_active_jobs=%d max_per_run=%d",
                        interval, config.MAX_ACTIVE_JOBS, config.MAX_JOBS_PER_SCHEDULER_RUN)
            while True:
                run_once(conn)
                time.sleep(args.loop)
        else:
            run_once(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
