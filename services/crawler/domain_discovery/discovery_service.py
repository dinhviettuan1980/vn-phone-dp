"""Orchestrates domain discovery: normalize -> find sitemaps -> parse ->
score -> queue high-relevance URLs as crawl_targets (the EXISTING table,
reused -- see docs/PHASE2_IMPLEMENTATION_PLAN.md). Not crawling anything
itself; that's the worker's job once URLs are queued.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import psycopg

from domain_discovery.domain_normalizer import normalize_domain
from domain_discovery.sitemap_discoverer import discover_sitemaps
from domain_discovery.url_scorer import UrlScorer
from storage import postgres_repository as repo

logger = logging.getLogger("crawler.discovery_service")

DEFAULT_MAX_URLS_QUEUED = 500
MIN_SCORE_TO_QUEUE = 1  # anything above 0 (0 = denied) gets queued, ranked by priority


@dataclass
class DomainDiscoveryReport:
    domain: str
    robots_found: bool
    sitemaps_found: int
    urls_discovered: int
    urls_high_priority: int
    urls_queued: int
    errors: list[str]


def discover_domain(
    conn: psycopg.Connection,
    domain: str,
    source_name: str | None = None,
    max_urls_queued: int = DEFAULT_MAX_URLS_QUEUED,
) -> DomainDiscoveryReport:
    base_url = normalize_domain(domain)
    name = source_name or base_url.replace("https://", "").replace("http://", "")

    source_id = _upsert_discovered_source(conn, name, base_url)

    sitemap_result = discover_sitemaps(base_url)

    scorer = UrlScorer()
    scored = [scorer.score(url) for url in sitemap_result.urls]
    scored.sort(key=lambda s: s.score, reverse=True)

    high_priority_count = sum(1 for s in scored if s.score >= 80)
    queueable = [s for s in scored if s.score >= MIN_SCORE_TO_QUEUE][:max_urls_queued]

    for s in queueable:
        repo.upsert_crawl_target(conn, source_id, s.url, priority=s.score)
    conn.commit()

    status = "SUCCESS" if not sitemap_result.errors else ("PARTIAL" if sitemap_result.urls else "FAILED")
    discovery_id = _insert_domain_discovery(
        conn,
        source_id=source_id,
        domain=base_url,
        robots_found=sitemap_result.robots_found,
        sitemaps_found=len(sitemap_result.sitemaps_found),
        urls_discovered=len(sitemap_result.urls),
        urls_high_priority=high_priority_count,
        urls_queued=len(queueable),
        status=status,
        error_message="; ".join(sitemap_result.errors) if sitemap_result.errors else None,
    )
    logger.info(
        "[DISCOVERY] domain=%s sitemaps=%d urls=%d high_priority=%d queued=%d",
        base_url,
        len(sitemap_result.sitemaps_found),
        len(sitemap_result.urls),
        high_priority_count,
        len(queueable),
    )

    return DomainDiscoveryReport(
        domain=base_url,
        robots_found=sitemap_result.robots_found,
        sitemaps_found=len(sitemap_result.sitemaps_found),
        urls_discovered=len(sitemap_result.urls),
        urls_high_priority=high_priority_count,
        urls_queued=len(queueable),
        errors=sitemap_result.errors,
    )


def _upsert_discovered_source(conn: psycopg.Connection, name: str, base_url: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO data_sources (name, base_url, source_type, trust_level, is_active, license_notes)
            VALUES (%s, %s, 'OFFICIAL_WEBSITE', 'MEDIUM', true, 'Discovered via domain discovery -- trust_level starts MEDIUM until manually reviewed, per docs/architecture.md privacy/scope guardrail.')
            ON CONFLICT (name) DO UPDATE SET updated_at = now()
            RETURNING id
            """,
            (name, base_url),
        )
        source_id = cur.fetchone()["id"]
    conn.commit()
    return source_id


def _insert_domain_discovery(
    conn: psycopg.Connection,
    source_id: str,
    domain: str,
    robots_found: bool,
    sitemaps_found: int,
    urls_discovered: int,
    urls_high_priority: int,
    urls_queued: int,
    status: str,
    error_message: str | None,
) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO domain_discoveries
                (source_id, domain, robots_found, sitemaps_found, urls_discovered,
                 urls_high_priority, urls_queued, status, error_message, finished_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            RETURNING id
            """,
            (source_id, domain, robots_found, sitemaps_found, urls_discovered, urls_high_priority, urls_queued, status, error_message),
        )
        discovery_id = cur.fetchone()["id"]
    conn.commit()
    return discovery_id
