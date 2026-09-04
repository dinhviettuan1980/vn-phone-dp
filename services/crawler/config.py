"""Phase 2.5 env-driven config for the scheduler and worker. One place so
both processes read the same defaults instead of each parsing os.environ
independently. All values have a safe default -- nothing here is required
for local dev to keep working exactly as before.
"""
from __future__ import annotations

import os


def _int_env(name: str, default: int) -> int:
    value = os.environ.get(name)
    return int(value) if value else default


# Scheduler guardrails
MAX_JOBS_PER_SCHEDULER_RUN = _int_env("MAX_JOBS_PER_SCHEDULER_RUN", 10)
MAX_ACTIVE_JOBS = _int_env("MAX_ACTIVE_JOBS", 5)
SCHEDULER_INTERVAL_SECONDS = _int_env("SCHEDULER_INTERVAL_SECONDS", 300)

# Worker lifecycle
WORKER_CONCURRENCY = _int_env("WORKER_CONCURRENCY", 1)
WORKER_IDLE_SLEEP_SECONDS = _int_env("WORKER_IDLE_SLEEP_SECONDS", 5)

# Shared
JOB_STALE_TIMEOUT_MINUTES = _int_env("JOB_STALE_TIMEOUT_MINUTES", 30)
