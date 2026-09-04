"""Integration test: collector writes a real system_metrics row -- same
DATABASE_URL skip-gate as the other integration suites."""
import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")

from monitoring.collector import collect_and_store
from storage import postgres_repository as repo


@pytest.fixture
def conn():
    connection = repo.get_connection()
    yield connection
    connection.close()


def test_collect_and_store_inserts_one_row(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM system_metrics")
        before = cur.fetchone()["n"]

    collect_and_store(conn)

    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM system_metrics")
        after = cur.fetchone()["n"]
        assert after == before + 1

        cur.execute("SELECT disk_total_bytes, disk_available_bytes FROM system_metrics ORDER BY recorded_at DESC LIMIT 1")
        row = cur.fetchone()
        assert row["disk_total_bytes"] > 0
        assert row["disk_available_bytes"] >= 0

        # Cleanup -- this is a synthetic test snapshot, not a real
        # observation-window data point.
        cur.execute("DELETE FROM system_metrics WHERE disk_total_bytes = %s AND recorded_at > now() - interval '1 minute'", (row["disk_total_bytes"],))
    conn.commit()
