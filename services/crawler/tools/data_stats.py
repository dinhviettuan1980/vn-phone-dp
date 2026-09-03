"""python -m tools.data_stats — data quality metrics CLI."""
from __future__ import annotations

from storage.postgres_repository import get_connection


def compute_stats(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM raw_documents")
        total_raw_documents = cur.fetchone()["n"]

        cur.execute("SELECT count(*) AS n FROM phone_observations")
        total_observations = cur.fetchone()["n"]

        cur.execute("SELECT count(*) AS n FROM phone_numbers")
        total_unique_phones = cur.fetchone()["n"]

        cur.execute("SELECT count(*) AS n FROM phone_numbers WHERE phone_type != 'UNKNOWN'")
        valid_phones = cur.fetchone()["n"]

        cur.execute("SELECT count(*) AS n FROM phone_observations WHERE phone_normalized IS NULL")
        invalid_candidates = cur.fetchone()["n"]

        cur.execute("SELECT count(*) AS n FROM phone_numbers WHERE observation_count > 3")
        multi_evidence = cur.fetchone()["n"]

        cur.execute(
            """
            SELECT ds.name, count(po.id) AS phone_count
            FROM phone_observations po
            JOIN raw_documents rd ON rd.id = po.raw_document_id
            JOIN data_sources ds ON ds.id = rd.source_id
            GROUP BY ds.name ORDER BY phone_count DESC LIMIT 1
            """
        )
        top_source = cur.fetchone()

    return {
        "total_raw_documents": total_raw_documents,
        "total_observations": total_observations,
        "total_unique_phones": total_unique_phones,
        "valid_phones": valid_phones,
        "invalid_candidates": invalid_candidates,
        "multi_evidence": multi_evidence,
        "top_source": top_source,
    }


def main() -> None:
    conn = get_connection()
    try:
        s = compute_stats(conn)
    finally:
        conn.close()

    print("=====================================")
    print()
    print("PHONE INTELLIGENCE DATA STATISTICS")
    print()
    print("Raw Documents:")
    print(f"{s['total_raw_documents']:,}")
    print()
    print("Phone Observations:")
    print(f"{s['total_observations']:,}")
    print()
    print("Unique Phones:")
    print(f"{s['total_unique_phones']:,}")
    print()
    print("Valid Phones:")
    print(f"{s['valid_phones']:,}")
    print()
    print("Invalid Candidates:")
    print(f"{s['invalid_candidates']:,}")
    print()
    print("Phones with > 3 evidence:")
    print(f"{s['multi_evidence']:,}")
    print()
    if s["top_source"]:
        print("Top Source:")
        print(s["top_source"]["name"])
        print(f"{s['top_source']['phone_count']:,} observations")
    print()
    print("=====================================")


if __name__ == "__main__":
    main()
