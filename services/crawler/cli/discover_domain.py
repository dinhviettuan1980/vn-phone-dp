"""python -m cli.discover_domain --domain https://example.vn"""
from __future__ import annotations

import argparse

from domain_discovery.discovery_service import discover_domain
from storage import postgres_repository as repo


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--domain", required=True)
    parser.add_argument("--source-name", default=None)
    parser.add_argument("--max-urls", type=int, default=500)
    args = parser.parse_args()

    conn = repo.get_connection()
    try:
        report = discover_domain(conn, args.domain, source_name=args.source_name, max_urls_queued=args.max_urls)
    finally:
        conn.close()

    print("=====================================")
    print()
    print("DOMAIN DISCOVERY REPORT")
    print()
    print("Domain:")
    print(report.domain)
    print()
    print("Robots:")
    print("FOUND" if report.robots_found else "NOT FOUND")
    print()
    print("Sitemaps:")
    print(report.sitemaps_found)
    print()
    print("URLs discovered:")
    print(f"{report.urls_discovered:,}")
    print()
    print("URLs high priority:")
    print(f"{report.urls_high_priority:,}")
    print()
    print("URLs queued:")
    print(f"{report.urls_queued:,}")
    if report.errors:
        print()
        print("Errors:")
        for err in report.errors:
            print(f"  - {err}")
    print()
    print("=====================================")


if __name__ == "__main__":
    main()
