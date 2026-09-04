"""Lightweight metrics collector: snapshot /proc + statvfs, store one
system_metrics row, repeat. Same shape as jobs/worker.py -- --loop N,
SIGTERM/SIGINT graceful shutdown.

Usage:
    python -m monitoring.collector              # one snapshot, exit
    python -m monitoring.collector --loop 300    # keep snapshotting every 5 minutes
"""
from __future__ import annotations

import argparse
import logging
import signal
import time

import config
from monitoring.system_metrics import collect_snapshot
from storage import postgres_repository as repo

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("crawler.monitoring")

_shutdown_requested = False


def _request_shutdown(signum, _frame) -> None:
    global _shutdown_requested
    _shutdown_requested = True
    logger.info("[METRICS] shutdown_requested signal=%s", signum)


def collect_and_store(conn) -> None:
    snapshot = collect_snapshot()
    repo.insert_system_metrics_snapshot(conn, snapshot)
    logger.info(
        "[METRICS] cpu=%s%% load=%.2f/%.2f/%.2f mem_available=%dMB disk_available=%dMB",
        snapshot.cpu_percent, snapshot.load_1, snapshot.load_5, snapshot.load_15,
        snapshot.memory_available_bytes // (1024 * 1024),
        snapshot.disk_available_bytes // (1024 * 1024),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", type=int, default=0, help="Keep collecting every N seconds instead of collecting once and exiting")
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)

    interval = args.loop or config.SYSTEM_METRICS_INTERVAL_SECONDS
    logger.info("[METRICS] collector_started interval_seconds=%d loop=%s", interval, bool(args.loop))

    conn = repo.get_connection()
    try:
        if args.loop:
            while not _shutdown_requested:
                collect_and_store(conn)
                for _ in range(args.loop):
                    if _shutdown_requested:
                        break
                    time.sleep(1)
        else:
            collect_and_store(conn)
    finally:
        conn.close()
        logger.info("[METRICS] collector_stopped")


if __name__ == "__main__":
    main()
