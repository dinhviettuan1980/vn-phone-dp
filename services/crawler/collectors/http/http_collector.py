"""Generic HTTP collector: httpx + robots.txt + per-domain rate limiting +
retry with exponential backoff. Works against any source configured in
sources.yaml — no site-specific code lives here."""
from __future__ import annotations

import logging
import time
import urllib.robotparser
from datetime import datetime, timezone
from typing import Dict, List
from urllib.parse import urlparse

import httpx

from collectors.base.base_collector import BaseCollector, FetchedDocument

logger = logging.getLogger("crawler.http_collector")

USER_AGENT = "PhoneIntelBot/0.1 (+https://example.invalid/bot; research/demo use)"

# Module-level so it's shared across collector instances within one process —
# a real deployment would move this to Redis if the crawler ever runs
# multi-process, but a single worker process is phase-1 scope.
_last_request_at: Dict[str, float] = {}
_robots_cache: Dict[str, urllib.robotparser.RobotFileParser] = {}


def _domain_of(url: str) -> str:
    return urlparse(url).netloc


def _get_robots_parser(url: str) -> urllib.robotparser.RobotFileParser:
    domain = _domain_of(url)
    if domain not in _robots_cache:
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(robots_url)
        try:
            rp.read()
        except Exception:
            # Unreachable robots.txt -> fail closed to "no rules found" is
            # what RobotFileParser does by default (allows everything), which
            # matches its documented behavior for a missing robots.txt.
            pass
        _robots_cache[domain] = rp
    return _robots_cache[domain]


class HttpCollector(BaseCollector):
    def __init__(
        self,
        source_id: str,
        source_name: str,
        base_url: str,
        crawl_policy: dict,
        urls: List[str],
        timeout_seconds: float = 10.0,
        max_retries: int = 3,
    ):
        super().__init__(source_id, source_name, base_url, crawl_policy)
        self._urls = urls
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self.crawl_delay_seconds = float(crawl_policy.get("crawl_delay_seconds", 2))

    def discover_urls(self) -> List[str]:
        return self._urls

    def _respect_rate_limit(self, url: str) -> None:
        domain = _domain_of(url)
        last = _last_request_at.get(domain)
        if last is not None:
            elapsed = time.monotonic() - last
            wait_for = self.crawl_delay_seconds - elapsed
            if wait_for > 0:
                time.sleep(wait_for)
        _last_request_at[domain] = time.monotonic()

    def _check_robots_allowed(self, url: str) -> bool:
        rp = _get_robots_parser(url)
        return rp.can_fetch(USER_AGENT, url)

    def fetch(self, url: str) -> FetchedDocument:
        if not self._check_robots_allowed(url):
            raise PermissionError(f"robots.txt disallows crawling {url}")

        self._respect_rate_limit(url)

        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                with httpx.Client(
                    timeout=self.timeout_seconds,
                    headers={"User-Agent": USER_AGENT},
                    follow_redirects=True,
                ) as client:
                    response = client.get(url)
                    return FetchedDocument(
                        url=url,
                        final_url=str(response.url),
                        http_status=response.status_code,
                        content_type=response.headers.get("content-type", ""),
                        raw_content=response.text,
                        fetched_at=datetime.now(timezone.utc).isoformat(),
                    )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_error = exc
                backoff = 2 ** (attempt - 1)
                logger.warning("fetch failed url=%s attempt=%d/%d retrying_in=%ss error=%s", url, attempt, self.max_retries, backoff, exc)
                if attempt < self.max_retries:
                    time.sleep(backoff)

        raise ConnectionError(f"failed to fetch {url} after {self.max_retries} attempts") from last_error
