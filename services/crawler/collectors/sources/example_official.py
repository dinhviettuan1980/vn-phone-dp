"""Example source-specific collector for an official-organization website.

Most sources need nothing beyond the generic HttpCollector — this class
exists to show where source-specific overrides go (e.g. a source whose
markup needs custom title/metadata extraction) without special-casing
anything in the core crawler framework.
"""
from __future__ import annotations

from collectors.http.http_collector import HttpCollector


class OfficialWebsiteCollector(HttpCollector):
    """No overrides needed for the fixture official site — the generic
    HttpCollector + phone_extractor pipeline handles it as-is."""
