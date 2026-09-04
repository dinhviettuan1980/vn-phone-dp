"""Discovers a domain's sitemap(s): robots.txt Sitemap: directives first,
then common fallback paths, then recursively resolves sitemap indexes
(bounded by MAX_DEPTH). Uses our own declared User-Agent for every request
-- same fix as http_collector.py's robots.txt handling (some CDNs 403
Python's default UA specifically); see docs/architecture.md.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import httpx

from domain_discovery.sitemap_parser import MAX_DEPTH, parse_sitemap_xml

logger = logging.getLogger("crawler.sitemap_discoverer")

USER_AGENT = "PhoneIntelBot/0.1 (+https://example.invalid/bot; research/demo use)"

COMMON_SITEMAP_PATHS = [
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap-index.xml",
    "/sitemapindex.xml",
]

_SITEMAP_DIRECTIVE = re.compile(r"^sitemap:\s*(\S+)", re.IGNORECASE | re.MULTILINE)


@dataclass
class DiscoveryResult:
    robots_found: bool = False
    sitemap_urls_tried: list[str] = field(default_factory=list)
    sitemaps_found: list[str] = field(default_factory=list)
    urls: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def _fetch(client: httpx.Client, url: str) -> httpx.Response | None:
    try:
        return client.get(url, timeout=15.0)
    except httpx.HTTPError as exc:
        logger.warning("fetch failed url=%s error=%s", url, exc)
        return None


def _robots_sitemaps(client: httpx.Client, base_url: str) -> tuple[bool, list[str]]:
    response = _fetch(client, f"{base_url}/robots.txt")
    if response is None or response.status_code >= 400:
        return False, []
    directives = _SITEMAP_DIRECTIVE.findall(response.text)
    return True, directives


def _resolve_sitemap(client: httpx.Client, url: str, depth: int, result: DiscoveryResult, seen: set[str]) -> None:
    if depth > MAX_DEPTH or url in seen:
        return
    seen.add(url)
    result.sitemap_urls_tried.append(url)

    response = _fetch(client, url)
    if response is None or response.status_code >= 400:
        result.errors.append(f"{url}: unreachable or {response.status_code if response else 'no response'}")
        return

    parsed = parse_sitemap_xml(response.content)
    if parsed.error:
        result.errors.append(f"{url}: {parsed.error}")
        return

    result.sitemaps_found.append(url)

    if parsed.is_index:
        for nested_url in parsed.nested_sitemap_urls:
            _resolve_sitemap(client, nested_url, depth + 1, result, seen)
    else:
        result.urls.extend(parsed.urls)


def discover_sitemaps(base_url: str) -> DiscoveryResult:
    result = DiscoveryResult()
    seen: set[str] = set()

    with httpx.Client(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        robots_found, directive_urls = _robots_sitemaps(client, base_url)
        result.robots_found = robots_found

        candidates = directive_urls or [base_url + p for p in COMMON_SITEMAP_PATHS]

        for sitemap_url in candidates:
            _resolve_sitemap(client, sitemap_url, depth=1, result=result, seen=seen)

    # Dedupe URLs while preserving order.
    result.urls = list(dict.fromkeys(result.urls))
    return result
