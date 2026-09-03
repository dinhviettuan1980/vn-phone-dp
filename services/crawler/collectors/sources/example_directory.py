"""Example source-specific collector for a business-directory listing site.

Directory pages typically list many businesses per page (many phone
candidates per document, one per listing) — the generic extractor already
returns every candidate it finds, so no override is required here either.
This class is the extension point if a directory's markup ever needs
listing-level segmentation before extraction.
"""
from __future__ import annotations

from collectors.http.http_collector import HttpCollector


class BusinessDirectoryCollector(HttpCollector):
    """No overrides needed for the fixture directory site."""
