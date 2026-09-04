"""Parses sitemap XML: flat <urlset>, <sitemapindex> (recursive, bounded by
MAX_DEPTH), and gzip-compressed sitemaps. Pure parsing -- no network I/O
here, callers pass in already-fetched bytes (see sitemap_discoverer.py)."""
from __future__ import annotations

import gzip
import io
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

MAX_DEPTH = 3

# Sitemaps almost always declare this namespace; tolerate its absence too
# (some real-world sitemaps omit it despite the spec).
_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


@dataclass
class SitemapParseResult:
    urls: list[str] = field(default_factory=list)
    nested_sitemap_urls: list[str] = field(default_factory=list)
    is_index: bool = False
    error: str | None = None


def maybe_decompress(content: bytes) -> bytes:
    if content[:2] == b"\x1f\x8b":
        try:
            return gzip.decompress(content)
        except OSError:
            return content
    return content


def parse_sitemap_xml(content: bytes) -> SitemapParseResult:
    """Parses one sitemap document. Does NOT recurse into nested sitemaps
    (that's sitemap_discoverer.py's job, since it needs to fetch each one) --
    if this is a <sitemapindex>, nested_sitemap_urls is populated instead."""
    content = maybe_decompress(content)

    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        return SitemapParseResult(error=f"invalid XML: {exc}")

    tag = root.tag.rsplit("}", 1)[-1]  # strip namespace, e.g. "{...}urlset" -> "urlset"

    if tag == "sitemapindex":
        nested = [
            loc.text.strip()
            for loc in root.iter()
            if loc.tag.rsplit("}", 1)[-1] == "loc" and loc.text
        ]
        return SitemapParseResult(nested_sitemap_urls=nested, is_index=True)

    if tag == "urlset":
        urls = [
            loc.text.strip()
            for loc in root.iter()
            if loc.tag.rsplit("}", 1)[-1] == "loc" and loc.text
        ]
        return SitemapParseResult(urls=urls)

    return SitemapParseResult(error=f"unrecognized root element '{tag}'")
