"""Serves services/crawler/fixtures/ over plain HTTP on :8899.

This stands in for real external websites in phase 1's demo/seed pipeline:
the crawler makes real HTTP requests (with real robots.txt handling, rate
limiting, retries) against this server instead of any live external site,
so `docker compose up` + seed is fully reproducible and doesn't touch
anything outside the repo.
"""
from __future__ import annotations

import http.server
import socketserver
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
PORT = 8899


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FIXTURES_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print(f"[fixtures] {self.address_string()} {format % args}")


def main() -> None:
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"[fixtures] serving {FIXTURES_DIR} on :{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
