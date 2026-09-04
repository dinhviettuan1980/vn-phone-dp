"""Normalizes a user-supplied domain/URL into a canonical https base URL."""
from __future__ import annotations

from urllib.parse import urlparse


def normalize_domain(raw: str) -> str:
    raw = raw.strip()
    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    netloc = parsed.netloc.lower()
    return f"{parsed.scheme}://{netloc}"
